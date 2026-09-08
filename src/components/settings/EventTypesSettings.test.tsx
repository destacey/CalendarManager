import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, act, render, fireEvent } from '../../test/utils'
import EventTypesSettings from './EventTypesSettings'
import type { EventType } from '../../types'
import * as eventTypesApi from '../../api/eventTypes'
import { saveFile } from '../../api/files'

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

// The grid's CSV export writes through this — mocked so the export test below
// can inspect the bytes without a real save dialog (same pattern as
// DataGrid.test.tsx).
vi.mock('../../api/files', () => ({ saveFile: vi.fn() }))

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

    vi.mocked(saveFile).mockReset()
    vi.mocked(saveFile).mockResolvedValue(true)
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

  it('colors the Billable cell instead of the yesNo preset\'s plain text', async () => {
    // The migration keeps meta: { columnType: 'yesNo' } (for its sort/filter
    // behaviour) but restores an explicit `cell`, which column-types.ts's
    // applyColumnType lets win over the preset's own plain-text cell. Both
    // mock rows are is_billable: false, so this pins the "No" / secondary
    // rendering specifically.
    await act(async () => {
      render(<EventTypesSettings />)
    })

    await waitFor(() => {
      expect(screen.getAllByText('No').length).toBeGreaterThan(0)
    })

    const billableCell = screen.getAllByText('No')[0]
    expect(billableCell.className).toMatch(/ant-typography-secondary/)
  })

  it('still exports Billable as Yes/No via the yesNo columnType preset, not a raw boolean', async () => {
    // Pins the preset surviving: the explicit `cell` above only changes
    // display, but CSV export reads TanStack's own accessor (row.getValue),
    // which is the yesNo preset's boolean -> "Yes"/"No" accessorFn. If a
    // future edit dropped `columnType: 'yesNo'`, is_billable's raw boolean
    // would flow straight to the CSV as the literal string "false".
    await act(async () => {
      render(<EventTypesSettings />)
    })

    await waitFor(() => {
      expect(screen.getByText('Work')).toBeInTheDocument()
    })

    const exportButton = document
      .querySelector('[aria-label="download"]')
      ?.closest('button') as HTMLButtonElement
    expect(exportButton).toBeTruthy()

    fireEvent.click(exportButton)
    await waitFor(() => expect(saveFile).toHaveBeenCalled())

    const csv = new TextDecoder()
      .decode(vi.mocked(saveFile).mock.calls.at(-1)![1])
      .replace(/^﻿/, '')

    expect(csv).toContain('No')
    expect(csv).not.toMatch(/\bfalse\b/)
    expect(csv).not.toMatch(/\btrue\b/)
  })
})