import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import {
  pickProjectCsv,
  previewProjectImport,
  commitProjectImport,
  plannedToNewProject,
  PlannedProject
} from './projectImport'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const planned: PlannedProject = {
  line: 2,
  name: 'Website Rebuild',
  code: 'PRJ-001',
  program: 'Platform',
  isActive: true
}

describe('projectImport api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('pickProjectCsv', () => {
    it('returns the chosen path', async () => {
      vi.mocked(open).mockResolvedValueOnce('C:/tmp/projects.csv')

      expect(await pickProjectCsv()).toBe('C:/tmp/projects.csv')
    })

    it('returns null when the dialog is cancelled', async () => {
      vi.mocked(open).mockResolvedValueOnce(null)

      expect(await pickProjectCsv()).toBeNull()
    })

    /* The plugin's return type widens to an array depending on `multiple`.
       Guarding here means flipping that option can never hand a path-shaped
       array to the backend. */
    it('unwraps an array result to its first entry', async () => {
      vi.mocked(open).mockResolvedValueOnce(['C:/tmp/a.csv'] as never)

      expect(await pickProjectCsv()).toBe('C:/tmp/a.csv')
    })

    it('offers only CSV files', async () => {
      vi.mocked(open).mockResolvedValueOnce(null)

      await pickProjectCsv()

      expect(open).toHaveBeenCalledWith(
        expect.objectContaining({
          multiple: false,
          filters: [{ name: 'CSV', extensions: ['csv'] }]
        })
      )
    })
  })

  it('previews by path', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ toCreate: [], skipped: [] })

    await previewProjectImport('C:/tmp/projects.csv')

    expect(invoke).toHaveBeenCalledWith('preview_project_import', {
      path: 'C:/tmp/projects.csv'
    })
  })

  /* The camelCase/snake_case boundary. Sending `isActive` would not error -
     serde would fall back to ProjectInput's default of true and silently
     import every project as active regardless of the file. */
  describe('plannedToNewProject', () => {
    it('maps isActive to the is_active key Rust deserialises', () => {
      expect(plannedToNewProject(planned)).toEqual({
        name: 'Website Rebuild',
        code: 'PRJ-001',
        program: 'Platform',
        is_active: true
      })
    })

    it('preserves an inactive flag rather than defaulting it to true', () => {
      const inactive = { ...planned, isActive: false }

      expect(plannedToNewProject(inactive).is_active).toBe(false)
    })

    it('drops the line number, which is a preview concern only', () => {
      expect(plannedToNewProject(planned)).not.toHaveProperty('line')
    })

    it('passes a null program through unchanged', () => {
      expect(plannedToNewProject({ ...planned, program: null }).program).toBeNull()
    })
  })

  it('commits the converted rows under a "projects" key', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ created: 1, skipped: 0 })

    await commitProjectImport([planned])

    expect(invoke).toHaveBeenCalledWith('commit_project_import', {
      projects: [
        { name: 'Website Rebuild', code: 'PRJ-001', program: 'Platform', is_active: true }
      ]
    })
  })

  it('commits an empty plan without inventing rows', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ created: 0, skipped: 0 })

    await commitProjectImport([])

    expect(invoke).toHaveBeenCalledWith('commit_project_import', { projects: [] })
  })
})
