import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  getActivities,
  createActivity,
  updateActivity,
  deleteActivity,
  DuplicateActivityError
} from './activities'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

describe('activities api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads the list through get_activities', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([])

    await getActivities()

    expect(invoke).toHaveBeenCalledWith('get_activities')
  })

  /* Tauri auto-camelCases command arguments, and a mis-cased key is not an
     error - the argument just arrives missing on the Rust side. Asserting the
     exact payload is the only thing that catches that. */
  it('passes the activity under an "activity" key', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({})
    const activity = { name: 'DevOps', color: '#52c41a', is_active: true }

    await createActivity(activity)

    expect(invoke).toHaveBeenCalledWith('create_activity', { activity })
  })

  it('passes both id and activity when updating', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({})
    const activity = { name: 'DevOps', color: '#52c41a', is_active: false }

    await updateActivity(7, activity)

    expect(invoke).toHaveBeenCalledWith('update_activity', { id: 7, activity })
  })

  it('passes the id when deleting', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(true)

    await deleteActivity(3)

    expect(invoke).toHaveBeenCalledWith('delete_activity', { id: 3 })
  })

  it('translates a UNIQUE violation into a readable duplicate error', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(
      'Database error: UNIQUE constraint failed: activities.name'
    )

    await expect(
      createActivity({ name: 'DevOps', color: '#52c41a', is_active: true })
    ).rejects.toBeInstanceOf(DuplicateActivityError)
  })

  it('names the offending activity in the duplicate message', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(
      'Database error: UNIQUE constraint failed: activities.name'
    )

    await expect(
      createActivity({ name: 'DevOps', color: '#52c41a', is_active: true })
    ).rejects.toThrow('An activity called "DevOps" already exists.')
  })

  /* Anything that is not a duplicate must pass through untouched, or a real
     failure gets misreported as a naming collision. */
  it('leaves unrelated errors alone', async () => {
    vi.mocked(invoke).mockRejectedValueOnce('Database is unavailable')

    await expect(
      createActivity({ name: 'DevOps', color: '#52c41a', is_active: true })
    ).rejects.not.toBeInstanceOf(DuplicateActivityError)
  })
})
