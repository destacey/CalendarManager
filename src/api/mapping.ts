import { invoke } from '@tauri-apps/api/core'
import { MappingRule } from '../types'

/**
 * Mapping events onto projects and activities, backed by
 * `src-tauri/src/db/mapping.rs` and `mapping_rules.rs`.
 *
 * A rule tests an event's name, category, event type, or any combination —
 * every supplied condition must hold. Rules run in priority order and the
 * first match wins. `show_as` is deliberately not a condition; see the Rust
 * module for why.
 */

export interface MappingRuleInput {
  name_operator?: 'is' | 'contains' | null
  name_value?: string | null
  category_value?: string | null
  type_id?: number | null
  project_id: number
  activity_id?: number | null
  is_active: boolean
}

/**
 * These three carry `#[serde(rename_all = "camelCase")]` on the Rust side —
 * they are IPC-only payloads with no counterpart in `src/types/index.ts`,
 * unlike domain types such as `MappingRule` whose fields stay snake_case.
 */
export interface UnmappedGroup {
  key: string
  title: string
  categories: string
  typeName: string | null
  eventCount: number
  /** Timed events only. All-day events contribute nothing — see allDayCount. */
  timedMinutes: number
  allDayCount: number
  eventIds: number[]
}

export interface MappingRunResult {
  evaluated: number
  mapped: number
  skippedManual: number
}

/** Thrown when a rule would test nothing, or names an unknown operator. */
export class InvalidMappingRuleError extends Error {}

/**
 * The backend refuses a rule with no conditions, because one would match every
 * event and swallow the whole calendar. Its message is already user-facing
 * prose, so it is surfaced rather than flattened into a generic failure — the
 * same approach `src/api/rules.ts` and `projects.ts` take.
 */
function toReadableError(error: unknown): unknown {
  const message =
    typeof error === 'string' ? error : error instanceof Error ? error.message : String(error)
  if (message.includes('at least one condition') || message.includes("'is' or 'contains'")) {
    return new InvalidMappingRuleError(message.replace(/^Database error: /, ''))
  }
  return error
}

export function getMappingRules(): Promise<MappingRule[]> {
  return invoke<MappingRule[]>('get_mapping_rules')
}

export async function createMappingRule(rule: MappingRuleInput): Promise<MappingRule> {
  try {
    return await invoke<MappingRule>('create_mapping_rule', { rule })
  } catch (error) {
    throw toReadableError(error)
  }
}

export async function updateMappingRule(
  id: number,
  rule: MappingRuleInput
): Promise<MappingRule | null> {
  try {
    return await invoke<MappingRule | null>('update_mapping_rule', { id, rule })
  } catch (error) {
    throw toReadableError(error)
  }
}

export function deleteMappingRule(id: number): Promise<boolean> {
  return invoke<boolean>('delete_mapping_rule', { id })
}

/** Takes ids in their new order; the backend rewrites every priority. */
export function reorderMappingRules(ids: number[]): Promise<void> {
  return invoke<void>('reorder_mapping_rules', { ids })
}

export function applyMappingRules(): Promise<MappingRunResult> {
  return invoke<MappingRunResult>('apply_mapping_rules')
}

/**
 * `billableOnly` keeps Info and Personal events out of the queue. It is a
 * default, not a restriction — passing false shows everything.
 */
export function getUnmappedGroups(
  start: string,
  end: string,
  billableOnly: boolean
): Promise<UnmappedGroup[]> {
  return invoke<UnmappedGroup[]>('get_unmapped_groups', { start, end, billableOnly })
}

/** Maps by hand and marks the events so no rule will move them again. */
export function mapEvents(
  eventIds: number[],
  projectId: number,
  activityId: number | null
): Promise<number> {
  return invoke<number>('map_events', { eventIds, projectId, activityId })
}

/** Clears a hand-made mapping and hands the events back to the rules. */
export function unmapEvents(eventIds: number[]): Promise<number> {
  return invoke<number>('unmap_events', { eventIds })
}
