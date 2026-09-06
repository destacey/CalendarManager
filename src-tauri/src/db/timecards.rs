// Timecards: a period, and the entries that make it up.
//
// A timecard PULLS from events. Events never depend on it. The calendar is the
// source of truth for what happened; the timecard is the record of what is
// billed, and it is allowed to differ - that is the whole point of it being a
// separate layer.
//
// Generation is a snapshot, not a live view. Once generated, entries stay put
// until someone asks for a refresh, so a colleague moving a meeting cannot
// rewrite a timecard that has already been submitted.

use std::collections::HashSet;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::error::{DbError, DbResult};

const TIMECARD_COLUMNS: &str =
    "id, name, start_date, end_date, status, created_at, generated_at, submitted_at";

const ENTRY_COLUMNS: &str = "id, timecard_id, event_id, date, hours, project_id, activity_id, \
                             source, note, created_at";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Timecard {
    pub id: Option<i64>,
    pub name: String,
    pub start_date: String,
    pub end_date: String,
    /// `draft` or `submitted`. A submitted timecard refuses edits.
    pub status: String,
    pub created_at: Option<String>,
    pub generated_at: Option<String>,
    pub submitted_at: Option<String>,
}

impl Timecard {
    fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            name: row.get("name")?,
            start_date: row.get("start_date")?,
            end_date: row.get("end_date")?,
            status: row.get("status")?,
            created_at: row.get("created_at")?,
            generated_at: row.get("generated_at")?,
            submitted_at: row.get("submitted_at")?,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimecardEntry {
    pub id: Option<i64>,
    pub timecard_id: i64,
    /// `None` once the event it came from has been deleted. The entry survives.
    pub event_id: Option<i64>,
    pub date: String,
    pub hours: f64,
    pub project_id: Option<i64>,
    pub activity_id: Option<i64>,
    /// What owns this entry, and therefore what a regeneration may do to it:
    ///
    /// - `event`   generated from a calendar event; replaced on every refresh.
    /// - `manual`  an item the user added or edited. Never replaced. If it
    ///             still carries an `event_id`, that event's time on that date
    ///             is theirs now, so generation stops producing it.
    /// - `cell`    the user typed a number over a whole grid cell. Never
    ///             replaced, and no event may add to that cell again.
    pub source: String,
    pub note: Option<String>,
    pub created_at: Option<String>,
}

impl TimecardEntry {
    fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            timecard_id: row.get("timecard_id")?,
            event_id: row.get("event_id")?,
            date: row.get("date")?,
            hours: row.get("hours")?,
            project_id: row.get("project_id")?,
            activity_id: row.get("activity_id")?,
            source: row.get("source")?,
            note: row.get("note")?,
            created_at: row.get("created_at")?,
        })
    }
}

#[derive(Debug, Deserialize)]
pub struct NewTimecard {
    pub name: String,
    pub start_date: String,
    pub end_date: String,
}

/// What a caller supplies for a hand-made or hand-edited entry.
#[derive(Debug, Deserialize)]
pub struct EntryInput {
    #[serde(default)]
    pub event_id: Option<i64>,
    pub date: String,
    pub hours: f64,
    #[serde(default)]
    pub project_id: Option<i64>,
    #[serde(default)]
    pub activity_id: Option<i64>,
    #[serde(default)]
    pub note: Option<String>,
}

/// Which days a multi-day all-day event is spread across, and what one day of
/// each event type is worth. Passed in rather than read here, because these
/// are user settings that live in `config.json` on the frontend side.
#[derive(Debug, Clone, Deserialize)]
pub struct GenerationSettings {
    /// 0 = Sunday .. 6 = Saturday.
    pub working_days: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GenerationResult {
    /// Events the period contained.
    pub events_read: usize,
    /// Entries written from those events.
    pub entries_created: usize,
    /// Existing hand-made or hand-edited entries left exactly as they were.
    pub manual_entries_kept: usize,
    /// Events with no project, which produce no entry and need attention.
    pub unmapped_events: usize,
}

pub fn list_timecards(conn: &Connection) -> DbResult<Vec<Timecard>> {
    let sql = format!("SELECT {TIMECARD_COLUMNS} FROM timecards ORDER BY start_date DESC, id DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], Timecard::from_row)?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn get_timecard(conn: &Connection, id: i64) -> DbResult<Option<Timecard>> {
    let sql = format!("SELECT {TIMECARD_COLUMNS} FROM timecards WHERE id = ?1");
    Ok(conn.query_row(&sql, params![id], Timecard::from_row).optional()?)
}

pub fn create_timecard(conn: &Connection, input: &NewTimecard) -> DbResult<Timecard> {
    if input.end_date < input.start_date {
        return Err(DbError::Other(
            "A timecard's end date cannot be before its start date.".to_string(),
        ));
    }

    conn.execute(
        "INSERT INTO timecards (name, start_date, end_date) VALUES (?1, ?2, ?3)",
        params![input.name, input.start_date, input.end_date],
    )?;

    let id = conn.last_insert_rowid();
    get_timecard(conn, id)?
        .ok_or_else(|| DbError::Other(format!("timecard {id} vanished immediately after insert")))
}

pub fn delete_timecard(conn: &Connection, id: i64) -> DbResult<bool> {
    let changed = conn.execute("DELETE FROM timecards WHERE id = ?1", params![id])?;
    Ok(changed > 0)
}

pub fn list_entries(conn: &Connection, timecard_id: i64) -> DbResult<Vec<TimecardEntry>> {
    let sql = format!(
        "SELECT {ENTRY_COLUMNS} FROM timecard_entries WHERE timecard_id = ?1 ORDER BY date, id"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![timecard_id], TimecardEntry::from_row)?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Refuses any write to a submitted timecard. Called by every mutating path,
/// because a submitted timecard that quietly changes is worse than one that
/// cannot be edited at all.
fn ensure_editable(conn: &Connection, timecard_id: i64) -> DbResult<()> {
    let status: Option<String> = conn
        .query_row(
            "SELECT status FROM timecards WHERE id = ?1",
            params![timecard_id],
            |r| r.get(0),
        )
        .optional()?;

    match status.as_deref() {
        Some("submitted") => Err(DbError::Other(
            "This timecard has been submitted. Reopen it before making changes.".to_string(),
        )),
        Some(_) => Ok(()),
        None => Err(DbError::Other(format!("timecard {timecard_id} does not exist"))),
    }
}

pub fn submit_timecard(conn: &Connection, id: i64) -> DbResult<Option<Timecard>> {
    let changed = conn.execute(
        "UPDATE timecards SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP
         WHERE id = ?1 AND status != 'submitted'",
        params![id],
    )?;
    if changed == 0 {
        return get_timecard(conn, id);
    }
    get_timecard(conn, id)
}

pub fn reopen_timecard(conn: &Connection, id: i64) -> DbResult<Option<Timecard>> {
    conn.execute(
        "UPDATE timecards SET status = 'draft', submitted_at = NULL WHERE id = ?1",
        params![id],
    )?;
    get_timecard(conn, id)
}

/// Adds an entry a human made, which no regeneration will ever replace.
pub fn add_manual_entry(
    conn: &Connection,
    timecard_id: i64,
    input: &EntryInput,
) -> DbResult<TimecardEntry> {
    ensure_editable(conn, timecard_id)?;

    conn.execute(
        "INSERT INTO timecard_entries
         (timecard_id, event_id, date, hours, project_id, activity_id, source, note)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'manual', ?7)",
        params![
            timecard_id,
            input.event_id,
            input.date,
            input.hours,
            input.project_id,
            input.activity_id,
            input.note
        ],
    )?;

    let id = conn.last_insert_rowid();
    let sql = format!("SELECT {ENTRY_COLUMNS} FROM timecard_entries WHERE id = ?1");
    Ok(conn.query_row(&sql, params![id], TimecardEntry::from_row)?)
}

/// Editing a generated entry promotes it to `manual`, so a later regeneration
/// leaves it alone. Editing IS the act of taking ownership.
pub fn update_entry(
    conn: &Connection,
    id: i64,
    input: &EntryInput,
) -> DbResult<Option<TimecardEntry>> {
    let timecard_id: Option<i64> = conn
        .query_row(
            "SELECT timecard_id FROM timecard_entries WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?;

    let Some(timecard_id) = timecard_id else {
        return Ok(None);
    };
    ensure_editable(conn, timecard_id)?;

    conn.execute(
        "UPDATE timecard_entries
         SET date = ?1, hours = ?2, project_id = ?3, activity_id = ?4, note = ?5,
             source = 'manual'
         WHERE id = ?6",
        params![
            input.date,
            input.hours,
            input.project_id,
            input.activity_id,
            input.note,
            id
        ],
    )?;

    let sql = format!("SELECT {ENTRY_COLUMNS} FROM timecard_entries WHERE id = ?1");
    Ok(conn.query_row(&sql, params![id], TimecardEntry::from_row).optional()?)
}

pub fn delete_entry(conn: &Connection, id: i64) -> DbResult<bool> {
    let timecard_id: Option<i64> = conn
        .query_row(
            "SELECT timecard_id FROM timecard_entries WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?;

    let Some(timecard_id) = timecard_id else {
        return Ok(false);
    };
    ensure_editable(conn, timecard_id)?;

    let changed = conn.execute("DELETE FROM timecard_entries WHERE id = ?1", params![id])?;
    Ok(changed > 0)
}

/// One cell of the week grid: a day, a project and an activity.
#[derive(Debug, Clone, Deserialize)]
pub struct CellInput {
    pub date: String,
    pub project_id: Option<i64>,
    pub activity_id: Option<i64>,
    pub hours: f64,
}

/// Sets what one grid cell is worth, replacing whatever was behind it.
///
/// A cell can be backed by several entries - three meetings on the same
/// project and activity on the same day. Typing a number over it is the user
/// saying "this is what that day was worth", so everything behind it goes and
/// one `cell` entry takes its place. A refresh then neither replaces that
/// entry nor adds event time back into the cell beside it - which is the
/// difference between typing over a cell and adding an item to a day.
///
/// Zero (or less) clears the cell instead of storing a zero-hour entry.
///
/// The whole thing is one transaction, so a cell can never be left with its
/// old entries deleted and no replacement written.
pub fn set_cell(
    conn: &Connection,
    timecard_id: i64,
    cell: &CellInput,
) -> DbResult<Option<TimecardEntry>> {
    ensure_editable(conn, timecard_id)?;

    // `IS` rather than `=`, because a cell is identified by NULLs as much as
    // by ids: the Unassigned row and the no-activity row are real rows.
    const MATCH: &str = "timecard_id = ?1 AND date = ?2 AND project_id IS ?3 AND activity_id IS ?4";

    let tx = conn.unchecked_transaction()?;

    // A note is the one thing the entries carry that the cell cannot show, so
    // it is carried forward rather than dropped when a single entry is being
    // replaced. Several notes cannot be merged into one, so those are left to
    // the day view, which can show them individually.
    let sql = format!(
        "SELECT note FROM timecard_entries WHERE {MATCH} AND note IS NOT NULL AND note != ''"
    );
    let notes: Vec<String> = tx
        .prepare(&sql)?
        .query_map(
            params![timecard_id, cell.date, cell.project_id, cell.activity_id],
            |r| r.get(0),
        )?
        .collect::<Result<_, _>>()?;
    let note = if notes.len() == 1 { notes.into_iter().next() } else { None };

    tx.execute(
        &format!("DELETE FROM timecard_entries WHERE {MATCH}"),
        params![timecard_id, cell.date, cell.project_id, cell.activity_id],
    )?;

    if cell.hours <= 0.0 {
        tx.commit()?;
        return Ok(None);
    }

    tx.execute(
        "INSERT INTO timecard_entries
         (timecard_id, event_id, date, hours, project_id, activity_id, source, note)
         VALUES (?1, NULL, ?2, ?3, ?4, ?5, 'cell', ?6)",
        params![timecard_id, cell.date, cell.hours, cell.project_id, cell.activity_id, note],
    )?;

    let id = tx.last_insert_rowid();
    let sql = format!("SELECT {ENTRY_COLUMNS} FROM timecard_entries WHERE id = ?1");
    let entry = tx.query_row(&sql, params![id], TimecardEntry::from_row)?;
    tx.commit()?;
    Ok(Some(entry))
}

/// One event, as generation needs to see it.
struct SourceEvent {
    id: i64,
    start_date: String,
    end_date: Option<String>,
    is_all_day: bool,
    project_id: Option<i64>,
    activity_id: Option<i64>,
    all_day_hours: f64,
}

/// Builds (or rebuilds) the entries for a timecard from the events in its
/// period.
///
/// Replaces every `event`-sourced entry and touches nothing the user owns.
/// That is what makes a refresh safe: anything a human made, edited or typed
/// over is theirs, and regeneration only owns what it generated - including
/// not re-creating an event's entry beside the user's own version of it.
///
/// An event with no project produces no entry - it is counted and reported so
/// the UI can say "9 events still need a project" rather than silently
/// dropping time.
pub fn generate_entries(
    conn: &Connection,
    timecard_id: i64,
    settings: &GenerationSettings,
) -> DbResult<GenerationResult> {
    ensure_editable(conn, timecard_id)?;

    let card = get_timecard(conn, timecard_id)?
        .ok_or_else(|| DbError::Other(format!("timecard {timecard_id} does not exist")))?;

    let events = read_events_in_period(conn, &card.start_date, &card.end_date)?;

    let manual_kept: i64 = conn.query_row(
        "SELECT COUNT(*) FROM timecard_entries WHERE timecard_id = ?1 AND source != 'event'",
        params![timecard_id],
        |r| r.get(0),
    )?;

    // One event's time on one date, already taken over by the user - they
    // edited the entry it produced, or moved it to another project. Generating
    // it again would count those hours twice.
    let claimed: HashSet<(i64, String)> = conn
        .prepare(
            "SELECT event_id, date FROM timecard_entries
             WHERE timecard_id = ?1 AND source != 'event' AND event_id IS NOT NULL",
        )?
        .query_map(params![timecard_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;

    // A whole cell the user typed a number into. Nothing may be added to it.
    let owned: HashSet<(String, Option<i64>, Option<i64>)> = conn
        .prepare(
            "SELECT date, project_id, activity_id FROM timecard_entries
             WHERE timecard_id = ?1 AND source = 'cell'",
        )?
        .query_map(params![timecard_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;

    let working: HashSet<u32> = settings.working_days.iter().copied().collect();

    let tx = conn.unchecked_transaction()?;

    // Only generated entries are replaced. Manual ones are untouchable.
    tx.execute(
        "DELETE FROM timecard_entries WHERE timecard_id = ?1 AND source = 'event'",
        params![timecard_id],
    )?;

    let mut created = 0usize;
    let mut unmapped = 0usize;

    for event in &events {
        let Some(project_id) = event.project_id else {
            unmapped += 1;
            continue;
        };

        for (date, hours) in event_days(event, &working) {
            // Per date, not per event: overriding one Wednesday of a week-long
            // block leaves the other four days to regenerate normally.
            if claimed.contains(&(event.id, date.clone()))
                || owned.contains(&(date.clone(), Some(project_id), event.activity_id))
            {
                continue;
            }

            tx.execute(
                "INSERT INTO timecard_entries
                 (timecard_id, event_id, date, hours, project_id, activity_id, source)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'event')",
                params![timecard_id, event.id, date, hours, project_id, event.activity_id],
            )?;
            created += 1;
        }
    }

    tx.execute(
        "UPDATE timecards SET generated_at = CURRENT_TIMESTAMP WHERE id = ?1",
        params![timecard_id],
    )?;

    tx.commit()?;

    Ok(GenerationResult {
        events_read: events.len(),
        entries_created: created,
        manual_entries_kept: manual_kept as usize,
        unmapped_events: unmapped,
    })
}

fn read_events_in_period(
    conn: &Connection,
    start: &str,
    end: &str,
) -> DbResult<Vec<SourceEvent>> {
    // The period is given as dates; events are stored as datetimes, so the end
    // is compared against the end of that day rather than its midnight.
    let mut stmt = conn.prepare(
        "SELECT e.id, e.start_date, e.end_date, COALESCE(e.is_all_day, 0),
                e.project_id, e.activity_id, COALESCE(t.all_day_hours, 8)
         FROM events e
         LEFT JOIN event_types t ON t.id = e.type_id
         WHERE e.start_date >= ?1 AND e.start_date <= ?2 || 'T23:59:59'
         ORDER BY e.start_date, e.id",
    )?;

    let rows = stmt.query_map(params![start, end], |row| {
        Ok(SourceEvent {
            id: row.get(0)?,
            start_date: row.get(1)?,
            end_date: row.get(2)?,
            is_all_day: row.get(3)?,
            project_id: row.get(4)?,
            activity_id: row.get(5)?,
            all_day_hours: row.get(6)?,
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// The (date, hours) pairs one event contributes.
///
/// A timed event is one entry on its own day. An all-day event is one entry
/// per working day it covers, each worth its type's `all_day_hours` - which is
/// why a five-day block is 40 hours and not 120.
fn event_days(event: &SourceEvent, working_days: &HashSet<u32>) -> Vec<(String, f64)> {
    if !event.is_all_day {
        let hours = timed_hours(&event.start_date, event.end_date.as_deref());
        return vec![(day_of(&event.start_date), hours)];
    }

    if event.all_day_hours <= 0.0 {
        // 0 means "does not count" - no entries at all, not entries of zero.
        return Vec::new();
    }

    all_day_dates(&event.start_date, event.end_date.as_deref(), working_days)
        .into_iter()
        .map(|date| (date, event.all_day_hours))
        .collect()
}

fn day_of(datetime: &str) -> String {
    datetime.chars().take(10).collect()
}

fn timed_hours(start: &str, end: Option<&str>) -> f64 {
    let Some(end) = end else { return 0.0 };
    let parse = |s: &str| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").ok();
    match (parse(start), parse(end)) {
        (Some(a), Some(b)) => ((b - a).num_minutes().max(0) as f64) / 60.0,
        _ => 0.0,
    }
}

/// Mirrors `src/utils/allDayHours.ts` exactly, and for the same reasons:
/// Graph's end date is exclusive; a single-day event is never filtered; a
/// multi-day one drops non-working days unless that would leave nothing.
fn all_day_dates(start: &str, end: Option<&str>, working_days: &HashSet<u32>) -> Vec<String> {
    use chrono::{Datelike, Duration, NaiveDate};

    let Ok(first) = NaiveDate::parse_from_str(&day_of(start), "%Y-%m-%d") else {
        return Vec::new();
    };

    let mut last = first;
    if let Some(end) = end {
        if let Ok(exclusive) = NaiveDate::parse_from_str(&day_of(end), "%Y-%m-%d") {
            let inclusive = exclusive - Duration::days(1);
            if inclusive > first {
                last = inclusive;
            }
        }
    }

    let mut days = Vec::new();
    let mut cursor = first;
    while cursor <= last {
        days.push(cursor);
        cursor += Duration::days(1);
    }

    if days.len() <= 1 {
        return days.into_iter().map(|d| d.to_string()).collect();
    }

    let working: Vec<NaiveDate> = days
        .iter()
        .copied()
        .filter(|d| working_days.contains(&d.weekday().num_days_from_sunday()))
        .collect();

    let chosen = if working.is_empty() { days } else { working };
    chosen.into_iter().map(|d| d.to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::run_migrations;

    const MON: &str = "2026-10-05";

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, code) VALUES (1, 'Rebuild', 'PRJ-001')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO event_types (id, name, is_billable, all_day_hours)
             VALUES (10, 'Work', 1, 8), (11, 'Holiday', 0, 0)",
            [],
        )
        .unwrap();
        conn
    }

    fn card(conn: &Connection) -> i64 {
        create_timecard(
            conn,
            &NewTimecard {
                name: "October".into(),
                start_date: "2026-10-01".into(),
                end_date: "2026-10-31".into(),
            },
        )
        .unwrap()
        .id
        .unwrap()
    }

    fn settings() -> GenerationSettings {
        GenerationSettings { working_days: vec![1, 2, 3, 4, 5] }
    }

    fn entry(date: &str, hours: f64) -> EntryInput {
        EntryInput {
            event_id: None,
            date: date.into(),
            hours,
            project_id: Some(1),
            activity_id: None,
            note: None,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn add_event(
        conn: &Connection,
        id: i64,
        start: &str,
        end: &str,
        all_day: bool,
        project: Option<i64>,
        activity: Option<i64>,
        type_id: i64,
    ) {
        conn.execute(
            "INSERT INTO events (id, title, start_date, end_date, is_all_day, project_id, activity_id, type_id)
             VALUES (?1, 'E', ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, start, end, all_day, project, activity, type_id],
        )
        .unwrap();
    }

    fn entry_dates(conn: &Connection, tc: i64) -> Vec<String> {
        list_entries(conn, tc).unwrap().into_iter().map(|e| e.date).collect()
    }

    fn total_hours(conn: &Connection, tc: i64) -> f64 {
        list_entries(conn, tc).unwrap().iter().map(|e| e.hours).sum()
    }

    // --- the period ---

    #[test]
    fn a_timecard_cannot_end_before_it_starts() {
        let conn = setup();

        let err = create_timecard(
            &conn,
            &NewTimecard {
                name: "Backwards".into(),
                start_date: "2026-10-31".into(),
                end_date: "2026-10-01".into(),
            },
        );

        assert!(err.is_err());
    }

    #[test]
    fn generation_only_reads_events_inside_the_period() {
        let conn = setup();
        let tc = card(&conn);
        add_event(&conn, 1, "2026-10-15T09:00:00", "2026-10-15T10:00:00", false, Some(1), None, 10);
        add_event(&conn, 2, "2026-11-15T09:00:00", "2026-11-15T10:00:00", false, Some(1), None, 10);

        let result = generate_entries(&conn, tc, &settings()).unwrap();

        assert_eq!(result.events_read, 1);
        assert_eq!(entry_dates(&conn, tc), vec!["2026-10-15"]);
    }

    /// The period is given as dates but events are datetimes, so an event at
    /// 09:00 on the last day has to be inside it.
    #[test]
    fn an_event_on_the_final_day_is_included() {
        let conn = setup();
        let tc = card(&conn);
        add_event(&conn, 1, "2026-10-31T09:00:00", "2026-10-31T10:00:00", false, Some(1), None, 10);

        generate_entries(&conn, tc, &settings()).unwrap();

        assert_eq!(entry_dates(&conn, tc), vec!["2026-10-31"]);
    }

    // --- what an event is worth ---

    #[test]
    fn a_timed_event_is_one_entry_of_its_own_length() {
        let conn = setup();
        let tc = card(&conn);
        add_event(&conn, 1, "2026-10-05T09:00:00", "2026-10-05T10:30:00", false, Some(1), Some(3), 10);

        generate_entries(&conn, tc, &settings()).unwrap();

        let entries = list_entries(&conn, tc).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].hours, 1.5);
        assert_eq!(entries[0].activity_id, Some(3));
        assert_eq!(entries[0].source, "event");
    }

    /// The number the calendar deliberately refuses to invent: a five-day
    /// block is 40 hours, not 120.
    #[test]
    fn a_working_week_of_all_day_is_five_entries_of_eight_hours() {
        let conn = setup();
        let tc = card(&conn);
        // Graph's end is exclusive: Mon -> Sat means Mon..Fri.
        add_event(&conn, 1, "2026-10-05T00:00:00", "2026-10-10T00:00:00", true, Some(1), None, 10);

        generate_entries(&conn, tc, &settings()).unwrap();

        assert_eq!(entry_dates(&conn, tc).len(), 5);
        assert_eq!(total_hours(&conn, tc), 40.0);
    }

    #[test]
    fn a_monday_to_sunday_block_drops_the_weekend() {
        let conn = setup();
        let tc = card(&conn);
        add_event(&conn, 1, "2026-10-05T00:00:00", "2026-10-12T00:00:00", true, Some(1), None, 10);

        generate_entries(&conn, tc, &settings()).unwrap();

        assert_eq!(entry_dates(&conn, tc).len(), 5, "seven days, five of them working");
        assert_eq!(total_hours(&conn, tc), 40.0);
    }

    /// Booking one Saturday is deliberate, so it is never filtered away.
    #[test]
    fn a_single_all_day_saturday_still_counts() {
        let conn = setup();
        let tc = card(&conn);
        add_event(&conn, 1, "2026-10-10T00:00:00", "2026-10-11T00:00:00", true, Some(1), None, 10);

        generate_entries(&conn, tc, &settings()).unwrap();

        assert_eq!(entry_dates(&conn, tc), vec!["2026-10-10"]);
        assert_eq!(total_hours(&conn, tc), 8.0);
    }

    /// A span with no working days at all is as deliberate as a single
    /// Saturday, so it keeps its days rather than vanishing.
    #[test]
    fn a_weekend_only_block_keeps_both_days() {
        let conn = setup();
        let tc = card(&conn);
        add_event(&conn, 1, "2026-10-10T00:00:00", "2026-10-12T00:00:00", true, Some(1), None, 10);

        generate_entries(&conn, tc, &settings()).unwrap();

        assert_eq!(entry_dates(&conn, tc).len(), 2);
        assert_eq!(total_hours(&conn, tc), 16.0);
    }

    /// 0 hours is how a Holiday type opts out: no entries at all, rather than
    /// entries worth nothing cluttering the card.
    #[test]
    fn an_all_day_event_of_a_zero_hour_type_produces_nothing() {
        let conn = setup();
        let tc = card(&conn);
        add_event(&conn, 1, "2026-10-05T00:00:00", "2026-10-10T00:00:00", true, Some(1), None, 11);

        let result = generate_entries(&conn, tc, &settings()).unwrap();

        assert_eq!(result.entries_created, 0);
        assert_eq!(list_entries(&conn, tc).unwrap().len(), 0);
    }

    #[test]
    fn a_four_day_week_produces_four_entries() {
        let conn = setup();
        let tc = card(&conn);
        add_event(&conn, 1, "2026-10-05T00:00:00", "2026-10-10T00:00:00", true, Some(1), None, 10);

        generate_entries(&conn, tc, &GenerationSettings { working_days: vec![1, 2, 3, 4] }).unwrap();

        assert_eq!(entry_dates(&conn, tc).len(), 4);
    }

    // --- unmapped ---

    #[test]
    fn an_unmapped_event_produces_no_entry_but_is_reported() {
        let conn = setup();
        let tc = card(&conn);
        add_event(&conn, 1, "2026-10-05T09:00:00", "2026-10-05T10:00:00", false, None, None, 10);

        let result = generate_entries(&conn, tc, &settings()).unwrap();

        assert_eq!(result.events_read, 1);
        assert_eq!(result.entries_created, 0);
        assert_eq!(result.unmapped_events, 1, "counted, so the UI can say what needs attention");
    }

    // --- regeneration and ownership ---

    #[test]
    fn regenerating_replaces_generated_entries_rather_than_duplicating_them() {
        let conn = setup();
        let tc = card(&conn);
        add_event(&conn, 1, "2026-10-05T09:00:00", "2026-10-05T10:00:00", false, Some(1), None, 10);
        generate_entries(&conn, tc, &settings()).unwrap();

        generate_entries(&conn, tc, &settings()).unwrap();

        assert_eq!(list_entries(&conn, tc).unwrap().len(), 1);
    }

    /// The promise that makes a refresh safe to press.
    #[test]
    fn regenerating_never_touches_a_manual_entry() {
        let conn = setup();
        let tc = card(&conn);
        let mut manual = entry(MON, 3.0);
        manual.note = Some("Phone call, no calendar entry".into());
        add_manual_entry(&conn, tc, &manual).unwrap();

        let result = generate_entries(&conn, tc, &settings()).unwrap();

        assert_eq!(result.manual_entries_kept, 1);
        let entries = list_entries(&conn, tc).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].hours, 3.0);
        assert_eq!(entries[0].note.as_deref(), Some("Phone call, no calendar entry"));
    }

    /// Editing a generated entry IS the act of taking ownership of it.
    #[test]
    fn editing_a_generated_entry_promotes_it_and_protects_it() {
        let conn = setup();
        let tc = card(&conn);
        add_event(&conn, 1, "2026-10-05T09:00:00", "2026-10-05T10:00:00", false, Some(1), None, 10);
        generate_entries(&conn, tc, &settings()).unwrap();
        let generated = list_entries(&conn, tc).unwrap().remove(0);

        let updated = update_entry(&conn, generated.id.unwrap(), &entry(MON, 2.0))
            .unwrap()
            .unwrap();
        assert_eq!(updated.source, "manual");

        generate_entries(&conn, tc, &settings()).unwrap();

        let after = list_entries(&conn, tc).unwrap();
        // Not two. Regenerating the event beside the user's own version of it
        // would count that hour twice.
        assert_eq!(after.len(), 1, "the event must not regenerate beside the edit");
        assert_eq!(after[0].hours, 2.0);
        assert_eq!(after[0].source, "manual");
    }

    /// Moving an entry to another project frees its original cell, so the cell
    /// check alone would let the event refill it - the claim is what stops it.
    #[test]
    fn moving_an_entry_to_another_project_does_not_leave_its_event_to_regenerate() {
        let conn = setup();
        let tc = card(&conn);
        conn.execute("INSERT INTO projects (id, name, code) VALUES (2, 'Billing', 'PRJ-002')", [])
            .unwrap();
        add_event(&conn, 1, "2026-10-05T09:00:00", "2026-10-05T10:00:00", false, Some(1), None, 10);
        generate_entries(&conn, tc, &settings()).unwrap();
        let generated = list_entries(&conn, tc).unwrap().remove(0);

        update_entry(&conn, generated.id.unwrap(), &EntryInput {
            project_id: Some(2), ..entry(MON, 1.0)
        })
        .unwrap();
        generate_entries(&conn, tc, &settings()).unwrap();

        let after = list_entries(&conn, tc).unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].project_id, Some(2));
    }

    /// Ownership is per date, not per event: a week of PTO with one day
    /// corrected must still regenerate the other four.
    #[test]
    fn overriding_one_day_of_a_multi_day_event_leaves_the_rest_generating() {
        let conn = setup();
        let tc = card(&conn);
        // Mon 5th to Fri 9th; Graph's end date is exclusive.
        add_event(&conn, 1, "2026-10-05", "2026-10-10", true, Some(1), None, 10);
        generate_entries(&conn, tc, &settings()).unwrap();
        assert_eq!(list_entries(&conn, tc).unwrap().len(), 5);

        set_cell(&conn, tc, &cell("2026-10-07", 4.0)).unwrap();
        generate_entries(&conn, tc, &settings()).unwrap();

        let after = list_entries(&conn, tc).unwrap();
        assert_eq!(after.len(), 5);
        let wednesday = after.iter().find(|e| e.date == "2026-10-07").unwrap();
        assert_eq!(wednesday.hours, 4.0);
        assert_eq!(wednesday.source, "cell");
        assert!(after.iter().filter(|e| e.date != "2026-10-07").all(|e| e.hours == 8.0));
    }

    /// Adding an item to a day is not the same as typing over the cell: the
    /// added time is extra, and the event's time still belongs there.
    #[test]
    fn an_added_item_does_not_stop_events_filling_its_cell() {
        let conn = setup();
        let tc = card(&conn);
        add_event(&conn, 1, "2026-10-05T09:00:00", "2026-10-05T11:00:00", false, Some(1), None, 10);
        add_manual_entry(&conn, tc, &entry(MON, 1.0)).unwrap();

        generate_entries(&conn, tc, &settings()).unwrap();

        let after = list_entries(&conn, tc).unwrap();
        assert_eq!(after.len(), 2, "the addition and the event's own time");
        assert_eq!(after.iter().map(|e| e.hours).sum::<f64>(), 3.0);
    }

    // --- submitted timecards ---

    #[test]
    fn a_submitted_timecard_refuses_edits() {
        let conn = setup();
        let tc = card(&conn);
        submit_timecard(&conn, tc).unwrap();

        let added = add_manual_entry(&conn, tc, &entry(MON, 1.0));
        let generated = generate_entries(&conn, tc, &settings());

        assert!(added.is_err(), "a submitted timecard must not accept new entries");
        assert!(generated.is_err(), "nor be regenerated underneath its owner");
        assert!(format!("{}", added.unwrap_err()).contains("Reopen it"));
    }

    #[test]
    fn reopening_makes_it_editable_again() {
        let conn = setup();
        let tc = card(&conn);
        submit_timecard(&conn, tc).unwrap();

        reopen_timecard(&conn, tc).unwrap();

        assert!(add_manual_entry(&conn, tc, &entry(MON, 1.0)).is_ok());
        assert_eq!(get_timecard(&conn, tc).unwrap().unwrap().status, "draft");
    }

    #[test]
    fn submitting_stamps_the_time_and_is_idempotent() {
        let conn = setup();
        let tc = card(&conn);

        let first = submit_timecard(&conn, tc).unwrap().unwrap();
        let second = submit_timecard(&conn, tc).unwrap().unwrap();

        assert_eq!(first.status, "submitted");
        assert!(first.submitted_at.is_some());
        assert_eq!(first.submitted_at, second.submitted_at, "re-submitting must not re-stamp");
    }

    // --- an entry outliving its event ---

    #[test]
    fn an_entry_survives_its_event_being_deleted_by_a_sync() {
        let conn = setup();
        let tc = card(&conn);
        add_event(&conn, 1, "2026-10-05T09:00:00", "2026-10-05T10:00:00", false, Some(1), None, 10);
        generate_entries(&conn, tc, &settings()).unwrap();

        // Exactly what cleanup_range does when Graph stops returning an event.
        conn.execute("DELETE FROM events WHERE id = 1", []).unwrap();

        let entries = list_entries(&conn, tc).unwrap();
        assert_eq!(entries.len(), 1, "the record that work was done must survive");
        assert_eq!(entries[0].event_id, None);
        assert_eq!(entries[0].hours, 1.0);
    }

    #[test]
    fn deleting_a_timecard_removes_its_entries() {
        let conn = setup();
        let tc = card(&conn);
        add_event(&conn, 1, "2026-10-05T09:00:00", "2026-10-05T10:00:00", false, Some(1), None, 10);
        generate_entries(&conn, tc, &settings()).unwrap();

        assert!(delete_timecard(&conn, tc).unwrap());

        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM timecard_entries", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn deleting_an_entry_reports_whether_it_existed() {
        let conn = setup();
        let tc = card(&conn);
        let created = add_manual_entry(&conn, tc, &entry(MON, 1.0)).unwrap();

        assert!(delete_entry(&conn, created.id.unwrap()).unwrap());
        assert!(!delete_entry(&conn, created.id.unwrap()).unwrap());
    }

    fn cell(date: &str, hours: f64) -> CellInput {
        CellInput { date: date.into(), project_id: Some(1), activity_id: None, hours }
    }

    #[test]
    fn setting_a_cell_replaces_every_entry_behind_it_with_one() {
        let conn = setup();
        let id = card(&conn);
        // Three meetings on the same project and day, as generation would
        // leave them.
        for _ in 0..3 {
            add_manual_entry(&conn, id, &entry(MON, 1.0)).unwrap();
        }

        let written = set_cell(&conn, id, &cell(MON, 4.0)).unwrap().unwrap();

        assert_eq!(written.hours, 4.0);
        let entries = list_entries(&conn, id).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].hours, 4.0);
    }

    #[test]
    fn a_cell_survives_a_refresh_and_no_event_refills_it() {
        let conn = setup();
        let id = card(&conn);
        add_event(&conn, 1, &format!("{MON}T09:00:00"), &format!("{MON}T10:00:00"), false, Some(1), None, 10);
        generate_entries(&conn, id, &settings()).unwrap();

        set_cell(&conn, id, &cell(MON, 6.0)).unwrap();
        generate_entries(&conn, id, &settings()).unwrap();

        let entries = list_entries(&conn, id).unwrap();
        assert_eq!(entries.len(), 1, "regeneration must not resurrect the event entry");
        assert_eq!(entries[0].hours, 6.0);
        assert_eq!(entries[0].source, "cell");
    }

    #[test]
    fn clearing_a_cell_deletes_it_rather_than_storing_a_zero() {
        let conn = setup();
        let id = card(&conn);
        add_manual_entry(&conn, id, &entry(MON, 3.0)).unwrap();

        let written = set_cell(&conn, id, &cell(MON, 0.0)).unwrap();

        assert!(written.is_none());
        assert!(list_entries(&conn, id).unwrap().is_empty());
    }

    /// The Unassigned row and the no-activity row are real rows, and NULL does
    /// not match itself under `=`.
    #[test]
    fn a_cell_with_no_project_is_a_cell_of_its_own() {
        let conn = setup();
        let id = card(&conn);
        set_cell(&conn, id, &CellInput {
            date: MON.into(), project_id: None, activity_id: None, hours: 2.0
        }).unwrap();
        set_cell(&conn, id, &cell(MON, 5.0)).unwrap();

        let entries = list_entries(&conn, id).unwrap();
        assert_eq!(entries.len(), 2, "setting PRJ-001 must not clear Unassigned");
        let unassigned = entries.iter().find(|e| e.project_id.is_none()).unwrap();
        assert_eq!(unassigned.hours, 2.0);
    }

    #[test]
    fn a_cell_touches_neither_another_day_nor_another_activity() {
        let conn = setup();
        let id = card(&conn);
        conn.execute("INSERT INTO activities (id, name) VALUES (500, 'Dev')", []).unwrap();
        add_manual_entry(&conn, id, &entry("2026-10-06", 1.0)).unwrap();
        add_manual_entry(&conn, id, &EntryInput { activity_id: Some(500), ..entry(MON, 1.0) }).unwrap();

        set_cell(&conn, id, &cell(MON, 8.0)).unwrap();

        let entries = list_entries(&conn, id).unwrap();
        assert_eq!(entries.len(), 3);
        assert!(entries.iter().any(|e| e.date == "2026-10-06" && e.hours == 1.0));
        assert!(entries.iter().any(|e| e.activity_id == Some(500) && e.hours == 1.0));
    }

    /// The grid cannot show a note, so replacing a single entry must not be
    /// the thing that silently loses one.
    #[test]
    fn replacing_one_entry_carries_its_note_forward() {
        let conn = setup();
        let id = card(&conn);
        add_manual_entry(&conn, id, &EntryInput {
            note: Some("Called the vendor".into()), ..entry(MON, 1.0)
        }).unwrap();

        let written = set_cell(&conn, id, &cell(MON, 2.5)).unwrap().unwrap();

        assert_eq!(written.note.as_deref(), Some("Called the vendor"));
    }

    /// Two notes cannot be merged into one, so neither is claimed to survive.
    #[test]
    fn replacing_several_notes_keeps_none_of_them() {
        let conn = setup();
        let id = card(&conn);
        for note in ["First", "Second"] {
            add_manual_entry(&conn, id, &EntryInput {
                note: Some(note.into()), ..entry(MON, 1.0)
            }).unwrap();
        }

        let written = set_cell(&conn, id, &cell(MON, 2.5)).unwrap().unwrap();

        assert!(written.note.is_none());
    }

    #[test]
    fn a_submitted_timecard_refuses_a_cell_edit() {
        let conn = setup();
        let id = card(&conn);
        add_manual_entry(&conn, id, &entry(MON, 3.0)).unwrap();
        submit_timecard(&conn, id).unwrap();

        let error = set_cell(&conn, id, &cell(MON, 9.0)).unwrap_err();

        assert!(error.to_string().contains("has been submitted"));
        // And the refusal is total: the delete must not have happened either.
        assert_eq!(list_entries(&conn, id).unwrap()[0].hours, 3.0);
    }
}
