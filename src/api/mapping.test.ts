import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  getMappingRules,
  createMappingRule,
  updateMappingRule,
  deleteMappingRule,
  reorderMappingRules,
  applyMappingRules,
  getUnmappedGroups,
  mapEvents,
  unmapEvents,
  InvalidMappingRuleError
} from './mapping'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const aRule = {
  name_operator: 'is' as const,
  name_value: 'Daily Standup',
  category_value: null,
  type_id: null,
  project_id: 1,
  activity_id: 5,
  is_active: true
}

describe('mapping api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /* Tauri auto-camelCases command arguments and silently DROPS a mis-cased
     key rather than erroring, so these assertions on the exact payload are
     the only thing standing between a rename and a silent no-op. */
  describe('argument names', () => {
    it('reads rules with no arguments', async () => {
      vi.mocked(invoke).mockResolvedValueOnce([])

      await getMappingRules()

      expect(invoke).toHaveBeenCalledWith('get_mapping_rules')
    })

    it('passes a new rule under a "rule" key', async () => {
      vi.mocked(invoke).mockResolvedValueOnce({})

      await createMappingRule(aRule)

      expect(invoke).toHaveBeenCalledWith('create_mapping_rule', { rule: aRule })
    })

    it('passes id and rule when updating', async () => {
      vi.mocked(invoke).mockResolvedValueOnce({})

      await updateMappingRule(9, aRule)

      expect(invoke).toHaveBeenCalledWith('update_mapping_rule', { id: 9, rule: aRule })
    })

    it('passes the id when deleting', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(true)

      await deleteMappingRule(3)

      expect(invoke).toHaveBeenCalledWith('delete_mapping_rule', { id: 3 })
    })

    it('reorders by sending ids in their new order', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(undefined)

      await reorderMappingRules([3, 1, 2])

      expect(invoke).toHaveBeenCalledWith('reorder_mapping_rules', { ids: [3, 1, 2] })
    })

    it('applies rules with no arguments', async () => {
      vi.mocked(invoke).mockResolvedValueOnce({ evaluated: 0, mapped: 0, skippedManual: 0 })

      await applyMappingRules()

      expect(invoke).toHaveBeenCalledWith('apply_mapping_rules')
    })

    /* billableOnly, not billable_only — the Rust parameter is snake_case and
       Tauri expects the camelCase spelling on this side. */
    it('camelCases billableOnly when reading the queue', async () => {
      vi.mocked(invoke).mockResolvedValueOnce([])

      await getUnmappedGroups('2026-10-01', '2026-10-31', true)

      expect(invoke).toHaveBeenCalledWith('get_unmapped_groups', {
        start: '2026-10-01',
        end: '2026-10-31',
        billableOnly: true
      })
    })

    it('camelCases eventIds, projectId and activityId when mapping', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(3)

      await mapEvents([1, 2, 3], 7, 5)

      expect(invoke).toHaveBeenCalledWith('map_events', {
        eventIds: [1, 2, 3],
        projectId: 7,
        activityId: 5
      })
    })

    /* "No activity" is a real answer, so null has to survive the trip rather
       than being dropped as an absent argument. */
    it('sends a null activity rather than omitting it', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(1)

      await mapEvents([1], 7, null)

      expect(invoke).toHaveBeenCalledWith('map_events', {
        eventIds: [1],
        projectId: 7,
        activityId: null
      })
    })

    it('camelCases eventIds when unmapping', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(1)

      await unmapEvents([4])

      expect(invoke).toHaveBeenCalledWith('unmap_events', { eventIds: [4] })
    })
  })

  describe('error translation', () => {
    it('surfaces a condition-less rule as a readable error', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(
        'A rule needs at least one condition - a name, a category or an event type.'
      )

      await expect(createMappingRule(aRule)).rejects.toBeInstanceOf(InvalidMappingRuleError)
    })

    it('surfaces an unknown name operator as a readable error', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(
        "'matches' is not a name condition. Use 'is' or 'contains'."
      )

      await expect(updateMappingRule(1, aRule)).rejects.toBeInstanceOf(InvalidMappingRuleError)
    })

    /* DbError wraps SQLite failures as "Database error: ..."; that prefix is
       machinery and must not reach the user. */
    it('strips the Database error prefix from the message', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(
        'Database error: A rule needs at least one condition - a name, a category or an event type.'
      )

      await expect(createMappingRule(aRule)).rejects.toThrow(
        /^A rule needs at least one condition/
      )
    })

    it('leaves unrelated errors alone', async () => {
      vi.mocked(invoke).mockRejectedValueOnce('Database is unavailable')

      await expect(createMappingRule(aRule)).rejects.not.toBeInstanceOf(InvalidMappingRuleError)
    })
  })
})
