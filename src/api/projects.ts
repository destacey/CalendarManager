import { invoke } from '@tauri-apps/api/core'
import { Project } from '../types'

/**
 * Projects — a name, a unique code, an optional free-text program and an
 * active flag — backed by SQLite via the Rust `db` commands
 * (`src-tauri/src/commands/db.rs`, `src-tauri/src/db/projects.rs`).
 *
 * Nothing references projects yet; they are not attached to events.
 */

export interface NewProject {
  name: string
  code: string
  program?: string | null
  is_active: boolean
}

/** Same shape as `NewProject` — every field on a project is editable. */
export type ProjectUpdate = NewProject

/**
 * Thrown when the backend rejects a code that already exists. A distinct
 * class (rather than a generic `Error`) so the Settings screen can show its
 * message directly while falling back to a generic message for anything else.
 *
 * Note this is keyed to `code`, not `name`: two projects may share a name.
 */
export class DuplicateProjectCodeError extends Error {}

/**
 * `projects.code` is `UNIQUE`, so a repeated code fails with a raw
 * `UNIQUE constraint failed: projects.code` wrapped in `DbError`'s
 * `Database error: {0}`. A raw SQLite message must never reach the user, so
 * it is translated here — the same approach `src/api/activities.ts` and
 * `src/api/rules.ts` take.
 */
function toReadableError(error: unknown, code: string): unknown {
  const message =
    typeof error === 'string' ? error : error instanceof Error ? error.message : String(error)
  if (message.includes('UNIQUE constraint failed: projects.code')) {
    return new DuplicateProjectCodeError(`The code "${code}" is already used by another project.`)
  }
  return error
}

export function getProjects(): Promise<Project[]> {
  return invoke<Project[]>('get_projects')
}

export async function createProject(project: NewProject): Promise<Project> {
  try {
    return await invoke<Project>('create_project', { project })
  } catch (error) {
    throw toReadableError(error, project.code)
  }
}

export async function updateProject(id: number, project: ProjectUpdate): Promise<Project | null> {
  try {
    return await invoke<Project | null>('update_project', { id, project })
  } catch (error) {
    throw toReadableError(error, project.code)
  }
}

/**
 * What `deleteProject` actually did. Events and mapping rules now reference
 * projects and foreign keys are enforced, so a bare delete would fail on real
 * data. Events are *unmapped* rather than moved — there is no sensible default
 * project — and rules targeting it are removed, because their `project_id` is
 * NOT NULL. The Settings screen reports this instead of a bare success.
 */
export interface DeleteProjectOutcome {
  deleted: boolean
  eventsUnmapped: number
  rulesRemoved: number
}

export function deleteProject(id: number): Promise<DeleteProjectOutcome> {
  return invoke<DeleteProjectOutcome>('delete_project', { id })
}
