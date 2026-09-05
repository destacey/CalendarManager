import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import ActivitiesSettings from './ActivitiesSettings'
import {
  getActivities,
  createActivity,
  updateActivity,
  deleteActivity,
  DuplicateActivityError
} from '../../api/activities'

// A bare `vi.mock('../../api/activities')` automock replaces DuplicateActivityError
// with a mocked class whose constructor never runs, so `new DuplicateActivityError(msg)`
// loses `message` and the component's `instanceof` check no longer means what the test
// expects. Keep the real error class via importActual and only mock the four functions,
// matching the pattern EventTypeRulesSettings.test.tsx uses for '../../api/rules'.
vi.mock('../../api/activities', async () => {
  const actual = await vi.importActual('../../api/activities')
  return {
    ...actual,
    getActivities: vi.fn(),
    createActivity: vi.fn(),
    updateActivity: vi.fn(),
    deleteActivity: vi.fn()
  }
})

const mockActivities = [
  { id: 1, name: 'Architecture', color: '#2f54eb', is_active: true },
  { id: 2, name: 'DevOps', color: '#52c41a', is_active: true },
  { id: 3, name: 'Retired Work', color: '#f5222d', is_active: false }
]

describe('ActivitiesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getActivities).mockResolvedValue(mockActivities)
  })

  it('lists the activities it loads', async () => {
    render(<ActivitiesSettings />)

    await waitFor(() => {
      expect(screen.getByText('Architecture')).toBeInTheDocument()
    })
    expect(screen.getByText('DevOps')).toBeInTheDocument()
  })

  it('shows inactive activities as well as active ones', async () => {
    render(<ActivitiesSettings />)

    await waitFor(() => {
      expect(screen.getByText('Retired Work')).toBeInTheDocument()
    })
  })

  it('filters the list by the settings search term', async () => {
    render(<ActivitiesSettings searchTerm="devops" />)

    await waitFor(() => {
      expect(screen.getByText('DevOps')).toBeInTheDocument()
    })
    expect(screen.queryByText('Architecture')).not.toBeInTheDocument()
  })

  it('creates an activity from the add modal', async () => {
    const user = userEvent.setup()
    vi.mocked(createActivity).mockResolvedValue({
      id: 4, name: 'UX Design', color: '#eb2f96', is_active: true
    })
    render(<ActivitiesSettings />)
    await waitFor(() => expect(screen.getByText('Architecture')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /add activity/i }))
    await user.type(await screen.findByLabelText('Name'), 'UX Design')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(createActivity).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'UX Design' })
      )
    })
  })

  it('updates an existing activity through the edit modal', async () => {
    const user = userEvent.setup()
    vi.mocked(updateActivity).mockResolvedValue({
      id: 2, name: 'Platform DevOps', color: '#52c41a', is_active: true
    })
    render(<ActivitiesSettings />)
    await waitFor(() => expect(screen.getByText('DevOps')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Edit DevOps' }))
    const nameField = await screen.findByLabelText('Name')
    await user.clear(nameField)
    await user.type(nameField, 'Platform DevOps')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(updateActivity).toHaveBeenCalledWith(
        2,
        expect.objectContaining({ name: 'Platform DevOps' })
      )
    })
  })

  it('deletes an activity after the confirmation is accepted', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteActivity).mockResolvedValue({ deleted: true, eventsCleared: 0, rulesCleared: 0 })
    render(<ActivitiesSettings />)
    await waitFor(() => expect(screen.getByText('Architecture')).toBeInTheDocument())

    await user.click(screen.getAllByRole('button', { name: /delete/i })[0])
    await user.click(await screen.findByRole('button', { name: /^yes$/i }))

    await waitFor(() => {
      expect(deleteActivity).toHaveBeenCalledWith(1)
    })
  })

  /* An activity in use is cleared from events and rules rather than blocking
     the delete, so the message says how far that reached. */
  it('reports what deleting an activity was cleared from', async () => {
    const user = userEvent.setup()
    vi.mocked(deleteActivity).mockResolvedValue({
      deleted: true, eventsCleared: 12, rulesCleared: 1
    })
    render(<ActivitiesSettings />)
    await waitFor(() => expect(screen.getByText('Architecture')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Delete Architecture' }))
    await user.click(await screen.findByRole('button', { name: /^yes$/i }))

    await waitFor(() => {
      expect(screen.getByText(/cleared from 12 events and 1 rule/)).toBeInTheDocument()
    })
  })

  /* The duplicate case is the one error with a message worth showing; every
     other failure gets the generic fallback. */
  it('shows the duplicate-name message rather than a generic failure', async () => {
    const user = userEvent.setup()
    vi.mocked(createActivity).mockRejectedValue(
      new DuplicateActivityError('An activity called "DevOps" already exists.')
    )
    render(<ActivitiesSettings />)
    await waitFor(() => expect(screen.getByText('Architecture')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /add activity/i }))
    await user.type(await screen.findByLabelText('Name'), 'DevOps')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(screen.getByText('An activity called "DevOps" already exists.')).toBeInTheDocument()
    })
  })

  it('reports a load failure instead of rendering an empty list silently', async () => {
    vi.mocked(getActivities).mockRejectedValue(new Error('boom'))
    render(<ActivitiesSettings />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load activities')).toBeInTheDocument()
    })
  })
})
