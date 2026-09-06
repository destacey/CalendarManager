import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, act, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import EventTypeRulesSettings from './EventTypeRulesSettings'
import type { EventType, EventTypeRule } from '../../types'
import * as rulesApi from '../../api/rules'
import * as eventTypesApi from '../../api/eventTypes'
import * as eventsApi from '../../api/events'

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


describe('EventTypeRulesSettings', () => {
  const mockOnEventsUpdated = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

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

  it('shows priority numbers with drag handles', async () => {
    await act(async () => {
      render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
    })
    
    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
    })
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

  it('shows edit and delete buttons for each rule', async () => {
    await act(async () => {
      render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
    })
    
    await waitFor(() => {
      const editButtons = screen.getAllByLabelText(/edit/i)
      const deleteButtons = screen.getAllByLabelText(/delete/i)
      
      expect(editButtons.length).toBe(2) // Two rules
      expect(deleteButtons.length).toBe(2)
    })
  })

  it('filters rules based on search term', async () => {
    await act(async () => {
      render(<EventTypeRulesSettings searchTerm="work" onEventsUpdated={mockOnEventsUpdated} />)
    })
    
    await waitFor(() => {
      expect(screen.getByText('Work Events')).toBeInTheDocument()
      expect(screen.queryByText('Free Time')).not.toBeInTheDocument()
    })
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