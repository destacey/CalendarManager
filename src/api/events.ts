import { invoke } from '@tauri-apps/api/core'
import { Event } from '../types'

/**
 * Calendar events, backed by SQLite via the Rust `db` commands
 * (`src-tauri/src/commands/db.rs`, `src-tauri/src/db/events.rs`).
 *
 * Payload shapes below mirror the Rust `NewEvent`/`EventUpdate` structs
 * field-for-field: snake_case, and deliberately narrower than `Event` (no
 * `id`, `location`, `organizer`, `attendees`, `is_meeting`, `type_id` or
 * `type_manually_set` — those arrive later from Graph sync or manual/rule
 * based type assignment, never from this form).
 */

export interface NewEvent {
  graph_id?: string
  title: string
  description?: string
  start_date: string
  end_date?: string
  is_all_day: boolean
  show_as: string
  categories: string
}

export interface EventUpdate {
  title: string
  description?: string
  start_date: string
  end_date?: string
  is_all_day: boolean
  show_as: string
  categories: string
}

export function getEvents(): Promise<Event[]> {
  return invoke<Event[]>('get_events')
}

/**
 * The distinct categories across all events.
 *
 * A dedicated query because the alternative was `getEvents()` and a reduce in
 * the browser: every event in the database, roughly a megabyte of JSON, to
 * produce a list of about sixteen strings.
 */
/** The events behind a set of timecard entries, in one call. */
export function getEventsByIds(ids: number[]): Promise<Event[]> {
  return invoke<Event[]>('get_events_by_ids', { ids })
}

export function getEventCategories(): Promise<string[]> {
  return invoke<string[]>('get_event_categories')
}

export function getEventsInRange(startDate: string, endDate: string): Promise<Event[]> {
  return invoke<Event[]>('get_events_in_range', { startDate, endDate })
}

export function createEvent(event: NewEvent): Promise<Event> {
  return invoke<Event>('create_event', { event })
}

export function updateEvent(id: number, event: EventUpdate): Promise<Event | null> {
  return invoke<Event | null>('update_event', { id, event })
}

export function deleteEvent(id: number): Promise<boolean> {
  return invoke<boolean>('delete_event', { id })
}

/**
 * Deletes every row in `events` in one statement (`db::events::delete_all_events`),
 * rather than the old approach of fetching every event and awaiting
 * `deleteEvent(id)` in a loop — against the real database that was
 * thousands of individual IPC round trips, each its own transaction, and a
 * failure partway through left a half-emptied table with no way to tell how
 * far it got. Returns the number of rows actually deleted.
 */
export function deleteAllEvents(): Promise<number> {
  return invoke<number>('delete_all_events')
}
