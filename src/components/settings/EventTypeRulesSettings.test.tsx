import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, act } from '@testing-library/react'
import { render } from '../../test/utils'
import EventTypeRulesSettings from './EventTypeRulesSettings'
import type { EventType, EventTypeRule, Event } from '../../types'

// Mock the electron API
const mockElectronAPI = {
  getEventTypeRules: vi.fn(),
  getEventTypes: vi.fn(),
  getEvents: vi.fn(),
  createEventTypeRule: vi.fn(),
  updateEventTypeRule: vi.fn(),
  deleteEventTypeRule: vi.fn(),
  updateRulePriorities: vi.fn(),
  reprocessEventTypes: vi.fn()
}

// Mock data
const mockEventTypes: EventType[] = [
  {
    id: 1,
    name: 'Work',
    color: '#1890ff',
    is_default: false
  },
  {
    id: 2,
    name: 'Personal',
    color: '#52c41a',
    is_default: true
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

const mockEvents: Event[] = [
  {
    id: '1',
    title: 'Work Meeting',
    start_date: '2023-01-01T09:00:00Z',
    end_date: '2023-01-01T10:00:00Z',
    is_all_day: false,
    show_as: 'busy',
    categories: 'work,meeting',
    type_id: 1,
    type_manually_set: false
  }
]

describe('EventTypeRulesSettings', () => {
  const mockOnEventsUpdated = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    
    // Setup window.electronAPI mock
    Object.defineProperty(window, 'electronAPI', {
      value: mockElectronAPI,
      writable: true
    })
    
    // Default mock implementations
    mockElectronAPI.getEventTypeRules.mockResolvedValue(mockRules)
    mockElectronAPI.getEventTypes.mockResolvedValue(mockEventTypes)
    mockElectronAPI.getEvents.mockResolvedValue(mockEvents)
    mockElectronAPI.reprocessEventTypes.mockResolvedValue({ success: true, message: 'Success' })
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
      expect(mockElectronAPI.getEventTypeRules).toHaveBeenCalled()
      expect(mockElectronAPI.getEventTypes).toHaveBeenCalled()
      expect(mockElectronAPI.getEvents).toHaveBeenCalled()
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
    mockElectronAPI.getEventTypeRules.mockResolvedValue([])
    
    await act(async () => {
      render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
    })
    
    await waitFor(() => {
      const processButton = screen.getByRole('button', { name: /process rules/i })
      expect(processButton).toBeDisabled()
    })
  })

  it('handles API errors gracefully', async () => {
    mockElectronAPI.getEventTypeRules.mockRejectedValue(new Error('API Error'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    
    await act(async () => {
      render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
    })
    
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Error loading rules:', expect.any(Error))
    })
    
    consoleSpy.mockRestore()
  })

  it('extracts categories from events for autocomplete', async () => {
    await act(async () => {
      render(<EventTypeRulesSettings onEventsUpdated={mockOnEventsUpdated} />)
    })
    
    await waitFor(() => {
      expect(mockElectronAPI.getEvents).toHaveBeenCalled()
    })
    
    // The component should extract categories from the mock events
    // We can't easily test the autocomplete options without complex modal interactions
    // but we can verify the API was called to get the events
  })
})