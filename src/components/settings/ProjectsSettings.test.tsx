import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
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

  it('filters the list by the settings search term', async () => {
    render(<ProjectsSettings searchTerm="billing" />)

    await waitFor(() => {
      expect(screen.getByText('Billing Migration')).toBeInTheDocument()
    })
    expect(screen.queryByText('Website Rebuild')).not.toBeInTheDocument()
  })

  /* A code is often the thing someone actually remembers about a project, so
     search has to match it and not just the name. */
  it('finds a project by its code', async () => {
    render(<ProjectsSettings searchTerm="prj-002" />)

    await waitFor(() => {
      expect(screen.getByText('Billing Migration')).toBeInTheDocument()
    })
    expect(screen.queryByText('Website Rebuild')).not.toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: 'Edit Website Rebuild' }))
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
    vi.mocked(deleteProject).mockResolvedValue(true)
    render(<ProjectsSettings />)
    await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Delete Website Rebuild' }))
    await user.click(await screen.findByRole('button', { name: /^yes$/i }))

    await waitFor(() => {
      expect(deleteProject).toHaveBeenCalledWith(1)
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
})
