import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import MapEvents from './MapEvents'
import { getUnmappedGroups } from '../../api/mapping'
import { getProjects } from '../../api/projects'
import { getActivities } from '../../api/activities'

vi.mock('../../api/mapping', () => ({ getUnmappedGroups: vi.fn() }))
// The drop itself opens ActivityPicker, which is tested directly: dnd-kit's
// collision detection needs real element geometry, and jsdom reports every
// element as zero-sized, so a drag cannot be driven here at all.
vi.mock('./ActivityPicker', () => ({ default: () => <div data-testid="activity-picker" /> }))
vi.mock('../../api/projects', () => ({ getProjects: vi.fn() }))
vi.mock('../../api/activities', () => ({ getActivities: vi.fn() }))

const mockGroups = [
  {
    key: 'daily standup|scrum',
    title: 'Daily Standup',
    categories: 'Scrum',
    typeName: 'Work',
    eventCount: 23,
    timedMinutes: 690,
    allDayCount: 0,
    eventIds: [1, 2, 3]
  },
  {
    key: 'sprint planning|scrum',
    title: 'Sprint Planning',
    categories: 'Scrum',
    typeName: 'Work',
    eventCount: 5,
    timedMinutes: 600,
    allDayCount: 0,
    eventIds: [4, 5]
  },
  {
    key: 'pto|',
    title: 'PTO',
    categories: '',
    typeName: 'Work',
    eventCount: 1,
    timedMinutes: 0,
    allDayCount: 1,
    eventIds: [6]
  }
]

const mockProjects = [
  { id: 1, name: 'Website Rebuild', code: 'PRJ-001', program: 'Platform', is_active: true },
  { id: 2, name: 'Retired Project', code: 'PRJ-OLD', program: null, is_active: false }
]

const mockActivities = [
  { id: 5, name: 'Software Development', color: '#1890ff', is_active: true },
  { id: 6, name: 'Retired Activity', color: '#f5222d', is_active: false }
]

describe('MapEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getUnmappedGroups).mockResolvedValue(mockGroups)
    vi.mocked(getProjects).mockResolvedValue(mockProjects)
    vi.mocked(getActivities).mockResolvedValue(mockActivities)
  })

  it('lists the unmapped groups with their counts', async () => {
    render(<MapEvents />)

    await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())
    expect(screen.getByText('23')).toBeInTheDocument()
    expect(screen.getByText('Sprint Planning')).toBeInTheDocument()
  })

  it('summarises how much is left to do', async () => {
    render(<MapEvents />)

    await waitFor(() => {
      expect(screen.getByText('29 unmapped events in 3 groups')).toBeInTheDocument()
    })
  })

  /* The queue defaults to billable types so Info and Personal events are not
     noise the user has to dismiss one by one. */
  it('asks for billable types only by default', async () => {
    render(<MapEvents />)

    await waitFor(() => {
      expect(getUnmappedGroups).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        true
      )
    })
  })

  it('reloads without the billable filter when it is switched off', async () => {
    const user = userEvent.setup()
    render(<MapEvents />)
    await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

    await user.click(screen.getByRole('switch', { name: /billable types only/i }))

    await waitFor(() => {
      expect(getUnmappedGroups).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.any(String),
        false
      )
    })
  })

  /* All-day events must not be folded into an hours figure: what one is worth
     is still an open question, and guessing is the bug the billable footer
     already has. */
  it('shows all-day events as a count rather than inventing hours', async () => {
    render(<MapEvents />)

    await waitFor(() => expect(screen.getByText('PTO')).toBeInTheDocument())
    expect(screen.getByText('1 all-day')).toBeInTheDocument()
  })

  it('formats timed effort as hours and minutes', async () => {
    render(<MapEvents />)

    await waitFor(() => expect(screen.getByText('11h 30m')).toBeInTheDocument())
  })

  /* Inactive projects and activities are kept for history but must not be
     offered as somewhere to map new work. */
  it('offers only active projects as drop targets', async () => {
    render(<MapEvents />)

    await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())
    expect(screen.queryByText('Retired Project')).not.toBeInTheDocument()
  })

  describe('selection', () => {
    it('selects a group on click', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /Daily Standup, 23 events/ }))

      expect(screen.getByRole('button', { name: /Daily Standup, 23 events/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    })

    /* The whole point of the multi-select: three Scrum groups are one drag,
       not three. */
    it('adds to the selection on ctrl-click', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /Daily Standup, 23 events/ }))
      await user.keyboard('{Control>}')
      await user.click(screen.getByRole('button', { name: /Sprint Planning, 5 events/ }))
      await user.keyboard('{/Control}')

      expect(screen.getByText('2 selected · 28 events')).toBeInTheDocument()
    })

    it('replaces the selection on a plain click', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /Daily Standup, 23 events/ }))
      await user.click(screen.getByRole('button', { name: /Sprint Planning, 5 events/ }))

      expect(
        screen.getByRole('button', { name: /Daily Standup, 23 events/ })
      ).toHaveAttribute('aria-pressed', 'false')
    })

    it('deselects when the only selected group is clicked again', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

      const card = screen.getByRole('button', { name: /Daily Standup, 23 events/ })
      await user.click(card)
      await user.click(card)

      expect(card).toHaveAttribute('aria-pressed', 'false')
    })
  })

  it('tells the user when there is nothing left to map', async () => {
    vi.mocked(getUnmappedGroups).mockResolvedValue([])
    render(<MapEvents />)

    await waitFor(() => {
      expect(screen.getByText('Nothing left to map for this month')).toBeInTheDocument()
    })
  })

  it('says so when there are no projects to map onto', async () => {
    vi.mocked(getProjects).mockResolvedValue([])
    render(<MapEvents />)

    await waitFor(() => {
      expect(screen.getByText('No active projects — add one in Settings')).toBeInTheDocument()
    })
  })

  it('reports a load failure instead of rendering an empty queue silently', async () => {
    vi.mocked(getUnmappedGroups).mockRejectedValue(new Error('boom'))
    render(<MapEvents />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load unmapped events')).toBeInTheDocument()
    })
  })
})
