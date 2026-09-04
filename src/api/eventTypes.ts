import { invoke } from '@tauri-apps/api/core'
import { Event, EventType } from '../types'

/**
 * Event types and their automatic assignment, backed by SQLite via the Rust
 * `db` commands (`src-tauri/src/commands/db.rs`,
 * `src-tauri/src/db/event_types.rs`, `src-tauri/src/db/assignment.rs`).
 */

export interface NewEventType {
  name: string
  color: string
  is_default: boolean
  is_billable: boolean
}

export interface EventTypeUpdate {
  name: string
  color: string
  is_default: boolean
  is_billable: boolean
}

/**
 * What `delete_event_type` actually did. Foreign keys are enforced in the
 * Rust build (they were silently off under Electron), so a bare delete can
 * no longer just remove the row when events or rules still reference it.
 * Deleting reassigns referencing events to the default type and drops
 * referencing rules, in one transaction — this is what the Settings screen
 * must report to the user rather than a bare success toast.
 */
export interface DeleteEventTypeOutcome {
  deleted: boolean
  eventsReassigned: number
  rulesRemoved: number
  reassignedTo: string | null
}

export interface ReprocessEventTypesResult {
  success: boolean
  processedCount?: number
  updatedCount?: number
  message: string
  error?: string
}

/** The fields `evaluate_event_type` needs to match rules against. */
export type EventFieldsInput = Pick<Event, 'title' | 'is_all_day' | 'show_as' | 'categories'>

export function getEventTypes(): Promise<EventType[]> {
  return invoke<EventType[]>('get_event_types')
}

export function createEventType(eventType: NewEventType): Promise<EventType> {
  return invoke<EventType>('create_event_type', { eventType })
}

export function updateEventType(id: number, eventType: EventTypeUpdate): Promise<EventType | null> {
  return invoke<EventType | null>('update_event_type', { id, eventType })
}

export function deleteEventType(id: number): Promise<DeleteEventTypeOutcome> {
  return invoke<DeleteEventTypeOutcome>('delete_event_type', { id })
}

export function setDefaultEventType(id: number): Promise<boolean> {
  return invoke<boolean>('set_default_event_type', { id })
}

export function evaluateEventType(fields: EventFieldsInput): Promise<number | null> {
  return invoke<number | null>('evaluate_event_type', { fields })
}

export function setEventTypeManually(eventId: number, typeId: number): Promise<boolean> {
  return invoke<boolean>('set_event_type_manually', { eventId, typeId })
}

export function reprocessEventTypes(): Promise<ReprocessEventTypesResult> {
  return invoke<ReprocessEventTypesResult>('reprocess_event_types')
}

/**
 * Re-evaluates one event's rules and clears its manual override, returning
 * the type it was assigned (or `null` if the event no longer exists). The
 * inverse of `setEventTypeManually` — see `EventModal.tsx`'s
 * `handleResetToAutoAssign`, which is the only caller.
 */
export function resetEventTypeToAuto(eventId: number): Promise<number | null> {
  return invoke<number | null>('reset_event_type_to_auto', { eventId })
}
