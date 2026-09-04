import { invoke } from '@tauri-apps/api/core'
import { Activity } from '../types'

/**
 * Activities — named disciplines with a colour and an active flag — backed by
 * SQLite via the Rust `db` commands (`src-tauri/src/commands/db.rs`,
 * `src-tauri/src/db/activities.rs`).
 *
 * Activities are a second dimension alongside event types and are not yet
 * attached to events.
 */

export interface NewActivity {
  name: string
  color: string
  is_active: boolean
}

/** Same shape as `NewActivity` — every field on an activity is editable. */
export type ActivityUpdate = NewActivity

/**
 * Thrown when the backend rejects a name that already exists. A distinct
 * class (rather than a generic `Error`) so the Settings screen can show its
 * message directly while falling back to a generic message for anything else.
 */
export class DuplicateActivityError extends Error {}

/**
 * `activities.name` is `UNIQUE`, so a repeated name fails with a raw
 * `UNIQUE constraint failed: activities.name` wrapped in `DbError`'s
 * `Database error: {0}`. A raw SQLite message must never reach the user, so
 * it is translated here — the same approach `src/api/rules.ts` takes for
 * foreign-key violations.
 */
function toReadableError(error: unknown, name: string): unknown {
  const message =
    typeof error === 'string' ? error : error instanceof Error ? error.message : String(error)
  if (message.includes('UNIQUE constraint failed: activities.name')) {
    return new DuplicateActivityError(`An activity called "${name}" already exists.`)
  }
  return error
}

export function getActivities(): Promise<Activity[]> {
  return invoke<Activity[]>('get_activities')
}

export async function createActivity(activity: NewActivity): Promise<Activity> {
  try {
    return await invoke<Activity>('create_activity', { activity })
  } catch (error) {
    throw toReadableError(error, activity.name)
  }
}

export async function updateActivity(
  id: number,
  activity: ActivityUpdate
): Promise<Activity | null> {
  try {
    return await invoke<Activity | null>('update_activity', { id, activity })
  } catch (error) {
    throw toReadableError(error, activity.name)
  }
}

/**
 * What `deleteActivity` actually did. Unlike a project, losing an activity is
 * survivable: `activity_id` is nullable on both events and mapping rules, and
 * "this project, no activity" is a real answer — so both keep their project
 * and simply lose the activity. Nothing is unmapped or deleted.
 */
export interface DeleteActivityOutcome {
  deleted: boolean
  eventsCleared: number
  rulesCleared: number
}

export function deleteActivity(id: number): Promise<DeleteActivityOutcome> {
  return invoke<DeleteActivityOutcome>('delete_activity', { id })
}
