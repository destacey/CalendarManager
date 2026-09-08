import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import ProjectsSettings from './ProjectsSettings'
import {
  getProjects,
  createProject,
  updateProject,
  deleteProject,
  DuplicateProjectCodeError
} from '../../api/projects'
import {
  pickProjectCsv,
  previewProjectImport,
  commitProjectImport
} from '../../api/projectImport'

/**
 * The grid virtualizes its rows, and @tanstack/react-virtual sizes its window
 * from the scroll viewport's `offsetHeight` — which jsdom always reports as 0.
 * Without this stub the grid renders a header and no body rows at all, so
 * every row-content assertion below would fail. Covers both the main table
 * and the import-preview grid inside the modal. See DataGrid.test.tsx.
 */
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {
    return this.hasAttribute('data-grid-body-viewport') ? 600 : 0
  },
})

// A bare `vi.mock('../../api/projects')` automock replaces DuplicateProjectCodeError
// with a mocked class whose constructor never runs, so `new DuplicateProjectCodeError(msg)`
// loses `message` and the component's `instanceof` check stops meaning what the test
// expects. Keep the real error class via importActual and mock only the four functions.
vi.mock('../../api/projects', async () => {
  const actual = await vi.importActual('../../api/projects')
  return {
    ...actual,
    getProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn()
  }
})

vi.mock('../../api/projectImport', () => ({
  pickProjectCsv: vi.fn(),
  previewProjectImport: vi.fn(),
  commitProjectImport: vi.fn()
}))

const mockProjects = [
  { id: 1, name: 'Website Rebuild', code: 'PRJ-001', program: 'Platform', is_active: true },
  { id: 2, name: 'Billing Migration', code: 'PRJ-002', program: null, is_active: true },
  { id: 3, name: 'Retired Thing', code: 'PRJ-OLD', program: 'Legacy', is_active: false }
]

describe('ProjectsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getProjects).mockResolvedValue(mockProjects)
  })

  it('lists the projects it loads', async () => {
    render(<ProjectsSettings />)

    await waitFor(() => {
      expect(screen.getByText('Website Rebuild')).toBeInTheDocument()
    })
    expect(screen.getByText('PRJ-001')).toBeInTheDocument()
    expect(screen.getByText('Platform')).toBeInTheDocument()
  })

  it('shows inactive projects as well as active ones', async () => {
    render(<ProjectsSettings />)

    await waitFor(() => {
      expect(screen.getByText('Retired Thing')).toBeInTheDocument()
    })
  })

  /* A project without a program must render a placeholder rather than an
     empty cell, so the column does not look broken. */
  it('renders a dash for a project with no program', async () => {
    render(<ProjectsSettings />)

    await waitFor(() => {
      expect(screen.getByText('Billing Migration')).toBeInTheDocument()
    })
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('shows the section when the search term matches a project by name, without filtering its rows', async () => {
    // Row-level filtering now belongs to the grid's own toolbar search, not
    // this page-level searchTerm prop — it only gates whether the whole
    // section renders. A matching term still shows every row.
    render(<ProjectsSettings searchTerm="billing" />)

    await waitFor(() => {
      expect(screen.getByText('Billing Migration')).toBeInTheDocument()
    })
    expect(screen.getByText('Website Rebuild')).toBeInTheDocument()
  })

  /* A code is often the thing someone actually remembers about a project, so
     the section-matching still has to check it and not just the name. */
  it('shows the section when the search term matches a project by its code', async () => {
    render(<ProjectsSettings searchTerm="prj-002" />)

    await waitFor(() => {
      expect(screen.getByText('Billing Migration')).toBeInTheDocument()
    })
    expect(screen.getByText('Website Rebuild')).toBeInTheDocument()
  })

  it('creates a project from the add modal', async () => {
    const user = userEvent.setup()
    vi.mocked(createProject).mockResolvedValue({
      id: 4, name: 'New Thing', code: 'PRJ-004', program: 'Platform', is_active: true
    })
    render(<ProjectsSettings />)
    await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /add project/i }))
    await user.type(await screen.findByLabelText('Name'), 'New Thing')
    await user.type(screen.getByLabelText('Code'), 'PRJ-004')
    await user.type(screen.getByLabelText('Program'), 'Platform')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Thing', code: 'PRJ-004', program: 'Platform' })
      )
    })
  })

  /* A blank program must reach the API as null, not '', so that "no program"
     is one value in the column rather than two. */
  it('sends a blank program as null rather than an empty string', async () => {
    const user = userEvent.setup()
    vi.mocked(createProject).mockResolvedValue({
      id: 5, name: 'No Program', code: 'PRJ-005', program: null, is_active: true
    })
    render(<ProjectsSettings />)
    await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /add project/i }))
    await user.type(await screen.findByLabelText('Name'), 'No Program')
    await user.type(screen.getByLabelText('Code'), 'PRJ-005')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith(expect.objectContaining({ program: null }))
    })
  })

  it('updates an existing project through the edit modal', async () => {
    const user = userEvent.setup()
    vi.mocked(updateProject).mockResolvedValue({
      id: 1, name: 'Website Rebuild v2', code: 'PRJ-001', program: 'Platform', is_active: true
    })
    render(<ProjectsSettings />)
    await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())

    // Individual per-action buttons were replaced by the grid's single "..."
    // row-actions dropdown; open Website Rebuild's row (index 0) and click
    // Edit. antd 6 renders a menu item's icon label inline with its text, so
    // an anchored /^edit$/i regex matches nothing — match a substring.
    await user.click(screen.getAllByLabelText('Row actions')[0])
    await user.click(await screen.findByText(/edit/i))
    const nameField = await screen.findByLabelText('Name')
    await user.clear(nameField)
    await user.type(nameField, 'Website Rebuild v2')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(updateProject).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ name: 'Website Rebuild v2' })
      )
    })
  })

  it('deletes a project after the confirmation is accepted', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteProject).mockResolvedValue({ deleted: true, eventsUnmapped: 0, rulesRemoved: 0 })
    render(<ProjectsSettings />)
    await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())

    // A menu item's onClick can't host an anchored Popconfirm, so delete now
    // confirms through a modal (confirmDelete), whose OK button reads
    // "Delete" rather than the old Popconfirm's "Yes".
    await user.click(screen.getAllByLabelText('Row actions')[0])
    await user.click(await screen.findByText(/delete/i))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => {
      expect(deleteProject).toHaveBeenCalledWith(1)
    })
  })

  /* Deleting a project now unmaps time and removes rules. Saying only
     "deleted" would hide both, so the message has to carry them. */
  it('reports what deleting a project took with it', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteProject).mockResolvedValue({
      deleted: true, eventsUnmapped: 34, rulesRemoved: 2
    })
    render(<ProjectsSettings />)
    await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())

    await user.click(screen.getAllByLabelText('Row actions')[0])
    await user.click(await screen.findByText(/delete/i))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => {
      expect(screen.getByText(/34 events unmapped, 2 rules removed/)).toBeInTheDocument()
    })
  })

  /* The duplicate code is the one error with a message worth showing; every
     other failure gets the generic fallback. */
  it('shows the duplicate-code message rather than a generic failure', async () => {
    const user = userEvent.setup()
    vi.mocked(createProject).mockRejectedValue(
      new DuplicateProjectCodeError('The code "PRJ-001" is already used by another project.')
    )
    render(<ProjectsSettings />)
    await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /add project/i }))
    await user.type(await screen.findByLabelText('Name'), 'Clashing')
    await user.type(screen.getByLabelText('Code'), 'PRJ-001')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(
        screen.getByText('The code "PRJ-001" is already used by another project.')
      ).toBeInTheDocument()
    })
  })

  it('reports a load failure instead of rendering an empty list silently', async () => {
    vi.mocked(getProjects).mockRejectedValue(new Error('boom'))
    render(<ProjectsSettings />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load projects')).toBeInTheDocument()
    })
  })

  describe('CSV import', () => {
    const planned = [
      { line: 2, name: 'New One', code: 'PRJ-100', program: 'Platform', isActive: true },
      { line: 3, name: 'New Two', code: 'PRJ-101', program: null, isActive: false }
    ]

    const openImportPreview = async (preview: unknown) => {
      const user = userEvent.setup()
      vi.mocked(pickProjectCsv).mockResolvedValue('C:/tmp/projects.csv')
      vi.mocked(previewProjectImport).mockResolvedValue(preview as never)
      render(<ProjectsSettings />)
      await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /import csv/i }))
      return user
    }

    it('previews the chosen file instead of importing it straight away', async () => {
      await openImportPreview({ toCreate: planned, skipped: [] })

      await waitFor(() => {
        expect(screen.getByText('New One')).toBeInTheDocument()
      })
      expect(commitProjectImport).not.toHaveBeenCalled()
    })

    /* Cancelling the file picker must be completely inert - no preview, and
       above all nothing written. */
    it('does nothing when the file picker is cancelled', async () => {
      const user = userEvent.setup()
      vi.mocked(pickProjectCsv).mockResolvedValue(null)
      render(<ProjectsSettings />)
      await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /import csv/i }))

      expect(previewProjectImport).not.toHaveBeenCalled()
      expect(commitProjectImport).not.toHaveBeenCalled()
    })

    /* The user explicitly asked to be told what is being skipped, so this is
       an indicator that must be visible, not a silent count. */
    it('names every skipped row with its line number and reason', async () => {
      await openImportPreview({
        toCreate: planned,
        skipped: [
          { line: 4, name: 'Dupe', code: 'PRJ-001', reason: 'that code already exists' },
          { line: 7, name: 'Nameless', code: '', reason: 'no code' }
        ]
      })

      await waitFor(() => {
        expect(screen.getByText(/2 rows will be skipped/i)).toBeInTheDocument()
      })
      expect(screen.getByText(/Line 4: Dupe — that code already exists/)).toBeInTheDocument()
      expect(screen.getByText(/Line 7: Nameless — no code/)).toBeInTheDocument()
    })

    it('shows no skip warning when every row is importable', async () => {
      await openImportPreview({ toCreate: planned, skipped: [] })

      await waitFor(() => expect(screen.getByText('New One')).toBeInTheDocument())
      expect(screen.queryByTestId('skipped-row')).not.toBeInTheDocument()
    })

    it('imports only the previewed rows when confirmed', async () => {
      vi.mocked(commitProjectImport).mockResolvedValue({ created: 2, skipped: 0 })
      const user = await openImportPreview({ toCreate: planned, skipped: [] })
      await waitFor(() => expect(screen.getByText('New One')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /import 2 projects/i }))

      await waitFor(() => {
        expect(commitProjectImport).toHaveBeenCalledWith(planned)
      })
    })

    it('reloads the list after a successful import', async () => {
      vi.mocked(commitProjectImport).mockResolvedValue({ created: 2, skipped: 0 })
      const user = await openImportPreview({ toCreate: planned, skipped: [] })
      await waitFor(() => expect(screen.getByText('New One')).toBeInTheDocument())
      vi.mocked(getProjects).mockClear()

      await user.click(screen.getByRole('button', { name: /import 2 projects/i }))

      await waitFor(() => expect(getProjects).toHaveBeenCalled())
    })

    /* A file whose rows are all skipped must not offer an import that would
       do nothing. */
    it('disables the import button when there is nothing to create', async () => {
      await openImportPreview({
        toCreate: [],
        skipped: [{ line: 2, name: 'Dupe', code: 'PRJ-001', reason: 'that code already exists' }]
      })

      await waitFor(() => {
        expect(screen.getByText('Nothing to import')).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: /^import$/i })).toBeDisabled()
    })

    it('writes nothing when the preview is cancelled', async () => {
      const user = await openImportPreview({ toCreate: planned, skipped: [] })
      await waitFor(() => expect(screen.getByText('New One')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /^cancel$/i }))

      expect(commitProjectImport).not.toHaveBeenCalled()
    })

    /* The backend's parse errors are already user-facing prose ("The CSV needs
       a header row with..."), so they must reach the user rather than being
       flattened into a generic failure. */
    it('surfaces the backend message when the file cannot be parsed', async () => {
      const user = userEvent.setup()
      vi.mocked(pickProjectCsv).mockResolvedValue('C:/tmp/bad.csv')
      vi.mocked(previewProjectImport).mockRejectedValue(
        "The CSV needs a header row with at least 'Name' and 'Code' columns."
      )
      render(<ProjectsSettings />)
      await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /import csv/i }))

      await waitFor(() => {
        expect(
          screen.getByText("The CSV needs a header row with at least 'Name' and 'Code' columns.")
        ).toBeInTheDocument()
      })
    })
  })
})
