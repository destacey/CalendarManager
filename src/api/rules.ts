import { invoke } from '@tauri-apps/api/core'
import { EventTypeRule } from '../types'

/**
 * Event type assignment rules, backed by SQLite via the Rust `db` commands
 * (`src-tauri/src/commands/db.rs`, `src-tauri/src/db/event_types.rs`).
 */

export interface NewEventTypeRule {
  name: string
  priority: number
  field_name: string
  operator: string
  value?: string
  target_type_id: number
}

export interface EventTypeRuleUpdate {
  name: string
  priority: number
  field_name: string
  operator: string
  value?: string
  target_type_id: number
}

/**
 * Thrown by `createEventTypeRule`/`updateEventTypeRule` when the backend's
 * `FOREIGN KEY constraint failed` reports a `target_type_id` that doesn't
 * exist. A distinct class (rather than a generic `Error`) so callers can
 * show its message to the user directly while still falling back to a
 * generic message for anything else that might go wrong.
 */
export class InvalidTargetTypeError extends Error {}

/**
 * Foreign keys are enforced in the Rust build (they were silently off under
 * Electron), so creating or updating a rule with a `target_type_id` that
 * doesn't exist now fails with a raw `FOREIGN KEY constraint failed` message
 * instead of the dangling reference Electron used to store silently. Risk is
 * low — the form only offers ids from a dropdown of existing types — but a
 * raw SQLite message must never reach the user, so it's translated here.
 */
function toReadableError(error: unknown): unknown {
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : String(error)
  if (message.includes('FOREIGN KEY constraint failed')) {
    return new InvalidTargetTypeError('The selected event type no longer exists. Please choose another type.')
  }
  return error
}

export function getEventTypeRules(): Promise<EventTypeRule[]> {
  return invoke<EventTypeRule[]>('get_event_type_rules')
}

export async function createEventTypeRule(rule: NewEventTypeRule): Promise<EventTypeRule> {
  try {
    return await invoke<EventTypeRule>('create_event_type_rule', { rule })
  } catch (error) {
    throw toReadableError(error)
  }
}

export async function updateEventTypeRule(id: number, rule: EventTypeRuleUpdate): Promise<EventTypeRule | null> {
  try {
    return await invoke<EventTypeRule | null>('update_event_type_rule', { id, rule })
  } catch (error) {
    throw toReadableError(error)
  }
}

export function deleteEventTypeRule(id: number): Promise<boolean> {
  return invoke<boolean>('delete_event_type_rule', { id })
}

export function updateRulePriorities(ruleIds: number[]): Promise<boolean> {
  return invoke<boolean>('update_rule_priorities', { ruleIds })
}
