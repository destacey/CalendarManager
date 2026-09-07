import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, act, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import EventTypeRulesSettings from './EventTypeRulesSettings'
import type { EventType, EventTypeRule } from '../../types'
import * as rulesApi from '../../api/rules'
import * as eventTypesApi from '../../api/eventTypes'
import * as eventsApi from '../../api/events'

/**
 * The grid virtualizes its rows, and @tanstack/react-virtual sizes its window
 * from the scroll viewport's `offsetHeight` — which jsdom always reports as 0.
 * Without this stub the grid renders a header and no body rows at all, so
 * every row-content assertion below would fail. See DataGrid.test.tsx.
 */
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {
    return this.hasAttribute('data-grid-body-viewport') ? 600 : 0
  },
})

/**
 * dnd-kit cannot be driven in jsdom: collision detection needs real element
 * geometry and jsdom reports everything zero-sized. So no test here simulates
 * a drag. Instead this records the props of every DndContext the grid mounts
 * (while still rendering the real one, so nothing else changes) so a test can
 * invoke the row drop handler directly. Same pattern as DataGrid.test.tsx.
 */
const dnd = vi.hoisted(() => ({ contexts: [] as any[] }))

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  const { createElement } = await import('react')
  return {
    ...actual,
    DndContext: (props: any) => {
      dnd.contexts.push(props)
      return createElement(actual.DndContext, props)
    },
  }
})

// Mock the api modules
vi.mock('../../api/rules', () => ({
  getEventTypeRules: vi.fn(),
  createEventTypeRule: vi.fn(),
  updateEventTypeRule: vi.fn(),
  deleteEventTypeRule: vi.fn(),
  updateRulePriorities: vi.fn()
}))

vi.mock('../../api/eventTypes', () => ({
  getEventTypes: vi.fn(),
  reprocessEventTypes: vi.fn()
}))

vi.mock('../../api/events', () => ({
  getEventCategories: vi.fn()
}))

const mockRulesApi = vi.mocked(rulesApi)
const mockEventTypesApi = vi.mocked(eventTypesApi)
const mockEventsApi = vi.mocked(eventsApi)

// Mock data
const mockEventTypes: EventType[] = [
  {
    id: 1,
    name: 'Work',
    color: '#1890ff',
    is_default: false,
    is_billable: false, all_day_hours: 8
  },
  {
    id: 2,
    name: 'Personal',
    color: '#52c41a',
    is_default: true,
    is_billable: false, all_day_hours: 8
  }
]

const mockRules: EventTypeRule[] = [
  {
    id: 1,
    name: 'Work Events',
    field_name: 'title',
    operator: 'contains',
    value: 'work',
    target_type_id: 1,
    priority: 1
  },
  {
    id: 2,
    name: 'Free Time',
    field_name: 'show_as',
    operator: 'equals',
    value: 'free',
    target_type_id: 2,
    priority: 2
  }
]

/** The grid's ROW drag context (the header's carries `modifiers`; the column
 *  chooser's has no `onDragStart`). Latest render wins. */
const rowDragEnd = () => {
  const ctx = [...dnd.contexts]
    .reverse()
    .find((props) => !props.modifiers && props.onDragStart)
  if (!ctx) throw new Error('no row DndContext mounted')
  return ctx.onDragEnd as (event: any) => void
}

/** Invokes the row drop handler directly — see the `@dnd-kit/core` mock. */
const dropRow = (activeId: string, overId: string | null) =>
  act(() => {
    rowDragEnd()({
      active: { id: activeId },
      over: overId === null ? null : { id: overId },
    })
  })

/** Every drag-handle grip currently on screen. */
const handles = () =>
  Array.from(document.querySelectorAll('[aria-label="Drag to reorder"]')) as HTMLElement[]

describe('EventTypeRulesSettings', () => {
  const mockOnEventsUpdated = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    dnd.contexts.length = 0

    // Default mock implementations
    mockRulesApi.getEventTypeRules.mockResolvedValue(mockRules)
    mockEventTypesApi.getEventTypes.mockResolvedValue(mockEventTypes)
    // The categories the rule editor offers, straight from SQL rather than
    // reduced out of every event in the database.
    mockEventsApi.getEventCategories.mockResolvedValue(['Personal', 'Work'])
    mockEventTypesApi.reprocessEventTypes.mockResolvedValue({ success: true, message: 'Success' })
  })

  it('renders the component with basic elements', async () => {
    await act(async () => {
      render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
    })

    expect(screen.getByText('Rules')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /process rules/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add rule/i })).toBeInTheDocument()
    expect(screen.getByText(/rules automatically assign event types/i)).toBeInTheDocument()
  })

  it('loads and displays rules', async () => {
    await act(async () => {
      render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
    })

    await waitFor(() => {
      expect(mockRulesApi.getEventTypeRules).toHaveBeenCalled()
      expect(mockEventTypesApi.getEventTypes).toHaveBeenCalled()
      expect(mockEventsApi.getEventCategories).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(screen.getByText('Work Events')).toBeInTheDocument()
      expect(screen.getByText('Free Time')).toBeInTheDocument()
    })
  })

  it('displays rule conditions correctly', async () => {
    await act(async () => {
      render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
    })

    await waitFor(() => {
      expect(screen.getByText('Title Contains "work"')).toBeInTheDocument()
      expect(screen.getByText('Show As Equals "free"')).toBeInTheDocument()
    })
  })

  /* The "#" column and its handle both read `rule.priority` (the backend's
     own order), never the grid's row-render position — see the reorder
     tests below for what would go wrong otherwise. */
  it('shows priority numbers with a drag handle per row', async () => {
    await act(async () => {
      render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
    })

    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
    })
    expect(handles()).toHaveLength(2)
  })

  it('displays assigned event types with colors', async () => {
    await act(async () => {
      render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
    })

    await waitFor(() => {
      expect(screen.getByText('Work')).toBeInTheDocument()
      expect(screen.getByText('Personal')).toBeInTheDocument()

      // Check if color swatches are rendered
      const elements = document.querySelectorAll('[style*="background-color"]')
      expect(elements.length).toBeGreaterThan(0)
    })
  })

  it('opens the edit modal from the row actions menu', async () => {
    const user = userEvent.setup()
    await act(async () => {
      render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
    })
    await waitFor(() => expect(screen.getByText('Work Events')).toBeInTheDocument())

    // Individual per-action buttons were replaced by the grid's single "..."
    // row-actions dropdown; open the first row's and click Edit. antd 6
    // renders a menu item's icon label inline with its text, so an anchored
    // /^edit$/i regex matches nothing — match a substring.
    await user.click(screen.getAllByLabelText('Row actions')[0])
    await user.click(await screen.findByText(/edit/i))

    expect(await screen.findByDisplayValue('Work Events')).toBeInTheDocument()
  })

  it('deletes a rule after the confirmation is accepted', async () => {
    const user = userEvent.setup()
    mockRulesApi.deleteEventTypeRule.mockResolvedValue(true)
    await act(async () => {
      render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
    })
    await waitFor(() => expect(screen.getByText('Work Events')).toBeInTheDocument())

    // A menu item's onClick can't host an anchored Popconfirm, so delete now
    // confirms through a modal (confirmDelete), whose OK button reads
    // "Delete" rather than the old Popconfirm's "Yes".
    await user.click(screen.getAllByLabelText('Row actions')[0])
    await user.click(await screen.findByText(/delete/i))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(mockRulesApi.deleteEventTypeRule).toHaveBeenCalledWith(1))
  })

  describe('reorder (onRowReorder)', () => {
    /* Order is the whole point of this list, so a drop has to write the
       backend's real priority order, not anything derived from where a row
       happened to render. */
    it('reorders by sending the dropped order, then reloads', async () => {
      mockRulesApi.updateRulePriorities.mockResolvedValue(true)
      await act(async () => {
        render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
      })
      await waitFor(() => expect(screen.getByText('Work Events')).toBeInTheDocument())

      // Drop rule 1 (Work Events, priority 1) onto rule 2 (Free Time,
      // priority 2) — the two swap.
      dropRow('1', '2')

      await waitFor(() =>
        expect(mockRulesApi.updateRulePriorities).toHaveBeenCalledWith([2, 1])
      )
      // Reloads afterwards so the grid reflects the backend's own order.
      await waitFor(() => expect(mockRulesApi.getEventTypeRules).toHaveBeenCalledTimes(2))
    })

    it('reports a failure and reloads to revert, rather than leaving a stale order on screen', async () => {
      mockRulesApi.updateRulePriorities.mockRejectedValue(new Error('boom'))
      await act(async () => {
        render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
      })
      await waitFor(() => expect(screen.getByText('Work Events')).toBeInTheDocument())

      dropRow('1', '2')

      await waitFor(() =>
        expect(screen.getByText('Failed to update rule order')).toBeInTheDocument()
      )
      // Reverts by reloading the authoritative order from the backend.
      await waitFor(() => expect(mockRulesApi.getEventTypeRules).toHaveBeenCalledTimes(2))
    })

    it('does not fire a write for a no-op drop', async () => {
      await act(async () => {
        render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
      })
      await waitFor(() => expect(screen.getByText('Work Events')).toBeInTheDocument())

      dropRow('1', '1')

      expect(mockRulesApi.updateRulePriorities).not.toHaveBeenCalled()
    })

    /* The grid auto-disables dragging while the list is sorted, filtered or
       globally searched — the displayed order stops being the data order, so
       a drop would write a sequence the user never saw. The hand-rolled
       version this replaced did not guard that. Asserted via the handle's
       state, never by attempting a drag (jsdom has no real geometry). */
    it('disables the drag handle once the grid is sorted', async () => {
      await act(async () => {
        render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
      })
      await waitFor(() => expect(screen.getByText('Work Events')).toBeInTheDocument())

      expect(handles()[0]).toHaveAttribute('aria-roledescription', 'sortable')
      expect(handles()[0]).toHaveAttribute('aria-disabled', 'false')

      fireEvent.click(screen.getByText('Rule Name'))

      expect(handles()[0]).not.toHaveAttribute('aria-roledescription')
      expect(handles()[0]).toHaveAttribute('aria-disabled', 'true')
    })

    it('disables the drag handle once the grid is globally searched', async () => {
      await act(async () => {
        render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
      })
      await waitFor(() => expect(screen.getByText('Work Events')).toBeInTheDocument())

      // A term that still leaves a row (and so a handle) on screen.
      fireEvent.change(screen.getByPlaceholderText('Search'), {
        target: { value: 'Work' },
      })

      expect(handles()[0]).not.toHaveAttribute('aria-roledescription')
      expect(handles()[0]).toHaveAttribute('aria-disabled', 'true')
    })
  })

  it('shows the section when the search term matches a rule by name, without filtering its rows', async () => {
    // Row-level filtering now belongs to the grid's own toolbar search, not
    // this page-level searchTerm prop — it only gates whether the whole
    // section renders. A matching term still shows every row.
    await act(async () => {
      render(<EventTypeRulesSettings searchTerm="free" onEventsUpdated={mockOnEventsUpdated} />)
    })

    await waitFor(() => expect(screen.getByText('Free Time')).toBeInTheDocument())
    expect(screen.getByText('Work Events')).toBeInTheDocument()
  })

  it('hides component when search term does not match', async () => {
    await act(async () => {
      const { container } = render(<EventTypeRulesSettings searchTerm="nonexistent" onEventsUpdated={mockOnEventsUpdated} />)
      expect(container.firstChild).toBeNull()
    })
  })

  it('disables process button when no rules exist', async () => {
    mockRulesApi.getEventTypeRules.mockResolvedValue([])

    await act(async () => {
      render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
    })

    await waitFor(() => {
      const processButton = screen.getByRole('button', { name: /process rules/i })
      expect(processButton).toBeDisabled()
    })
  })

  it('handles API errors gracefully', async () => {
    mockRulesApi.getEventTypeRules.mockRejectedValue(new Error('API Error'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => {
      render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
    })

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Error loading rules:', expect.any(Error))
    })

    consoleSpy.mockRestore()
  })

  /* The categories exist to be offered in the rule editor, so that is what
     is worth asserting — the old version of this test only checked that an
     API call had happened. */
  it('offers the categories when a rule tests one', async () => {
    const user = userEvent.setup()
    await act(async () => {
      render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
    })
    await waitFor(() => expect(mockEventsApi.getEventCategories).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: /add rule/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByLabelText(/field/i))
    await user.click(await screen.findByTitle('Categories'))
    await user.click(within(dialog).getByLabelText(/^value/i))

    expect(await screen.findByTitle('Work')).toBeInTheDocument()
    expect(screen.getByTitle('Personal')).toBeInTheDocument()
  })
})
