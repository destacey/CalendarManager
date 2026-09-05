import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import { MappingCell } from './EventTable'
import { mapEvents, unmapEvents } from '../../api/mapping'

vi.mock('../../api/mapping', () => ({ mapEvents: vi.fn(), unmapEvents: vi.fn() }))

const projects = [
  { id: 1, name: 'Website Rebuild', code: 'PRJ-001', program: 'Platform', is_active: true },
  { id: 3, name: 'Billing Migration', code: 'PRJ-002', program: 'Finance', is_active: true },
  { id: 2, name: 'Retired', code: 'PRJ-OLD', program: null, is_active: false }
]
const activities = [
  { id: 5, name: 'Software Development', color: '#1890ff', is_active: true },
  { id: 6, name: 'Retired Activity', color: '#f5222d', is_active: false }
]

const record = (overrides = {}) =>
  ({
    id: 42,
    title: 'Daily Standup',
    start_date: '2026-10-01T09:00:00',
    is_all_day: false,
    show_as: 'busy',
    categories: '',
    key: 'k',
    project_id: 1,
    activity_id: 5,
    project: projects[0],
    activity: activities[0],
    ...overrides
  }) as never

const renderCell = (field: 'project' | 'activity', overrides = {}) => {
  const onChanged = vi.fn()
  render(
    <MappingCell
      record={record(overrides)}
      projects={projects}
      activities={activities}
      field={field}
      onChanged={onChanged}
    />
  )
  return { onChanged }
}

describe('MappingCell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mapEvents).mockResolvedValue(1)
    vi.mocked(unmapEvents).mockResolvedValue(1)
  })

  it('shows the project code and name', () => {
    renderCell('project')

    expect(screen.getByText('PRJ-001 — Website Rebuild')).toBeInTheDocument()
  })

  it('shows the activity name', () => {
    renderCell('activity')

    expect(screen.getByText('Software Development')).toBeInTheDocument()
  })

  it('reads as Unmapped when there is no project', () => {
    renderCell('project', { project_id: null, project: undefined })

    expect(screen.getByText('Unmapped')).toBeInTheDocument()
  })

  /* 500 rows must not mean 1,000 mounted Selects, so a cell is plain text
     until it is clicked. */
  it('only becomes a control once clicked', async () => {
    const user = userEvent.setup()
    renderCell('project')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Change project for Daily Standup/ }))

    expect(await screen.findByRole('combobox')).toBeInTheDocument()
  })

  it('maps the event when a project is chosen', async () => {
    const user = userEvent.setup()
    const { onChanged } = renderCell('project')

    await user.click(screen.getByRole('button', { name: /Change project for Daily Standup/ }))
    await user.click(await screen.findByTitle('PRJ-002 — Billing Migration'))

    await waitFor(() => expect(mapEvents).toHaveBeenCalledWith([42], 3, null))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  /* An activity chosen for one project is a claim about that project, so
     carrying it silently onto another would be wrong. */
  it('clears the activity when the project changes', async () => {
    const user = userEvent.setup()
    renderCell('project')

    await user.click(screen.getByRole('button', { name: /Change project for Daily Standup/ }))
    await user.click(await screen.findByTitle('PRJ-002 — Billing Migration'))

    await waitFor(() => {
      expect(mapEvents).toHaveBeenCalledWith([42], 3, null)
    })
  })

  it('keeps the project when only the activity changes', async () => {
    const user = userEvent.setup()
    renderCell('activity')

    await user.click(screen.getByRole('button', { name: /Change activity for Daily Standup/ }))
    await user.click(await screen.findByTitle('No activity'))

    await waitFor(() => expect(mapEvents).toHaveBeenCalledWith([42], 1, null))
  })

  /* Choosing "Unmapped" hands the event back to the rules rather than pinning
     it as a hand-made blank, which is what mapEvents(null) would do. */
  it('unmaps rather than mapping to nothing', async () => {
    const user = userEvent.setup()
    renderCell('project')

    await user.click(screen.getByRole('button', { name: /Change project for Daily Standup/ }))
    await user.click(await screen.findByTitle('Unmapped'))

    await waitFor(() => expect(unmapEvents).toHaveBeenCalledWith([42]))
    expect(mapEvents).not.toHaveBeenCalled()
  })

  /* A retired project already on an event has to stay selectable, or opening
     the editor would silently offer to change it. */
  it('still offers an inactive project that the event already uses', async () => {
    const user = userEvent.setup()
    renderCell('project', { project_id: 2, project: projects[1] })

    await user.click(screen.getByRole('button', { name: /Change project for Daily Standup/ }))

    expect(await screen.findByTitle('PRJ-002 — Billing Migration')).toBeInTheDocument()
  })

  it('reports a failure rather than pretending it saved', async () => {
    const user = userEvent.setup()
    vi.mocked(mapEvents).mockRejectedValue(new Error('boom'))
    renderCell('project')

    await user.click(screen.getByRole('button', { name: /Change project for Daily Standup/ }))
    await user.click(await screen.findByTitle('PRJ-002 — Billing Migration'))

    await waitFor(() => {
      expect(screen.getByText('Failed to change the mapping')).toBeInTheDocument()
    })
  })
})
