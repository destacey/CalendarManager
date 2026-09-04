//! The streaming Graph sync pipeline.
//!
//! Tasks 1-3 built the pieces this wires together:
//!   - `date_range::sync_window` resolves the UTC fetch window from the
//!     user's configured date range and timezone.
//!   - `transform::transform` maps one `GraphEvent` to `LocalEventFields`.
//!   - `db::sync::{upsert_page, cleanup_range}` write a page and clean up
//!     anything that fell out of the window.
//!
//! This module's own job is the fetch loop: page through
//! `/me/calendar/calendarView`, transform and write each page as it arrives
//! (never accumulating the whole result set in memory), and emit progress as
//! it goes. See `run`'s doc comment for the per-page sequence.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_store::StoreExt;
use tokio_util::sync::CancellationToken;

use crate::auth::flow::ensure_access_token;
use crate::commands::config::STORE_FILE;
use crate::db::sync::{cleanup_range, upsert_page};
use crate::db::Db;

use super::date_range::sync_window;
use super::error::{GraphResult, SyncError};
use super::transform::{transform, GraphEvent, LocalEventFields};

const CALENDAR_VIEW_URL: &str = "https://graph.microsoft.com/v1.0/me/calendar/calendarView";
/// Keep exactly as `calendar.ts:359-414` requests it (the brief's enumerated
/// "keep these exactly" list does not include `$orderby`, even though the
/// original TS request did — this task's fetch intentionally omits it).
const SELECT_FIELDS: &str =
    "id,subject,start,end,isAllDay,showAs,categories,body,location,organizer,attendees,lastModifiedDateTime";
const PAGE_SIZE: u32 = 500;

/// One page's worth of progress. `fetched` only ever increases across a
/// sync; there is deliberately no percentage (see module docs on `run`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub fetched: u32,
    pub phase: Phase,
}

/// Rendered as plain text by the frontend, not an icon or a progress bar
/// segment — hence the plain lowercase strings rather than anything fancier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Fetching,
    Saving,
    Cleaning,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStats {
    pub created: u32,
    pub updated: u32,
    pub deleted: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub success: bool,
    pub message: String,
    pub stats: SyncStats,
    pub errors: Option<Vec<String>>,
}

/// The shape `syncConfig` is stored under (`src/services/calendar.ts:15-18`'s
/// `SyncConfig`, written by `storageService.setSyncConfig`).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncConfigStored {
    start_date: String,
    end_date: String,
}

/// One page of `/me/calendar/calendarView`. `@odata.nextLink`, when present,
/// is a complete absolute URL — followed directly, never picked apart (see
/// module docs and the brief: the original's `new URL()` + path/query
/// reconstruction is not reproduced here).
#[derive(Debug, Deserialize)]
struct CalendarViewPage {
    #[serde(default)]
    value: Vec<GraphEvent>,
    #[serde(rename = "@odata.nextLink")]
    next_link: Option<String>,
}

/// `calendar.ts:449`'s success message, exactly.
fn success_message(total: u32) -> String {
    format!("Successfully synced {total} events for the specified date range.")
}

/// `calendar.ts:186`'s cancellation result, exactly: zeroed stats, no
/// errors, `success: false`. Cancellation is a normal outcome (an `Ok`
/// `SyncResult`), not a propagated `SyncError` — the same treatment the
/// original gave an `AbortError`.
fn cancelled_result() -> SyncResult {
    SyncResult {
        success: false,
        message: "Sync was cancelled".to_string(),
        stats: SyncStats { created: 0, updated: 0, deleted: 0, total: 0 },
        errors: None,
    }
}

/// Builds the initial `calendarView` request URL. Only the *first* request is
/// built this way — every subsequent page follows `@odata.nextLink` as-is.
fn build_calendar_view_url(start: &str, end: &str) -> String {
    let mut url = url::Url::parse(CALENDAR_VIEW_URL).expect("CALENDAR_VIEW_URL is a valid URL");
    url.query_pairs_mut()
        .append_pair("startDateTime", start)
        .append_pair("endDateTime", end)
        .append_pair("$select", SELECT_FIELDS)
        .append_pair("$top", &PAGE_SIZE.to_string());
    url.into()
}

/// Resolves the timezone to sync with, in order: the store's `timezone` if
/// it is a non-empty string; else the system zone
/// (`iana_time_zone::get_timezone()`); else `"UTC"`. A pure function over
/// `Option<&str>` — no `AppHandle` needed — so the fallback chain is testable
/// without standing up a Tauri app.
///
/// Rust gets no such fallback for free the way `storageService.getTimezone()`
/// (`src/services/storage.ts:79`) does via `Intl.DateTimeFormat()`: the
/// config store's `timezone` value on the real machine is `null` and always
/// has been, so this path runs on every real sync.
pub fn resolve_timezone(stored: Option<&str>) -> String {
    if let Some(value) = stored {
        if !value.is_empty() {
            return value.to_string();
        }
    }

    iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".to_string())
}

/// True only for a connection failure — DNS, refused, no route. `Display`ing
/// it never includes the bearer token: neither this classification nor
/// `reqwest::Error`'s own `Display` (which reports the URL and cause, never
/// request headers) can leak it.
fn map_reqwest_error(error: reqwest::Error) -> SyncError {
    if error.is_connect() {
        SyncError::Offline
    } else {
        SyncError::Graph(error.to_string())
    }
}

fn truncate_body(body: &str) -> String {
    body.chars().take(500).collect()
}

/// Fetches and parses one page, racing the in-flight request against
/// cancellation so a cancel mid-request aborts it rather than waiting the
/// request out. Returns `Err(SyncError::Cancelled)` when the race is won by
/// the cancellation side; the caller (`run`) turns that into the cancelled
/// `SyncResult`, not a propagated error.
async fn fetch_page(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    cancel: &CancellationToken,
) -> GraphResult<CalendarViewPage> {
    let request = client.get(url).bearer_auth(token).send();

    let response = tokio::select! {
        _ = cancel.cancelled() => return Err(SyncError::Cancelled),
        result = request => result.map_err(map_reqwest_error)?,
    };

    let status = response.status();
    let body = response.text().await.map_err(map_reqwest_error)?;

    if !status.is_success() {
        return Err(SyncError::Graph(format!("{status}: {}", truncate_body(&body))));
    }

    serde_json::from_str(&body)
        .map_err(|e| SyncError::Graph(format!("could not parse the Graph response: {e}")))
}

/// Runs one full date-range sync: resolve the window, page through
/// `calendarView`, and clean up anything that fell out of range.
///
/// Per page: fetch (racing cancellation) → `transform` every event →
/// `Db::call(upsert_page)` → accumulate counts and `graph_id`s → emit
/// `sync-status` with `phase: Saving`. Nothing here accumulates the fetched
/// events themselves across pages — only the small `graph_id` list
/// `cleanup_range` needs at the end — which is the point of moving this to
/// Rust: a page is written to SQLite and dropped before the next page is
/// even requested.
///
/// The access token is fetched fresh via `ensure_access_token` **once per
/// page**, not once at the start: a wide date range over a slow connection
/// can run long enough for a token to expire mid-sync, and this is the seam
/// the auth milestone built for exactly that refresh.
pub async fn run<R: Runtime>(
    app: &AppHandle<R>,
    cancel: CancellationToken,
) -> Result<SyncResult, SyncError> {
    let store = app.store(STORE_FILE).map_err(|e| SyncError::Other(e.to_string()))?;

    let sync_config: SyncConfigStored = store
        .get("syncConfig")
        .and_then(|value| serde_json::from_value(value).ok())
        .ok_or_else(|| SyncError::Other("no sync date range is configured".to_string()))?;

    let stored_timezone = store.get("timezone");
    let timezone = resolve_timezone(stored_timezone.as_ref().and_then(|v| v.as_str()));

    let window = sync_window(&sync_config.start_date, &sync_config.end_date, &timezone)?;

    let db = app.state::<Db>().inner().clone();
    let client = reqwest::Client::new();

    let mut url = build_calendar_view_url(&window.start, &window.end);
    let mut fetched = 0u32;
    let mut created = 0u32;
    let mut updated = 0u32;
    let mut keep_graph_ids: Vec<String> = Vec::new();

    app.emit("sync-status", SyncStatus { fetched: 0, phase: Phase::Fetching })
        .map_err(|e| SyncError::Other(e.to_string()))?;

    loop {
        if cancel.is_cancelled() {
            return Ok(cancelled_result());
        }

        let token = ensure_access_token(app)
            .await
            .map_err(|e| SyncError::Auth(e.to_string()))?;

        let page = match fetch_page(&client, &url, &token, &cancel).await {
            Ok(page) => page,
            Err(SyncError::Cancelled) => return Ok(cancelled_result()),
            Err(other) => return Err(other),
        };

        fetched += page.value.len() as u32;

        let fields: Vec<LocalEventFields> = page.value.iter().map(transform).collect();
        keep_graph_ids.extend(fields.iter().map(|f| f.graph_id.clone()));

        let counts = db
            .call(move |conn| upsert_page(conn, &fields))
            .await
            .map_err(|e| SyncError::Database(e.to_string()))?;
        created += counts.created;
        updated += counts.updated;

        app.emit("sync-status", SyncStatus { fetched, phase: Phase::Saving })
            .map_err(|e| SyncError::Other(e.to_string()))?;

        match page.next_link {
            Some(next) => url = next,
            None => break,
        }
    }

    if cancel.is_cancelled() {
        return Ok(cancelled_result());
    }

    app.emit("sync-status", SyncStatus { fetched, phase: Phase::Cleaning })
        .map_err(|e| SyncError::Other(e.to_string()))?;

    let range_start = window.start.clone();
    let range_end = window.end.clone();
    let deleted = db
        .call(move |conn| cleanup_range(conn, &range_start, &range_end, &keep_graph_ids))
        .await
        .map_err(|e| SyncError::Database(e.to_string()))?;

    let result = SyncResult {
        success: true,
        message: success_message(fetched),
        stats: SyncStats { created, updated, deleted, total: fetched },
        errors: None,
    };

    app.emit("sync-complete", result.clone())
        .map_err(|e| SyncError::Other(e.to_string()))?;

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // --- payload serialization shapes ---

    #[test]
    fn sync_status_serializes_to_camel_case_fetched_and_lowercase_phase() {
        let status = SyncStatus { fetched: 42, phase: Phase::Fetching };

        let value = serde_json::to_value(&status).unwrap();

        assert_eq!(value, json!({ "fetched": 42, "phase": "fetching" }));
    }

    #[test]
    fn phase_saving_and_cleaning_serialize_lowercase() {
        assert_eq!(serde_json::to_value(Phase::Saving).unwrap(), json!("saving"));
        assert_eq!(serde_json::to_value(Phase::Cleaning).unwrap(), json!("cleaning"));
    }

    #[test]
    fn sync_stats_serializes_with_exact_camel_case_keys() {
        let stats = SyncStats { created: 1, updated: 2, deleted: 3, total: 6 };

        let value = serde_json::to_value(stats).unwrap();

        assert_eq!(value, json!({ "created": 1, "updated": 2, "deleted": 3, "total": 6 }));
    }

    #[test]
    fn sync_result_serializes_with_exact_camel_case_keys_including_nested_stats() {
        let result = SyncResult {
            success: true,
            message: "Successfully synced 6 events for the specified date range.".to_string(),
            stats: SyncStats { created: 1, updated: 2, deleted: 3, total: 6 },
            errors: None,
        };

        let value = serde_json::to_value(&result).unwrap();

        assert_eq!(
            value,
            json!({
                "success": true,
                "message": "Successfully synced 6 events for the specified date range.",
                "stats": { "created": 1, "updated": 2, "deleted": 3, "total": 6 },
                "errors": null
            })
        );
    }

    #[test]
    fn sync_result_errors_serializes_as_an_array_when_present() {
        let result = SyncResult {
            success: false,
            message: "Sync failed.".to_string(),
            stats: SyncStats::default(),
            errors: Some(vec!["boom".to_string()]),
        };

        let value = serde_json::to_value(&result).unwrap();

        assert_eq!(value["errors"], json!(["boom"]));
    }

    // --- message strings ---

    #[test]
    fn success_message_matches_calendar_ts_449_exactly() {
        assert_eq!(
            success_message(6),
            "Successfully synced 6 events for the specified date range."
        );
    }

    #[test]
    fn success_message_with_zero_events() {
        assert_eq!(
            success_message(0),
            "Successfully synced 0 events for the specified date range."
        );
    }

    #[test]
    fn cancelled_result_matches_calendar_ts_186_exactly() {
        let result = cancelled_result();

        assert!(!result.success);
        assert_eq!(result.message, "Sync was cancelled");
        assert_eq!(result.stats, SyncStats { created: 0, updated: 0, deleted: 0, total: 0 });
        assert!(result.errors.is_none());
    }

    // --- query construction ---

    #[test]
    fn calendar_view_url_targets_the_right_endpoint() {
        let url = build_calendar_view_url("2026-03-01T00:00:00+00:00", "2026-03-31T23:59:59.999+00:00");

        assert!(url.starts_with("https://graph.microsoft.com/v1.0/me/calendar/calendarView?"));
    }

    #[test]
    fn calendar_view_url_carries_the_window_as_start_and_end_date_time() {
        let url = build_calendar_view_url("2026-03-01T00:00:00+00:00", "2026-03-31T23:59:59.999+00:00");
        let parsed = url::Url::parse(&url).unwrap();
        let pairs: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();

        assert_eq!(pairs.get("startDateTime").unwrap(), "2026-03-01T00:00:00+00:00");
        assert_eq!(pairs.get("endDateTime").unwrap(), "2026-03-31T23:59:59.999+00:00");
    }

    #[test]
    fn calendar_view_url_selects_exactly_the_fields_calendar_ts_requests() {
        let url = build_calendar_view_url("s", "e");
        let parsed = url::Url::parse(&url).unwrap();
        let pairs: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();

        assert_eq!(
            pairs.get("$select").unwrap(),
            "id,subject,start,end,isAllDay,showAs,categories,body,location,organizer,attendees,lastModifiedDateTime"
        );
    }

    #[test]
    fn calendar_view_url_pages_at_500() {
        let url = build_calendar_view_url("s", "e");
        let parsed = url::Url::parse(&url).unwrap();
        let pairs: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();

        assert_eq!(pairs.get("$top").unwrap(), "500");
    }

    // --- timezone resolution ---

    #[test]
    fn a_non_empty_stored_timezone_wins() {
        assert_eq!(resolve_timezone(Some("Europe/London")), "Europe/London");
    }

    #[test]
    fn an_absent_stored_timezone_falls_back_to_the_system_zone() {
        let system = iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".to_string());
        assert_eq!(resolve_timezone(None), system);
    }

    #[test]
    fn an_empty_string_stored_timezone_falls_back_to_the_system_zone() {
        let system = iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".to_string());
        assert_eq!(resolve_timezone(Some("")), system);
    }

    #[test]
    fn the_resolved_zone_always_parses_as_a_chrono_tz() {
        let resolved = resolve_timezone(None);
        assert!(
            resolved.parse::<chrono_tz::Tz>().is_ok(),
            "resolved system zone {resolved:?} does not parse as a chrono_tz::Tz"
        );
    }

    #[test]
    fn a_non_empty_stored_zone_also_parses_as_a_chrono_tz() {
        let resolved = resolve_timezone(Some("America/New_York"));
        assert!(resolved.parse::<chrono_tz::Tz>().is_ok());
    }
}
