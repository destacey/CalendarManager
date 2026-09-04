import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { NewProject } from './projects'

/**
 * CSV import for projects, backed by `src-tauri/src/db/project_import.rs`.
 *
 * Create-only: a row whose code already exists is skipped, never updated, and
 * nothing is ever deleted.
 *
 * Two phases on purpose. `previewProjectImport` reads and validates the file
 * without touching the database; `commitProjectImport` writes the plan the
 * user approved. There is no undo, so the confirmation step is the safeguard.
 *
 * Rust reads the file itself from the path the dialog returns, which is why
 * the capability allowlist needs only `dialog:allow-open` and not
 * `fs:allow-read-file` — the webview never sees the file's contents.
 */

/**
 * These IPC payloads have their own dedicated types with no counterpart in
 * `src/types/index.ts`, so the Rust structs carry
 * `#[serde(rename_all = "camelCase")]` and arrive camelCased — unlike domain
 * types such as `Project`, whose fields stay snake_case end to end.
 */
export interface PlannedProject {
  line: number
  name: string
  code: string
  program: string | null
  isActive: boolean
}

export interface SkippedRow {
  line: number
  name: string
  code: string
  reason: string
}

export interface ProjectImportPreview {
  toCreate: PlannedProject[]
  skipped: SkippedRow[]
}

export interface ProjectImportOutcome {
  created: number
  skipped: number
}

/**
 * Opens a native file picker. Returns null when the user cancelled.
 */
export async function pickProjectCsv(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  })

  // The plugin returns string | string[] | null depending on `multiple`;
  // guard anyway so a future change to that option cannot silently yield an
  // array where a path is expected.
  if (!selected) return null
  return Array.isArray(selected) ? (selected[0] ?? null) : selected
}

export function previewProjectImport(path: string): Promise<ProjectImportPreview> {
  return invoke<ProjectImportPreview>('preview_project_import', { path })
}

/**
 * The one place the camelCase/snake_case boundary has to be crossed by hand.
 *
 * The preview returns `PlannedProject` (camelCase, a UI payload), but the
 * commit command takes Rust's `ProjectInput`, whose field is `is_active`.
 * Sending `isActive` would not error — serde would fall back to
 * `ProjectInput`'s default of `true`, silently importing every project as
 * active regardless of the file. Hence the explicit mapping, and the test
 * that pins it.
 */
export function plannedToNewProject(planned: PlannedProject): NewProject {
  return {
    name: planned.name,
    code: planned.code,
    program: planned.program,
    is_active: planned.isActive
  }
}

export function commitProjectImport(planned: PlannedProject[]): Promise<ProjectImportOutcome> {
  return invoke<ProjectImportOutcome>('commit_project_import', {
    projects: planned.map(plannedToNewProject)
  })
}
