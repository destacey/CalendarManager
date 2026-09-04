# Tauri Migration M4: Rust Sync Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Microsoft Graph calendar syncing into Rust, so access tokens never reach the webview and each page of events is transformed and upserted as it arrives rather than marshalled through IPC as one array.

**Architecture:** `start_sync` spawns a Tokio task that pages `/me/calendar/calendarView` with `reqwest`, transforms and upserts each 500-event page inside one transaction, and emits one honest progress event per page. Cancellation is a `CancellationToken` checked between pages and passed to `reqwest`. The 715-line `calendar.ts` collapses to a thin client.

**Tech Stack:** Rust (`reqwest`, `tokio`, `tokio-util`, `chrono`, `chrono-tz`, `serde`), Tauri v2, React 19.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-09-03-electron-to-tauri-migration-design.md`. This plan implements the **sync** milestone (M4). Read its "Sync engine" section — it settles the event contract, cancellation, and what gets dropped.
- **Branch:** `feat/tauri-migration`. Do not merge to `main`.
- **The source of truth for ported behaviour** is `src/services/calendar.ts` (still present, 715 lines) and, for the upsert, `git show ca805d0:electron/main.js | sed -n '344,469p'`. That file was deleted in this branch; recover it from history.
- **Tokens must never cross the IPC boundary.** Call `auth::flow::ensure_access_token(&app)` — the seam the auth milestone built for exactly this. Do not add a command that returns a token, and do not log one.
- **Every command that does I/O must be `async fn`.** Database work goes through `Db::call` (`src-tauri/src/db/mod.rs`), which already moves the query to a blocking thread.
- **Domain field names stay `snake_case`.** `src/types/index.ts` declares them so and the calendar components read them directly. Command *names* and the new sync payloads are camelCase.
- **Named columns in every SQL statement.** The real database's physical column order is unverified.
- **Foreign keys are enforced in this build** (`-DSQLITE_DEFAULT_FOREIGN_KEYS=1`) where `better-sqlite3` left them off. The upsert writes `events.type_id`, which carries a `REFERENCES` clause — see Task 3.
- **Do not touch** `src-tauri/src/db/` except to add `db/sync.rs`, and do not touch `src-tauri/src/auth/`. Both are reviewed and settled.

### The trap that will waste your time

**Vitest collects zero tests from a lowercase drive letter.** From `d:\Dev\CalendarManager` every file reports "No test suite found in file" and the suite looks completely broken. Always `cd /d/Dev/CalendarManager` and confirm `pwd` prints `D:/Dev/CalendarManager` before believing any frontend result.

### Baseline entering this milestone

143 Rust tests, 368 frontend tests, 29 commands, `tsc` at 113 errors — **26 of which are in `calendar.ts`** and should largely disappear as this milestone guts that file. Two pre-existing Rust dead-code warnings (`AuthState::has_session`/`set_session`/`is_cancelled`, `Loopback::port`).

### What this milestone deletes

The spec decided these are dead, not to be ported:

- **The delta-sync path** — `performFullSync`, `fetchDeltaEvents`, `fetchAllEventsWithDeltaToken`, `extractDeltaToken`, `getLatestEventModified`, `cleanupDeletedEvents`, and the `forceFullSync` parameter. `syncEvents()` only ever calls `performDateRangeSync`, so roughly 150 lines are unreachable.
- **`SyncProgress.tsx`** (191 lines) including its unused `compact` variant — `SyncModal` is its only consumer.
- **The callback registry** — `addSyncCallbacks`/`removeSyncCallbacks`/`setSyncCallbacks` and the `Set<Callback>` bookkeeping. Tauri's `listen()` returns an unlisten function, so a component subscribes and unsubscribes in one `useEffect`.
- **`@microsoft/microsoft-graph-client`** — the last dependency held only for this file.

**Deliberately left alone:** the `syncMetadata` key in the config store. The spec
records that nothing reads or writes it — `setSyncMetadata` was only ever called
from the unreachable `performFullSync` — so it stays in the store schema as
somewhere a future delta sync could put its state. Do not add code to populate
it, and do not delete the key.

### The progress contract, and why the old one went

The user's verdict on the original was that it "was never working correctly", and it structurally could not: `completed` only ever jumped 0 → total in one step, so the bar showed 0% then 100%; `stats.created`/`updated` stayed at zero until the sync had already finished; and all four stage icons resolved to the same spinner. The replacement is deliberately more modest and honest:

```rust
app.emit("sync-status", SyncStatus { fetched: u32, phase: Phase })?;  // one per page
app.emit("sync-complete", SyncResult { .. })?;                        // once
```

`fetched` only increases. `phase` is a plain enum (`Fetching`/`Saving`/`Cleaning`) rendered as text. **No percentage, no per-stage colour palette.** The final created/updated/deleted counts survive, moving to the completion state where the numbers are real.

---

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `src-tauri/src/graph/mod.rs` | Module tree; the shared `reqwest::Client` |
| `src-tauri/src/graph/date_range.rs` | Timezone-aware sync window — pure, tested |
| `src-tauri/src/graph/transform.rs` | Graph JSON → local event fields — pure, tested |
| `src-tauri/src/graph/sync.rs` | The paginated pipeline, progress events, cancellation |
| `src-tauri/src/graph/error.rs` | `SyncError` |
| `src-tauri/src/db/sync.rs` | Page upsert + range cleanup |
| `src-tauri/src/commands/sync.rs` | `start_sync`, `cancel_sync`, `sync_status` |
| `src/api/sync.ts` | Typed wrapper plus a typed `listen` helper |

**Modified:** `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`, `src/services/calendar.ts` (gutted), `src/components/SyncModal.tsx`, `src/components/TitleBar.tsx`, `package.json`.

**Deleted:** `src/components/SyncProgress.tsx`.

---

### Task 1: The sync window, with real timezones

`calculateDateRange` is four lines of `dayjs` that hide the only genuinely subtle logic in the milestone. Getting it wrong shifts everybody's sync window by hours.

**Files:**
- Create: `src-tauri/src/graph/mod.rs`, `graph/error.rs`, `graph/date_range.rs`
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`
- Test: inline in `date_range.rs`

**Interfaces produced:**
- `pub struct SyncWindow { pub start: String, pub end: String }` — RFC3339 UTC strings, as Graph wants them.
- `pub fn sync_window(start_date: &str, end_date: &str, timezone: &str) -> Result<SyncWindow, SyncError>`
- `pub enum SyncError` implementing `std::error::Error` and `serde::Serialize` (mirror `src-tauri/src/db/error.rs`'s pattern exactly).

**The behaviour to reproduce**, from `calendar.ts:612-621`:

```typescript
const start = dayjs.tz(config.startDate, userTimezone).startOf('day')
const end   = dayjs.tz(config.endDate,   userTimezone).endOf('day')
return { start: start.toISOString(), end: end.toISOString() }
```

So: interpret each `YYYY-MM-DD` **in the user's timezone**, take the first and last instant of that local day, and emit UTC. For `Europe/London` in summer, `2026-07-01` starts at `2026-06-30T23:00:00Z`, not `2026-07-01T00:00:00Z` — that one-hour shift is the whole point of the function.

- [ ] **Step 1: Add the dependencies, and register the module tree first**

The module must be registered before its test file exists, or `cargo test` reports "0 tests filtered out" rather than the compile error the RED step expects. This project has hit that trap four times.

In `src-tauri/Cargo.toml` `[dependencies]`:

```toml
chrono = { version = "0.4", default-features = false, features = ["std", "clock", "serde"] }
chrono-tz = "0.10"
tokio-util = "0.7"
```

`chrono-tz` carries the IANA database, which is what makes `Europe/London` resolvable at all — `chrono` alone only knows fixed offsets. `tokio-util` supplies `CancellationToken`.

Create `src-tauri/src/graph/error.rs` following `src-tauri/src/db/error.rs`'s shape:

```rust
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("Sync is already running")]
    AlreadyRunning,

    #[error("Sync was cancelled")]
    Cancelled,

    #[error("Unknown timezone: {0}")]
    UnknownTimezone(String),

    #[error("Invalid sync date {0}")]
    InvalidDate(String),

    #[error("Unable to sync while offline. Please check your internet connection.")]
    Offline,

    #[error("Microsoft Graph error: {0}")]
    Graph(String),

    #[error("{0}")]
    Auth(String),

    #[error("{0}")]
    Database(String),

    #[error("{0}")]
    Other(String),
}

impl Serialize for SyncError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type GraphResult<T> = Result<T, SyncError>;
```

The alias is `GraphResult`, deliberately not `SyncResult`: that name is already
taken by the payload struct the frontend receives, and two `SyncResult`s in one
module tree would confuse every later task.

Create `src-tauri/src/graph/mod.rs` with `pub mod date_range; pub mod error;`, and add `mod graph;` to `src-tauri/src/lib.rs` beside `mod db;`.

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/graph/date_range.rs` with only the test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_utc_day_spans_midnight_to_the_last_millisecond() {
        let window = sync_window("2026-03-15", "2026-03-15", "UTC").unwrap();

        assert_eq!(window.start, "2026-03-15T00:00:00+00:00");
        assert!(
            window.end.starts_with("2026-03-15T23:59:59"),
            "end was {}",
            window.end
        );
    }

    /// The reason this function exists. A London summer day starts an hour
    /// before UTC midnight, so a naive UTC reading would sync the wrong window.
    #[test]
    fn a_london_summer_day_starts_the_previous_evening_in_utc() {
        let window = sync_window("2026-07-01", "2026-07-01", "Europe/London").unwrap();

        assert_eq!(window.start, "2026-06-30T23:00:00+00:00");
    }

    #[test]
    fn a_london_winter_day_starts_at_utc_midnight() {
        let window = sync_window("2026-01-15", "2026-01-15", "Europe/London").unwrap();

        assert_eq!(window.start, "2026-01-15T00:00:00+00:00");
    }

    #[test]
    fn a_negative_offset_zone_starts_later_in_utc() {
        let window = sync_window("2026-07-01", "2026-07-01", "America/New_York").unwrap();

        assert_eq!(window.start, "2026-07-01T04:00:00+00:00");
    }

    #[test]
    fn a_multi_day_range_spans_both_ends() {
        let window = sync_window("2026-05-01", "2026-05-31", "UTC").unwrap();

        assert_eq!(window.start, "2026-05-01T00:00:00+00:00");
        assert!(window.end.starts_with("2026-05-31T23:59:59"));
    }

    /// A spring-forward day has no 00:00 in some zones; the window must still
    /// resolve rather than panicking or silently producing a wrong instant.
    #[test]
    fn a_dst_transition_day_still_resolves() {
        let window = sync_window("2026-03-29", "2026-03-29", "Europe/London").unwrap();

        assert!(window.start.ends_with("+00:00"), "start was {}", window.start);
        assert!(window.end.ends_with("+00:00"), "end was {}", window.end);
        assert!(window.start < window.end);
    }

    #[test]
    fn an_unknown_timezone_is_rejected() {
        assert!(matches!(
            sync_window("2026-01-01", "2026-01-02", "Mars/Olympus_Mons"),
            Err(SyncError::UnknownTimezone(_))
        ));
    }

    #[test]
    fn an_unparseable_date_is_rejected() {
        assert!(matches!(
            sync_window("not-a-date", "2026-01-02", "UTC"),
            Err(SyncError::InvalidDate(_))
        ));
    }

    #[test]
    fn a_reversed_range_is_rejected() {
        assert!(sync_window("2026-05-31", "2026-05-01", "UTC").is_err());
    }
}
```

- [ ] **Step 3: Run to verify failure**

```bash
cd /d/Dev/CalendarManager/src-tauri && cargo test graph::date_range
```

Expected: FAIL to compile — `cannot find function sync_window`, `cannot find type SyncWindow`.

- [ ] **Step 4: Implement**

Prepend to `date_range.rs`. Use `chrono_tz::Tz` parsed from the string, `NaiveDate` for the input dates, and resolve local midnight with `and_hms_opt(0,0,0)` plus `.and_local_timezone(tz)`. That returns a `LocalResult`, which is the whole reason the DST test exists: on a spring-forward day local midnight may not exist, and on a fall-back day it may be ambiguous. Handle all three arms — take the single result, the earlier of two ambiguous ones, and for a gap step forward to the first valid instant rather than erroring. Emit with `to_rfc3339()`.

For the end of the day, match `dayjs`'s `endOf('day')`: `23:59:59.999`.

Also reject a reversed range, matching `validateSyncConfig`'s intent at `calendar.ts:691`.

- [ ] **Step 5: Run to verify pass**

```bash
cd /d/Dev/CalendarManager/src-tauri && cargo test graph::date_range
```

Expected: PASS, 9 tests. If `a_london_summer_day_starts_the_previous_evening_in_utc` fails, the timezone is being applied after the instant is built rather than before — that is the bug this test exists to catch.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/graph/ src-tauri/src/lib.rs
git commit -m "feat(sync): port the sync window with real timezone handling

calculateDateRange was four lines of dayjs hiding the only genuinely
subtle logic in the sync path: each YYYY-MM-DD is interpreted in the
user's timezone, not UTC, so a London summer day begins at 23:00Z the
evening before. Getting that wrong shifts everybody's sync window by an
hour without any visible symptom.

chrono-tz carries the IANA database that makes a zone name resolvable at
all; chrono alone knows only fixed offsets. Resolving local midnight
returns a LocalResult rather than an instant, because on a spring-forward
day local midnight may not exist and on a fall-back day it may be
ambiguous — all three arms are handled and tested."
```

---

> **A deliberate deviation, stated rather than hidden.** Task 1 gives literal
> test code. Tasks 2 through 5 instead specify each test as an enumerated case
> naming its input and expected outcome, and cite the exact line in
> `src/services/calendar.ts` or in `git show ca805d0:electron/main.js` that
> defines the behaviour. That departs from this format's usual rule of showing
> every line of test code, for the same reason the data-layer plan did: the
> existing implementation is the precise specification, and inlining several
> hundred lines of invented test code would make the plan harder to follow
> without making the requirement clearer. If any enumerated case is ambiguous
> when you reach it, stop and ask rather than guessing.

### Task 2: The Graph event transform

**Files:** Create `src-tauri/src/graph/transform.rs`; modify `graph/mod.rs`. Test inline.

**Interfaces produced:**
- `pub struct GraphEvent` — `Deserialize` over the Graph payload, tolerant of missing fields.
- `pub struct LocalEventFields { graph_id, title, description, start_date, end_date, is_all_day, show_as, categories, location, organizer, attendees, is_meeting }`
- `pub fn transform(event: &GraphEvent) -> LocalEventFields`

**The behaviour to reproduce** is `git show ca805d0:electron/main.js | sed -n '373,400p'`. Port each mapping exactly:

| Local field | Source | Fallback |
| --- | --- | --- |
| `graph_id` | `id` | — |
| `title` | `subject` | `"Untitled Event"` |
| `description` | `body.content` | `""` |
| `start_date` | `start.dateTime` | now, as an ISO string |
| `end_date` | `end.dateTime` | now, as an ISO string |
| `is_all_day` | `isAllDay` | `false` |
| `show_as` | `showAs` | `"busy"` |
| `categories` | `categories.join(",")` | `""` |
| `location` | `location.displayName` | `""` |
| `organizer` | `{name, email}` as a JSON **string** | `""` |
| `attendees` | array of `{name, email, response}` as a JSON **string** | `""` |
| `is_meeting` | `attendees.length > 0` | `false` |

Note `organizer` and `attendees` are stored as **JSON strings inside TEXT columns**, not as structured data — `src/types/index.ts:53-54` documents this and `EventModal` parses them back. Preserve that exactly; changing it would break the event detail view.

- [ ] **Step 1: Write failing tests.** Cover: a full realistic Graph payload maps every field; a payload missing `subject` gets `"Untitled Event"`; missing `body`, `location`, `organizer` and `attendees` all yield `""`; `categories: []` yields `""` while `["A","B"]` yields `"A,B"`; `attendees: []` gives `is_meeting: false` while one attendee gives `true`; a missing `showAs` gives `"busy"`; `organizer` serializes to a JSON string with exactly `name` and `email` keys; `attendees` serializes to a JSON array whose elements have exactly `name`, `email` and `response`; and an unknown extra field in the payload does not break deserialization (Graph adds fields over time).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.** `#[serde(default)]` liberally, and `#[serde(rename_all = "camelCase")]` on `GraphEvent` since Graph's wire format is camelCase — this is the one place camelCase is correct on the Rust side.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** with your own message.

---

### Task 3: Page upsert and range cleanup

**Files:** Create `src-tauri/src/db/sync.rs`; modify `src-tauri/src/db/mod.rs`. Test inline.

**Interfaces produced:**
- `pub struct UpsertCounts { pub created: u32, pub updated: u32 }`
- `pub fn upsert_page(conn: &Connection, events: &[LocalEventFields]) -> DbResult<UpsertCounts>`
- `pub fn cleanup_range(conn: &Connection, start: &str, end: &str, keep_graph_ids: &[String]) -> DbResult<u32>`

**The upsert must reproduce `main.js:344-469` exactly**, including the one subtlety that matters most:

- Look up the existing row by `graph_id`.
- **If it exists and `type_manually_set` is true, update every column EXCEPT `type_id`.** A manual override is never overwritten by a sync. This is the single most important line in the file.
- If it exists and the override is not set, re-evaluate the type and update `type_id` too.
- If it does not exist, insert with the evaluated type and `type_manually_set = 0`.
- **Pre-fetch the rules and the default type once**, before the loop — `main.js:366-368` does, and the user's sync covers thousands of events.
- Whole page in one transaction.

Call `crate::db::rules::evaluate` — do not reimplement rule matching. It is ported and covered by 16 tests.

**Foreign keys are enforced in this build**, and the insert writes `events.type_id`. If the default type has been deleted mid-sync, `evaluate` returns `None`, which is FK-legal (NULL). But a rule whose `target_type_id` points at a since-deleted type would fail the insert. Add a test for that case and decide deliberately: prefer falling back to the default type over failing the whole page. **Report what you chose.**

**`cleanup_range` replaces `calendar.ts:555-586`, which was pathological.** It fetched *all* local events, filtered them in JavaScript, then issued one `deleteEvent` IPC call per event. Against 8,924 events that is a full table read plus N round-trips, each its own transaction. Replace it with a single statement:

```sql
DELETE FROM events
WHERE graph_id IS NOT NULL
  AND start_date >= ?1 AND start_date <= ?2
  AND graph_id NOT IN (rest of the bound ids)
```

Two notes. The original used `isBetween(..., '[]')` — inclusive both ends — so keep `>=` and `<=`. And SQLite has a bound-parameter limit (32,766 in modern builds); a page of 500 is fine but the *accumulated* keep-list across a wide sync could exceed it, so chunk the id list or stage it in a temporary table. **Report which you chose and why.**

- [ ] **Step 1: Write failing tests.** Cover: a new event is inserted with the evaluated type and `type_manually_set = 0`; an existing event is updated and `created`/`updated` counts are right; **an existing event with `type_manually_set = 1` keeps its `type_id` while its title still updates** — the regression guard; pre-fetching means a rule change mid-page is not picked up (document rather than assert if awkward); `cleanup_range` deletes an in-range event absent from the keep-list; it does **not** delete an in-range event that is in the keep-list; it does **not** delete an out-of-range event even when absent from the list; it does **not** delete a local-only event with `graph_id IS NULL`; and it handles an empty keep-list (delete everything in range with a graph_id).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** with your own message. Lead with the manual-override guard and the N+1 elimination.

---

### Task 4: The pipeline

**Files:** Create `src-tauri/src/graph/sync.rs`; modify `graph/mod.rs`, `src-tauri/Cargo.toml` if needed.

**Interfaces produced:**
- `pub struct SyncStatus { pub fetched: u32, pub phase: Phase }` — `Serialize`, `#[serde(rename_all = "camelCase")]`
- `pub enum Phase { Fetching, Saving, Cleaning }` — `Serialize`, lowercase
- `pub struct SyncResult { pub success: bool, pub message: String, pub stats: SyncStats, pub errors: Option<Vec<String>> }` — camelCase
- `pub struct SyncStats { pub created: u32, pub updated: u32, pub deleted: u32, pub total: u32 }`
- `pub async fn run<R: Runtime>(app: &AppHandle<R>, cancel: CancellationToken) -> Result<SyncResult, SyncError>`

**The fetch**, from `calendar.ts:359-414`. Keep these exactly:

- `GET https://graph.microsoft.com/v1.0/me/calendar/calendarView`
- `startDateTime` / `endDateTime` from Task 1's window
- `$select=id,subject,start,end,isAllDay,showAs,categories,body,location,organizer,attendees,lastModifiedDateTime`
- `$top=500`
- Follow `@odata.nextLink` **as an absolute URL**. The original picked it apart with `new URL()` to extract path and query (`calendar.ts:399`); Graph gives a complete URL and following it directly is both simpler and more correct.
- Bearer token from `auth::flow::ensure_access_token(&app)`, fetched **once per page** so a long sync refreshes rather than expiring mid-run.

**Per page:** transform → `Db::call(upsert_page)` → accumulate counts → `emit("sync-status", { fetched, phase: Saving })`. Do not accumulate every event in memory before writing; the point of this milestone is streaming. Do accumulate the `graph_id`s, which `cleanup_range` needs.

**Cancellation:** check `cancel.is_cancelled()` between pages, and race the `reqwest` future against `cancel.cancelled()` so an in-flight request aborts too. On cancel, return a `SyncResult` with `success: false` and message `"Sync was cancelled"` — the exact string the UI already handles.

**Offline:** map a `reqwest` connect error to `SyncError::Offline`, whose `Display` is the message the original showed. `navigator.onLine` only ever reported whether the adapter had a link; a real connection error is an honest signal.

**Success message:** `format!("Successfully synced {total} events for the specified date range.")`, matching `calendar.ts:449`.

- [ ] **Step 1: Write failing tests** for the pieces that do not need a network: the `SyncStatus`/`SyncResult`/`Phase` serialization shapes (assert the exact JSON keys the frontend will destructure — `fetched`, `phase`, `success`, `message`, `stats.created`, `stats.updated`, `stats.deleted`, `stats.total`), the success and cancellation message strings, and the `$select`/`$top` query construction. **Do not add an HTTP-mocking dependency**; the paginated fetch is covered by the manual gate, as the spec intends.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** with your own message.

---

### Task 5: Commands, frontend rewire, and the great deletion

**Files:**
- Create: `src-tauri/src/commands/sync.rs`, `src/api/sync.ts`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`, `src/services/calendar.ts`, `src/components/SyncModal.tsx`, `src/components/TitleBar.tsx`, `package.json`
- Delete: `src/components/SyncProgress.tsx`

**Three commands**, taking the count from 29 to 32:

- `start_sync` — refuses with `SyncError::AlreadyRunning` if one is in flight; spawns the task; returns immediately.
- `cancel_sync` — cancels the token.
- `sync_status` — returns `{ isActive, canSync }`, matching what `SyncModal:20` already consumes.

Hold a `SyncState { running: AtomicBool, cancel: Mutex<Option<CancellationToken>> }` in Tauri state, and **clear `running` on every exit path** — the auth milestone shipped a bug where a failed login left its in-flight flag stuck true and every later attempt refused.

**`calendar.ts` goes from 715 lines to roughly 40.** What survives: `SyncConfig`, `SyncResult`, `startSync`, `cancelSync`, `getSyncStatus`, `getCurrentSyncConfig`, `setSyncConfig`, `getDefaultSyncConfig`, `validateSyncConfig`, and a typed `onSyncStatus`/`onSyncComplete` listen helper. Everything else goes, including `getLocalEvents`/`getLocalEventsInRange` — the data-layer milestone already repointed their callers at `src/api/events.ts`, so they now have none. Verify that with a grep before deleting.

**`SyncModal`** loses its `SyncProgress` import and its callback registration, gaining a `useEffect` that listens for `sync-status`/`sync-complete` and returns the unlisten functions. Replace the progress block with roughly 30 lines: a spinner, `"{n} events fetched…"`, the phase as text, and a Cancel button. Keep the final `Statistic` row for created/updated/deleted — those numbers are real at completion.

**`TitleBar`** also references `calendarService.setSyncCallbacks` and renders `SyncProgress` in compact mode (`TitleBar.tsx:76-79`, `:200-209`). Rewire it to the same listener and replace the compact progress with a small text indicator. Its existing tests mock `../services/calendar`; keep their assertions.

**Then remove `@microsoft/microsoft-graph-client`** — this file was the last holder.

- [ ] **Step 1: Write the failing tests.** Retarget `SyncModal`'s and `TitleBar`'s tests onto the new surface, keeping existing assertions. Add tests for the thin `calendar.ts`: `startSync` delegates, `cancelSync` delegates, `validateSyncConfig` still rejects a reversed range and a range over 365 days.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement the Rust commands** and register them. Confirm 32.
- [ ] **Step 4: Gut `calendar.ts`** and create `src/api/sync.ts`.
- [ ] **Step 5: Rewrite `SyncModal`, rewire `TitleBar`, delete `SyncProgress.tsx`.**
- [ ] **Step 6: Remove the Graph client dependency.** `grep -rn "microsoft-graph-client" src/` must come back empty first.
- [ ] **Step 7: Verify.** `npm run test:run` from the uppercase path; `npx tsc --noEmit 2>&1 | grep -c "error TS"` should drop **well below 113**, since 26 of those errors are in the file being gutted. Report the count and where anything new lives.
- [ ] **Step 8: Commit** with your own message.

---

## Definition of Done

- [ ] `cd src-tauri && cargo test` — all green; report the total.
- [ ] `npm run test:run` from an uppercase drive letter — green.
- [ ] `npx tsc --noEmit` count reported and well below 113.
- [ ] 32 commands registered.
- [ ] `grep -rn "electronAPI" src/` returns **nothing**. This milestone retires the last reference.
- [ ] `grep -rn "microsoft-graph-client\|msal" src/` returns nothing.
- [ ] `src/components/SyncProgress.tsx` is gone; `src/services/calendar.ts` is under 60 lines.

**Manual gate — only the user can run this:**

1. Note your event count before starting.
2. `npm start` → Sync. **The count rises, the phase text changes, and Cancel is offered.**
3. Let it finish: the completion summary shows created/updated/deleted, and the calendar reflects them.
4. Sync again immediately. Second run should report **mostly updates, few or no creates** — that proves the `graph_id` upsert matches rather than duplicating.
5. Check the event count did not roughly double. Duplication is the failure this milestone could plausibly cause.
6. Set an event's type by hand, then sync again, then check that event: **it must keep your chosen type.** This is the manual-override guard and the single most important check.
7. Start a sync and hit **Cancel** — it stops promptly, and a second sync works.
8. Turn the network off and sync: a clear offline message, not a hang or a stack trace.
9. Narrow the sync window to exclude some previously-synced days, sync, and confirm events in the excluded range are **not** deleted, while events removed in Outlook inside the window **are**.

Step 6 is the one to be most careful about, and step 5 the one most likely to reveal a real bug.

## Next

M5 (polish: Save-As for the Excel export, dependency cleanup, CLAUDE.md and README rewrite) and M6 (installer, signing, updater) each get their own plan.
