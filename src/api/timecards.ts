import { invoke } from '@tauri-apps/api/core'

/**
 * Timecards, backed by `src-tauri/src/db/timecards.rs`.
 *
 * A timecard is created for a period and PULLS from events. Events never
 * depend on it: the calendar is the source of truth for what happened, and
 * the timecard is the record of what is billed, which is allowed to differ.
 *
 * Generation is a snapshot, not a live view — entries stay put until someone
 * asks for a refresh.
 */

export interface Timecard {
  id?: number
  name: string
  start_date: string
  end_date: string
  /** 'draft' or 'submitted'. A submitted timecard refuses every write. */
  status: string
  created_at?: string
  generated_at?: string | null
  submitted_at?: string | null
}

export interface TimecardEntry {
  id?: number
  timecard_id: number
  /** null once the event it came from was deleted — the entry survives. */
  event_id?: number | null
  date: string
  hours: number
  project_id?: number | null
  activity_id?: number | null
  /** 'event' (generated, replaceable) or 'manual' (yours, never replaced). */
  source: string
  note?: string | null
  created_at?: string
}

export interface NewTimecard {
  name: string
  start_date: string
  end_date: string
}

export interface EntryInput {
  event_id?: number | null
  date: string
  hours: number
  project_id?: number | null
  activity_id?: number | null
  note?: string | null
}

/** IPC-only payload, so the Rust struct is camelCased. */
export interface GenerationResult {
  eventsRead: number
  entriesCreated: number
  manualEntriesKept: number
  /** Events with no project. They produce no entry, so this needs surfacing. */
  unmappedEvents: number
}

/** Thrown when a write is refused because the timecard has been submitted. */
export class TimecardSubmittedError extends Error {}

/**
 * A submitted timecard refuses edits, and the backend's message already says
 * what to do about it. A raw error must never reach the user, so it is
 * translated — the same approach `rules.ts`, `projects.ts` and `mapping.ts`
 * take.
 */
function toReadableError(error: unknown): unknown {
  const message =
    typeof error === 'string' ? error : error instanceof Error ? error.message : String(error)
  if (message.includes('has been submitted')) {
    return new TimecardSubmittedError(message.replace(/^Database error: /, ''))
  }
  return error
}

export function getTimecards(): Promise<Timecard[]> {
  return invoke<Timecard[]>('get_timecards')
}

export function getTimecard(id: number): Promise<Timecard | null> {
  return invoke<Timecard | null>('get_timecard', { id })
}

export function createTimecard(timecard: NewTimecard): Promise<Timecard> {
  return invoke<Timecard>('create_timecard', { timecard })
}

export function deleteTimecard(id: number): Promise<boolean> {
  return invoke<boolean>('delete_timecard', { id })
}

export function getTimecardEntries(timecardId: number): Promise<TimecardEntry[]> {
  return invoke<TimecardEntry[]>('get_timecard_entries', { timecardId })
}

/**
 * Rebuilds the entries from the events in the period. Replaces everything it
 * generated before and touches nothing marked `manual`, so this is safe to
 * press after a sync.
 */
export async function generateTimecardEntries(
  timecardId: number,
  workingDays: number[]
): Promise<GenerationResult> {
  try {
    return await invoke<GenerationResult>('generate_timecard_entries', {
      timecardId,
      settings: { working_days: workingDays }
    })
  } catch (error) {
    throw toReadableError(error)
  }
}

export async function addTimecardEntry(
  timecardId: number,
  entry: EntryInput
): Promise<TimecardEntry> {
  try {
    return await invoke<TimecardEntry>('add_timecard_entry', { timecardId, entry })
  } catch (error) {
    throw toReadableError(error)
  }
}

/** Editing a generated entry promotes it to `manual` — that is deliberate. */
export async function updateTimecardEntry(
  id: number,
  entry: EntryInput
): Promise<TimecardEntry | null> {
  try {
    return await invoke<TimecardEntry | null>('update_timecard_entry', { id, entry })
  } catch (error) {
    throw toReadableError(error)
  }
}

export async function deleteTimecardEntry(id: number): Promise<boolean> {
  try {
    return await invoke<boolean>('delete_timecard_entry', { id })
  } catch (error) {
    throw toReadableError(error)
  }
}

export function submitTimecard(id: number): Promise<Timecard | null> {
  return invoke<Timecard | null>('submit_timecard', { id })
}

export function reopenTimecard(id: number): Promise<Timecard | null> {
  return invoke<Timecard | null>('reopen_timecard', { id })
}
