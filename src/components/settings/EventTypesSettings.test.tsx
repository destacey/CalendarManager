import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, act, render, fireEvent } from '../../test/utils'
import EventTypesSettings from './EventTypesSettings'
import type { EventType } from '../../types'
import * as eventTypesApi from '../../api/eventTypes'

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

// Mock the eventTypes API module
vi.mock('../../api/eventTypes', () => ({
  getEventTypes: vi.fn(),
  createEventType: vi.fn(),
  updateEventType: vi.fn(),
  deleteEventType: vi.fn(),
  setDefaultEventType: vi.fn()
}))

const mockEventTypesApi = vi.mocked(eventTypesApi)

// Mock data
const mockEventTypes: EventType[] = [
  {
    id: 1,
    name: 'Work',
    color: '#1890ff',
    is_default: false,
    is_billable: false, all_day_hours: 8,
    created_at: '2023-01-01T00:00:00Z'
  },
  {
    id: 2,
    name: 'Personal',
    color: '#52c41a',
    is_default: true,
    is_billable: false, all_day_hours: 8,
    created_at: '2023-01-01T00:00:00Z'
  }
]

describe('EventTypesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations
    mockEventTypesApi.getEventTypes.mockResolvedValue(mockEventTypes)
    mockEventTypesApi.createEventType.mockResolvedValue({ id: 3, name: 'New Type', color: '#000000', is_billable: false, all_day_hours: 8 })
    mockEventTypesApi.updateEventType.mockResolvedValue(mockEventTypes[0])
    mockEventTypesApi.deleteEventType.mockResolvedValue({ deleted: true, eventsReassigned: 0, rulesRemoved: 0, reassignedTo: null })
    mockEventTypesApi.setDefaultEventType.mockResolvedValue(true)
  })

  it('renders the component with basic elements', async () => {
    await act(async () => {
      render(<EventTypesSettings />)
    })
    
    expect(screen.getByText('Types')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add type/i })).toBeInTheDocument()
    expect(screen.getByText(/define event types that can be automatically assigned/i)).toBeInTheDocument()
  })

  it('loads and displays event types', async () => {
    await act(async () => {
      render(<EventTypesSettings />)
    })
    
    await waitFor(() => {
      expect(mockEventTypesApi.getEventTypes).toHaveBeenCalled()
    })
    
    await waitFor(() => {
      expect(screen.getByText('Work')).toBeInTheDocument()
      expect(screen.getByText('Personal')).toBeInTheDocument()
    })
  })

  it('shows default type indicator', async () => {
    await act(async () => {
      render(<EventTypesSettings />)
    })
    
    await waitFor(() => {
      expect(screen.getByText('(Default)')).toBeInTheDocument()
    })
  })

  it('shows the section when the search term matches a type by name, without filtering its rows', async () => {
    // Row-level filtering now belongs to the grid's own toolbar search, not
    // this page-level searchTerm prop — it only gates whether the whole
    // section renders. A matching term still shows every row.
    await act(async () => {
      render(<EventTypesSettings searchTerm="work" />)
    })

    await waitFor(() => {
      expect(screen.getByText('Work')).toBeInTheDocument()
      expect(screen.getByText('Personal')).toBeInTheDocument()
    })
  })

  it('hides component when search term does not match', async () => {
    await act(async () => {
      const { container } = render(<EventTypesSettings searchTerm="nonexistent" />)
      expect(container.firstChild).toBeNull()
    })
  })

  it('handles API errors gracefully', async () => {
    mockEventTypesApi.getEventTypes.mockRejectedValue(new Error('API Error'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    
    await act(async () => {
      render(<EventTypesSettings />)
    })
    
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Error loading event types:', expect.any(Error))
    })
    
    consoleSpy.mockRestore()
  })

  it('displays event type colors as color swatches', async () => {
    await act(async () => {
      render(<EventTypesSettings />)
    })
    
    await waitFor(() => {
      // Check if color swatches are rendered (they have specific background colors)
      const elements = document.querySelectorAll('[style*="background-color"]')
      expect(elements.length).toBeGreaterThan(0)
    })
  })

  it('shows a row actions menu with edit and delete for each type', async () => {
    // Individual per-action buttons were replaced by the grid's single
    // "..." row-actions dropdown; open one and check its menu contents.
    await act(async () => {
      render(<EventTypesSettings />)
    })

    let actionButtons: HTMLElement[] = []
    await waitFor(() => {
      actionButtons = screen.getAllByLabelText('Row actions')
      expect(actionButtons.length).toBe(2) // Two event types
    })

    fireEvent.click(actionButtons[0])

    // antd 6 renders a menu item's icon label inline with its text, so an
    // anchored /^edit$/i or /^delete$/i regex matches nothing — match on a
    // substring instead.
    expect(await screen.findByText(/edit/i)).toBeInTheDocument()
    expect(await screen.findByText(/delete/i)).toBeInTheDocument()
  })
})