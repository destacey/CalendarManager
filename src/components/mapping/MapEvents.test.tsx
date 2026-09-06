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
  { id: 3, name: 'Billing Migration', code: 'PRJ-002', program: 'Finance', is_active: true },
  { id: 4, name: 'Job Distribution', code: 'PRJ-003', program: 'Platform', is_active: true },
  { id: 5, name: 'Internal', code: 'PRJ-004', program: null, is_active: true },
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

    /* It filters the unmapped list, so it has to live in that panel. In the
       page header it read as though it applied to the whole screen. */
    it('puts the billable filter in the events panel, beside the search', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

      const search = screen.getByPlaceholderText('Search events and categories')
      const toggle = screen.getByRole('switch', { name: /billable types only/i })
      const panel = search.closest('.ant-splitter-panel')

      expect(panel).not.toBeNull()
      expect(panel).toContainElement(toggle)

      // And it still works from its new home.
      await user.click(toggle)
      await waitFor(() => {
        expect(getUnmappedGroups).toHaveBeenLastCalledWith(
          expect.any(String),
          expect.any(String),
          false
        )
      })
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

  describe('grouping projects by program', () => {
    /* Flat: the program is repeated on each of the two Platform rows.
       Grouped: it appears once, as the heading, and the rows stop repeating
       it. The count is what distinguishes the two modes. */
    it('is off by default, repeating the program on each row', async () => {
      render(<MapEvents />)

      await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())
      expect(screen.getByRole('switch', { name: /group by program/i })).not.toBeChecked()
      expect(screen.getAllByText('Platform')).toHaveLength(2)
    })

    it('groups under a single program heading when switched on', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())

      await user.click(screen.getByRole('switch', { name: /group by program/i }))

      expect(screen.getAllByText('Platform')).toHaveLength(1)
      expect(screen.getByText('Finance')).toBeInTheDocument()
    })

    /* "No program" is an absence rather than a name, so sorting it in among
       real programs would be arbitrary - it goes last. */
    it('puts projects with no program last, under their own heading', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())

      await user.click(screen.getByRole('switch', { name: /group by program/i }))

      const finance = screen.getByText('Finance')
      const none = screen.getByText('No program')

      expect(none).toBeInTheDocument()
      expect(
        finance.compareDocumentPosition(none) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    })

    it('keeps every project visible when grouped', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())

      await user.click(screen.getByRole('switch', { name: /group by program/i }))

      for (const name of ['Website Rebuild', 'Billing Migration', 'Job Distribution', 'Internal']) {
        expect(screen.getByText(name)).toBeInTheDocument()
      }
    })

    /* Grouping is a view change; the rows must still be drop targets. */
    it('leaves each project a drop target when grouped', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())

      await user.click(screen.getByRole('switch', { name: /group by program/i }))

      expect(screen.getByTestId('project-drop-1')).toBeInTheDocument()
      expect(screen.getByTestId('project-drop-3')).toBeInTheDocument()
    })

    it('offers no toggle when no project has a program', async () => {
      vi.mocked(getProjects).mockResolvedValue([
        { id: 5, name: 'Internal', code: 'PRJ-004', program: null, is_active: true }
      ])
      render(<MapEvents />)

      await waitFor(() => expect(screen.getByText('Internal')).toBeInTheDocument())
      expect(
        screen.queryByRole('switch', { name: /group by program/i })
      ).not.toBeInTheDocument()
    })

    it('does not reload when toggled', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())
      const before = vi.mocked(getProjects).mock.calls.length

      await user.click(screen.getByRole('switch', { name: /group by program/i }))

      expect(vi.mocked(getProjects).mock.calls.length).toBe(before)
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

  describe('searching the projects', () => {
    const searchProjects = async (user: ReturnType<typeof userEvent.setup>, term: string) => {
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())
      await user.type(screen.getByPlaceholderText('Search projects, codes and programs'), term)
    }

    it('finds a project by name', async () => {
      const user = userEvent.setup()
      await searchProjects(user, 'billing')

      await waitFor(() => expect(screen.getByText('Billing Migration')).toBeInTheDocument())
      expect(screen.queryByText('Website Rebuild')).not.toBeInTheDocument()
    })

    /* The code is what most people actually remember. */
    it('finds a project by code', async () => {
      const user = userEvent.setup()
      await searchProjects(user, 'PRJ-003')

      await waitFor(() => expect(screen.getByText('Job Distribution')).toBeInTheDocument())
      expect(screen.queryByText('Billing Migration')).not.toBeInTheDocument()
    })

    /* Searching a program is how you narrow to a whole area of work, and it
       is what the grouping is by. */
    it('finds every project in a program', async () => {
      const user = userEvent.setup()
      await searchProjects(user, 'platform')

      await waitFor(() => expect(screen.getByText('Website Rebuild')).toBeInTheDocument())
      expect(screen.getByText('Job Distribution')).toBeInTheDocument()
      expect(screen.queryByText('Billing Migration')).not.toBeInTheDocument()
    })

    it('says when nothing matches rather than showing an empty panel', async () => {
      const user = userEvent.setup()
      await searchProjects(user, 'nothing like this')

      await waitFor(() =>
        expect(screen.getByText('No projects match "nothing like this"')).toBeInTheDocument()
      )
    })

    /* The search narrows what is already shown; it does not bring back a
       project the inactive toggle is hiding. */
    it('does not surface an inactive project', async () => {
      const user = userEvent.setup()
      await searchProjects(user, 'retired')

      await waitFor(() =>
        expect(screen.getByText(/No projects match/)).toBeInTheDocument()
      )
    })
  })

  describe('ordering the queue', () => {
    /** The cards in the order they are rendered — they are the only things
        on the screen carrying aria-pressed. */
    const cardOrder = () =>
      Array.from(document.querySelectorAll('[aria-pressed]')).map(
        el => el.getAttribute('aria-label') ?? ''
      )

    it('starts with the biggest group first', async () => {
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

      expect(cardOrder()[0]).toContain('Daily Standup')
    })

    it('sorts by title, in whichever direction is set', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

      await user.click(screen.getByRole('combobox', { name: 'Sort events by' }))
      await user.click(await screen.findByTitle('Title'))

      // The direction carries over from what it already was: descending.
      await waitFor(() => expect(cardOrder()[0]).toContain('Sprint Planning'))

      await user.click(screen.getByRole('button', { name: /sort ascending instead/i }))

      await waitFor(() => expect(cardOrder()[0]).toContain('Daily Standup'))
    })

    it('turns the order around', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())
      const first = cardOrder()[0]

      await user.click(screen.getByRole('button', { name: /sort ascending instead/i }))

      await waitFor(() => expect(cardOrder()[0]).not.toBe(first))
      // And the button now offers the way back.
      expect(screen.getByRole('button', { name: /sort descending instead/i })).toBeInTheDocument()
    })

    /* Sorting and searching are independent: narrowing the list must not put
       it back in its original order. */
    it('keeps the chosen order while searching', async () => {
      const user = userEvent.setup()
      render(<MapEvents />)
      await waitFor(() => expect(screen.getByText('Daily Standup')).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /sort ascending instead/i }))
      await user.type(screen.getByPlaceholderText('Search events and categories'), 'e')

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /sort descending instead/i })).toBeInTheDocument()
      )
    })
  })
})
