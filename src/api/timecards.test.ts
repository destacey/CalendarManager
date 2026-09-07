import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  getTimecards,
  getTimecard,
  createTimecard,
  deleteTimecard,
  getTimecardEntries,
  generateTimecardEntries,
  addTimecardEntry,
  updateTimecardEntry,
  deleteTimecardEntry,
  submitTimecard,
  reopenTimecard,
  TimecardSubmittedError
} from './timecards'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const anEntry = { date: '2026-10-05', hours: 8, project_id: 1, activity_id: 5, note: null }

describe('timecards api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /* Tauri auto-camelCases command arguments and silently DROPS a mis-cased
     key rather than erroring, so these assertions on the exact payload are
     the only thing standing between a rename and a silent no-op. */
  describe('argument names', () => {
    it('lists with no arguments', async () => {
      vi.mocked(invoke).mockResolvedValueOnce([])
      await getTimecards()
      expect(invoke).toHaveBeenCalledWith('get_timecards')
    })

    it('passes the id when reading one', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(null)
      await getTimecard(3)
      expect(invoke).toHaveBeenCalledWith('get_timecard', { id: 3 })
    })

    it('passes a new timecard under a "timecard" key', async () => {
      vi.mocked(invoke).mockResolvedValueOnce({})
      const timecard = { name: 'October', start_date: '2026-10-01', end_date: '2026-10-31' }
      await createTimecard(timecard)
      expect(invoke).toHaveBeenCalledWith('create_timecard', { timecard })
    })

    it('camelCases timecardId when reading entries', async () => {
      vi.mocked(invoke).mockResolvedValueOnce([])
      await getTimecardEntries(7)
      expect(invoke).toHaveBeenCalledWith('get_timecard_entries', { timecardId: 7 })
    })

    /* The settings object crosses as a domain payload, so its field stays
       snake_case while the argument name around it is camelCased. Getting
       either wrong is silent. */
    it('sends working days as snake_case inside a camelCased argument', async () => {
      vi.mocked(invoke).mockResolvedValueOnce({
        eventsRead: 0, entriesCreated: 0, manualEntriesKept: 0, unmappedEvents: 0
      })

      await generateTimecardEntries(7, [1, 2, 3, 4, 5])

      expect(invoke).toHaveBeenCalledWith('generate_timecard_entries', {
        timecardId: 7,
        settings: { working_days: [1, 2, 3, 4, 5] }
      })
    })

    it('passes timecardId and entry when adding', async () => {
      vi.mocked(invoke).mockResolvedValueOnce({})
      await addTimecardEntry(7, anEntry)
      expect(invoke).toHaveBeenCalledWith('add_timecard_entry', { timecardId: 7, entry: anEntry })
    })

    it('passes id and entry when updating', async () => {
      vi.mocked(invoke).mockResolvedValueOnce({})
      await updateTimecardEntry(9, anEntry)
      expect(invoke).toHaveBeenCalledWith('update_timecard_entry', { id: 9, entry: anEntry })
    })

    it('passes the id when deleting an entry', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(true)
      await deleteTimecardEntry(9)
      expect(invoke).toHaveBeenCalledWith('delete_timecard_entry', { id: 9 })
    })

    it('passes the id when deleting a timecard', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(true)
      await deleteTimecard(3)
      expect(invoke).toHaveBeenCalledWith('delete_timecard', { id: 3 })
    })

    it('passes the id when submitting and reopening', async () => {
      vi.mocked(invoke).mockResolvedValue(null)
      await submitTimecard(3)
      await reopenTimecard(3)
      expect(invoke).toHaveBeenCalledWith('submit_timecard', { id: 3 })
      expect(invoke).toHaveBeenCalledWith('reopen_timecard', { id: 3 })
    })
  })

  describe('error translation', () => {
    /* A submitted timecard refuses every write, and the backend's message
       already says what to do about it. */
    it('surfaces a refused write as a readable submitted error', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(
        'This timecard has been submitted. Reopen it before making changes.'
      )

      await expect(addTimecardEntry(7, anEntry)).rejects.toBeInstanceOf(TimecardSubmittedError)
    })

    it('refuses a regeneration of a submitted timecard the same way', async () => {
      vi.mocked(invoke).mockRejectedValueOnce(
        'Database error: This timecard has been submitted. Reopen it before making changes.'
      )

      await expect(generateTimecardEntries(7, [1])).rejects.toThrow(/^This timecard has been/)
    })

    it('leaves unrelated errors alone', async () => {
      vi.mocked(invoke).mockRejectedValueOnce('Database is unavailable')

      await expect(addTimecardEntry(7, anEntry)).rejects.not.toBeInstanceOf(
        TimecardSubmittedError
      )
    })
  })
})
