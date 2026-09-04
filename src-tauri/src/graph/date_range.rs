use chrono::{DateTime, Duration, LocalResult, NaiveDate, NaiveDateTime, Utc};
use chrono_tz::Tz;

use super::error::{GraphResult, SyncError};

/// A resolved sync window: RFC3339 UTC instants, as Microsoft Graph's
/// `calendarView` endpoint wants them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncWindow {
    pub start: String,
    pub end: String,
}

/// Mirrors `calculateDateRange` in `src/services/calendar.ts:612-621`: each
/// `YYYY-MM-DD` boundary is interpreted as the first/last instant of that
/// calendar day *in the user's timezone*, then emitted as UTC. Parsing the
/// string as UTC and only afterwards "converting" to a timezone would be
/// silently wrong — the timezone has to be applied before the instant is
/// built, or every user's sync window shifts by their zone's offset with
/// no visible symptom.
pub fn sync_window(start_date: &str, end_date: &str, timezone: &str) -> GraphResult<SyncWindow> {
    let tz: Tz = timezone
        .parse()
        .map_err(|_| SyncError::UnknownTimezone(timezone.to_string()))?;

    let start_naive = NaiveDate::parse_from_str(start_date, "%Y-%m-%d")
        .map_err(|_| SyncError::InvalidDate(start_date.to_string()))?;
    let end_naive = NaiveDate::parse_from_str(end_date, "%Y-%m-%d")
        .map_err(|_| SyncError::InvalidDate(end_date.to_string()))?;

    // Matches validateSyncConfig's intent at calendar.ts:691
    // (startDate.isSameOrBefore(endDate)).
    if start_naive > end_naive {
        return Err(SyncError::InvalidDate(format!(
            "start date {start_date} is after end date {end_date}"
        )));
    }

    // dayjs's startOf('day'): the first instant of the local calendar day.
    let start_of_day = start_naive
        .and_hms_opt(0, 0, 0)
        .expect("00:00:00 is always a valid time");
    // dayjs's endOf('day') is 23:59:59.999, not the next midnight.
    let end_of_day = end_naive
        .and_hms_milli_opt(23, 59, 59, 999)
        .expect("23:59:59.999 is always a valid time");

    let start = resolve_earliest(start_of_day, tz).with_timezone(&Utc);
    let end = resolve_earliest(end_of_day, tz).with_timezone(&Utc);

    Ok(SyncWindow {
        start: start.to_rfc3339(),
        end: end.to_rfc3339(),
    })
}

/// Resolves a naive local date/time to a concrete instant in `tz`, choosing
/// the earliest sensible interpretation — matching what `dayjs` does.
///
/// `NaiveDateTime::and_local_timezone` returns a `LocalResult` rather than
/// a plain `DateTime` because a wall-clock reading does not always
/// correspond to exactly one instant in time:
///
/// - `Single` is the ordinary case: the wall-clock time occurs exactly
///   once, on an ordinary day with no transition.
/// - `Ambiguous(earlier, later)` happens on a fall-back day (clocks move
///   back an hour), where the same wall-clock time occurs twice — once
///   before the transition and once after. `dayjs` resolves this by taking
///   the earlier instant, so this does too.
/// - `None` happens on a spring-forward day (clocks skip an hour ahead),
///   where that wall-clock time is skipped entirely and never occurs —
///   e.g. if 01:00 jumps straight to 02:00, every wall-clock reading in
///   between is not a real local time on that day. There is nothing wrong
///   with the *date* here, only with this specific reading of it, so this
///   does not error: it steps forward in one-minute increments until it
///   finds the first instant that *does* exist, which is the correct
///   "first moment of the day" when the nominal first moment doesn't
///   exist.
fn resolve_earliest(naive: NaiveDateTime, tz: Tz) -> DateTime<Tz> {
    match naive.and_local_timezone(tz) {
        LocalResult::Single(dt) => dt,
        LocalResult::Ambiguous(earlier, _later) => earlier,
        LocalResult::None => {
            let mut candidate = naive;
            loop {
                candidate += Duration::minutes(1);
                match candidate.and_local_timezone(tz) {
                    LocalResult::Single(dt) => break dt,
                    LocalResult::Ambiguous(earlier, _later) => break earlier,
                    LocalResult::None => continue,
                }
            }
        }
    }
}

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
