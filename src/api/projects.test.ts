import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  getProjects,
  createProject,
  updateProject,
  deleteProject,
  DuplicateProjectCodeError
} from './projects'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const aProject = { name: 'Website Rebuild', code: 'PRJ-001', program: 'Platform', is_active: true }

describe('projects api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads the list through get_projects', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([])

    await getProjects()

    expect(invoke).toHaveBeenCalledWith('get_projects')
  })

  /* Tauri auto-camelCases command arguments, and a mis-cased key is not an
     error - the argument just arrives missing on the Rust side. Asserting the
     exact payload is the only thing that catches that. */
  it('passes the project under a "project" key', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({})

    await createProject(aProject)

    expect(invoke).toHaveBeenCalledWith('create_project', { project: aProject })
  })

  it('passes both id and project when updating', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({})

    await updateProject(7, aProject)

    expect(invoke).toHaveBeenCalledWith('update_project', { id: 7, project: aProject })
  })

  it('passes the id when deleting', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(true)

    await deleteProject(3)

    expect(invoke).toHaveBeenCalledWith('delete_project', { id: 3 })
  })

  it('translates a UNIQUE code violation into a readable duplicate error', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(
      'Database error: UNIQUE constraint failed: projects.code'
    )

    await expect(createProject(aProject)).rejects.toBeInstanceOf(DuplicateProjectCodeError)
  })

  it('names the offending code in the duplicate message', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(
      'Database error: UNIQUE constraint failed: projects.code'
    )

    await expect(createProject(aProject)).rejects.toThrow(
      'The code "PRJ-001" is already used by another project.'
    )
  })

  /* Anything that is not a duplicate code must pass through untouched, or a
     real failure gets misreported as a naming collision. */
  it('leaves unrelated errors alone', async () => {
    vi.mocked(invoke).mockRejectedValueOnce('Database is unavailable')

    await expect(createProject(aProject)).rejects.not.toBeInstanceOf(DuplicateProjectCodeError)
  })
})
