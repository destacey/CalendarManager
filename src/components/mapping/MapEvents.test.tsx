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
vi.mock('./ActivityPicker', () => ({
  default: ({ onDone }: { onDone: () => void }) => (
    <button data-testid="activity-picker" onClick={onDone}>
      finish
    </button>
  )
}))
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

  /* Mapping used to swap the whole splitter for a centred spinner and back,
     which read as the page flashing on every drop. A refresh must leave the
     board mounted. */
  describe('refreshing without flashing', () => {
    it('keeps the board on screen while reloading', async () => {
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

      // A slow reload, so the intermediate state is observable at all.
      let release: (v: typeof mockGroups) => void = () => {}
      vi.mocked(getUnmappedGroups).mockReturnValueOnce(
        new Promise(resolve => {
          release = resolve
        })
      )

      // Any reload after the first takes this path — the toggle is simply the
      // one reachable without a drag.
      screen.getByRole('switch', { name: /billable types only/i }).click()

      // Mid-refresh: the board is still there, not replaced by a spinner.
      expect(screen.getByText('Daily Standup')).toBeInTheDocument()
      expect(screen.getByText('Projects')).toBeInTheDocument()

      release(mockGroups)
      await waitFor(() => expect(getUnmappedGroups).toHaveBeenCalledTimes(2))
    })

    it('still blanks the board on the very first load', () => {
      let release: (v: typeof mockGroups) => void = () => {}
      vi.mocked(getUnmappedGroups).mockReturnValueOnce(
        new Promise(resolve => {
          release = resolve
        })
      )

      render(<MapEvents />)

      expect(screen.queryByText('Unmapped')).not.toBeInTheDocument()
      release(mockGroups)
    })
  })

  describe('search', () => {
    it('filters the queue by event title', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

      await user.type(screen.getByPlaceholderText('Search events and categories'), 'sprint')

      expect(screen.getByText('Sprint Planning')).toBeInTheDocument()
      expect(screen.queryByText('Daily Standup')).not.toBeInTheDocument()
    })

    /* A group is identified by title AND categories, so "Scrum" should find
       the standups even though no title contains it. */
    it('also matches categories', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('PTO')).toBeInTheDocument())

      await user.type(screen.getByPlaceholderText('Search events and categories'), 'scrum')

      expect(screen.getByText('Daily Standup')).toBeInTheDocument()
      expect(screen.getByText('Sprint Planning')).toBeInTheDocument()
      expect(screen.queryByText('PTO')).not.toBeInTheDocument()
    })

    it('distinguishes no matches from nothing left to map', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

      await user.type(screen.getByPlaceholderText('Search events and categories'), 'nothing here')

      expect(screen.getByText('No events match "nothing here"')).toBeInTheDocument()
      expect(screen.queryByText('Nothing left to map for this month')).not.toBeInTheDocument()
    })

    /* Search filters the view; it does not silently discard a selection made
       before it. Dropping still maps everything selected, so the user has to
       be told what they can no longer see. */
    it('keeps a selection the search has hidden, and says so', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /Daily Standup, 23 events/ }))
      await user.type(screen.getByPlaceholderText('Search events and categories'), 'sprint')

      expect(screen.getByText('1 selected · 23 events')).toBeInTheDocument()
      expect(
        screen.getByText(/1 selected group is hidden by this search, and will still be mapped/)
      ).toBeInTheDocument()
    })

    it('says nothing about hidden groups when none are hidden', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /Daily Standup, 23 events/ }))
      await user.type(screen.getByPlaceholderText('Search events and categories'), 'standup')

      expect(screen.queryByText(/hidden by this search/)).not.toBeInTheDocument()
    })
  })

  /* The two halves are a splitter rather than a fixed grid: with a long
     project list you want to give that side more room, and each side has to
     scroll on its own rather than the whole page moving. */
  describe('layout', () => {
    it('puts the two lists in separate resizable panels', async () => {
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

      // antd renders one draggable bar between two panels.
      expect(document.querySelectorAll('.ant-splitter-panel')).toHaveLength(2)
      expect(document.querySelector('.ant-splitter-bar')).toBeInTheDocument()
    })

    it('gives the drag handle a keyboard-reachable control', async () => {
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

      expect(screen.getByRole('separator')).toBeInTheDocument()
    })
  })

  it('tells the user when there is nothing left to map', async () => {
    vi.mocked(getUnmappedGroups).mockResolvedValue([])
    render(<MapEvents />)

    await waitFor(() => {
      expect(screen.getByText('Nothing left to map for this month')).toBeInTheDocument()
    })
  })

  it('says so when there are no projects at all', async () => {
    vi.mocked(getProjects).mockResolvedValue([])
    render(<MapEvents />)

    await waitFor(() => {
      expect(screen.getByText('No projects — add one in Settings')).toBeInTheDocument()
    })
  })

  describe('inactive projects', () => {
    /* Retired projects are hidden by default: mapping new work to one is
       almost always a mistake. */
    it('hides them until asked for', async () => {
      render(<MapEvents />)

      await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())
      expect(screen.queryByText('Retired Project')).not.toBeInTheDocument()
    })

    it('shows them when the toggle is switched on', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())

      await user.click(screen.getByRole('switch', { name: /include inactive projects/i }))

      expect(screen.getByText('Retired Project')).toBeInTheDocument()
    })

    /* Dropping onto a retired project is a real choice, so it has to be an
       obvious one rather than a row that looks like any other. */
    it('marks a shown inactive project as inactive', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())

      await user.click(screen.getByRole('switch', { name: /include inactive projects/i }))

      expect(screen.getByText('Inactive')).toBeInTheDocument()
    })

    it('says how many there are to include', async () => {
      render(<MapEvents />)

      await waitFor(() => expect(screen.getByText('Include inactive (1)')).toBeInTheDocument())
    })

    /* Toggling is a view change, not a query - it must not refetch. */
    it('does not reload when toggled', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())
      const before = vi.mocked(getProjects).mock.calls.length

      await user.click(screen.getByRole('switch', { name: /include inactive projects/i }))

      expect(vi.mocked(getProjects).mock.calls.length).toBe(before)
    })

    it('offers no toggle when every project is active', async () => {
      vi.mocked(getProjects).mockResolvedValue([
        { id: 1, name: 'Website Rebuild', code: 'PRJ-001', program: 'Platform', is_active: true }
      ])
      render(<MapEvents />)

      await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())
      expect(
        screen.queryByRole('switch', { name: /include inactive projects/i })
      ).not.toBeInTheDocument()
    })

    /* All projects retired is a different problem from having none, and the
       fix is different too. */
    it('points at the toggle when every project is inactive', async () => {
      vi.mocked(getProjects).mockResolvedValue([
        { id: 2, name: 'Retired Project', code: 'PRJ-OLD', program: null, is_active: false }
      ])
      render(<MapEvents />)

      await waitFor(() => {
        expect(
          screen.getByText(/switch on "Include inactive" or add one in Settings/)
        ).toBeInTheDocument()
      })
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
