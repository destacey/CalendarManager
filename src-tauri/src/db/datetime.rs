//! Reading the datetimes that are actually in the `events` table.
//!
//! Microsoft Graph's `dateTime` is stored verbatim by `graph::transform`, and
//! Graph sends seven fractional digits: `2026-09-01T09:00:00.0000000`. An
//! event synced before a start time existed instead carries the RFC 3339
//! fallback that transform writes, which has an offset. A parser that accepts
//! only `%Y-%m-%dT%H:%M:%S` therefore matches almost nothing that is really
//! in the database — and because both callers treat a parse failure as zero
//! minutes, that failure is silent: every duration comes out as 0.00 hours
//! with no error anywhere.
//!
//! This module exists so there is one answer to "how long was this event",
//! shared by the timecard and the Map Events grouping.

use chrono::NaiveDateTime;

/// Parses a stored event datetime in any of the forms that reach the table.
///
/// An offset form is converted to UTC. Mixing forms across a single event's
/// start and end would be meaningless, but cannot happen: both come from the
/// same Graph payload, or from the same fallback.
pub fn parse_stored(value: &str) -> Option<NaiveDateTime> {
    // Fractional seconds are optional in this format, so it covers both the
    // seven-digit Graph form and a clean one.
    NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f")
        .ok()
        .or_else(|| {
            chrono::DateTime::parse_from_rfc3339(value)
                .ok()
                .map(|dt| dt.naive_utc())
        })
}

/// Minutes from `start` to `end`, never negative.
///
/// A missing or unparseable end contributes nothing rather than failing the
/// caller: one malformed row must not take out a whole timecard.
pub fn minutes_between(start: &str, end: Option<&str>) -> i64 {
    let Some(end) = end else { return 0 };
    match (parse_stored(start), parse_stored(end)) {
        (Some(a), Some(b)) => (b - a).num_minutes().max(0),
        _ => 0,
    }
}

/// The date half of a stored datetime.
pub fn day_of(datetime: &str) -> String {
    datetime.chars().take(10).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The form Graph actually sends, and the one that used to parse as zero.
    #[test]
    fn reads_graphs_seven_fractional_digits() {
        assert_eq!(
            minutes_between(
                "2026-09-01T09:00:00.0000000",
                Some("2026-09-01T10:30:00.0000000")
            ),
            90
        );
    }

    #[test]
    fn reads_a_plain_datetime() {
        assert_eq!(
            minutes_between("2026-09-01T09:00:00", Some("2026-09-01T10:00:00")),
            60
        );
    }

    /// `transform`'s fallback for an event with no start time is RFC 3339.
    #[test]
    fn reads_the_rfc3339_fallback_with_an_offset() {
        assert_eq!(
            minutes_between("2026-09-01T09:00:00+00:00", Some("2026-09-01T09:45:00+00:00")),
            45
        );
    }

    #[test]
    fn reads_a_z_suffixed_datetime() {
        assert_eq!(
            minutes_between("2026-09-01T09:00:00Z", Some("2026-09-01T11:00:00Z")),
            120
        );
    }

    #[test]
    fn crosses_midnight() {
        assert_eq!(
            minutes_between("2026-09-01T23:00:00.0000000", Some("2026-09-02T01:00:00.0000000")),
            120
        );
    }

    /// An end before its start is nonsense, and negative hours are worse.
    #[test]
    fn never_returns_negative_minutes() {
        assert_eq!(
            minutes_between("2026-09-01T10:00:00", Some("2026-09-01T09:00:00")),
            0
        );
    }

    #[test]
    fn contributes_nothing_for_a_missing_or_unreadable_end() {
        assert_eq!(minutes_between("2026-09-01T09:00:00", None), 0);
        assert_eq!(minutes_between("2026-09-01T09:00:00", Some("not a date")), 0);
    }

    #[test]
    fn takes_the_date_from_any_form() {
        assert_eq!(day_of("2026-09-01T09:00:00.0000000"), "2026-09-01");
        assert_eq!(day_of("2026-09-01"), "2026-09-01");
    }
}
