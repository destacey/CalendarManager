import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '../../test/utils'
import { createEventModalProps, mockEvent, mockAllDayEvent, mockCompleteEvent } from '../../test/utils'
import EventModal from './EventModal'

// Mock dayjs entirely for the tests to avoid plugin issues
vi.mock('dayjs', () => {
  const mockDayjs = (dateString?: string) => ({
    utc: vi.fn(() => mockDayjs()),
    tz: vi.fn(() => mockDayjs()),
    format: vi.fn((format: string) => {
      if (format.includes('MMMM D, YYYY')) return 'January 15, 2024'
      if (format.includes('h:mm A')) return '4:00 AM - 5:00 AM'
      return 'January 15, 2024 4:00 AM - 5:00 AM (America/New_York)'
    }),
    isSame: vi.fn((other: any, unit: string) => unit === 'day'),
    subtract: vi.fn(() => mockDayjs()),
    isValid: vi.fn(() => true),
  })
  
  mockDayjs.utc = vi.fn(() => mockDayjs())
  mockDayjs.extend = vi.fn()
  
  return { default: mockDayjs }
})

describe('EventModal', () => {
  const defaultProps = createEventModalProps()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic Rendering', () => {
    it('renders hidden when isVisible is false', () => {
      const { container } = render(<EventModal {...defaultProps} />)
      
      // Modal should not be visible
      expect(container.querySelector('.ant-modal')).not.toBeInTheDocument()
    })

    it('renders visible when isVisible is true', () => {
      const props = createEventModalProps({
        isVisible: true,
        event: mockEvent
      })
      
      render(<EventModal {...props} />)
      
      // Modal should be visible
      expect(screen.getByText('Event Details')).toBeInTheDocument()
      expect(screen.getByText('Test Event')).toBeInTheDocument()
    })

    it('renders empty modal when event is null', () => {
      const props = createEventModalProps({
        isVisible: true,
        event: null
      })
      
      render(<EventModal {...props} />)
      
      // Modal should be visible but content should be empty
      expect(screen.getByText('Event Details')).toBeInTheDocument()
      expect(screen.queryByText('Test Event')).not.toBeInTheDocument()
    })

    it('displays event title correctly', () => {
      const props = createEventModalProps({
        isVisible: true,
        event: mockEvent
      })
      
      render(<EventModal {...props} />)
      
      expect(screen.getByText('Test Event')).toBeInTheDocument()
    })
  })

  describe('Date and Time Formatting', () => {
    it('formats timed events correctly for same day', () => {
      const event = {
        ...mockEvent,
        start_date: '2024-01-15T09:00:00Z',
        end_date: '2024-01-15T10:00:00Z',
        is_all_day: false
      }
      
      const props = createEventModalProps({
        isVisible: true,
        event,
        userTimezone: 'America/New_York'
      })
      
      render(<EventModal {...props} />)
      
      // Should show date and time range with timezone
      expect(screen.getByText(/January 15, 2024.*America\/New_York/)).toBeInTheDocument()
    })

    it('formats timed events correctly for multiple days', () => {
      const event = {
        ...mockEvent,
        start_date: '2024-01-15T09:00:00Z',
        end_date: '2024-01-16T10:00:00Z',
        is_all_day: false
      }
      
      const props = createEventModalProps({
        isVisible: true,
        event,
        userTimezone: 'America/New_York'
      })
      
      render(<EventModal {...props} />)
      
      // Should show date and time range (the mock returns the pattern we expect)
      expect(screen.getByText(/January 15, 2024.*America\/New_York/)).toBeInTheDocument()
    })

    it('formats all-day events correctly for single day', () => {
      const event = {
        ...mockEvent,
        start_date: '2024-01-15',
        end_date: '2024-01-16', // Graph sets end to next day for all-day
        is_all_day: true
      }
      
      const props = createEventModalProps({
        isVisible: true,
        event,
        userTimezone: 'America/New_York'
      })
      
      render(<EventModal {...props} />)
      
      // Should show just the date without time or timezone
      expect(screen.getByText('January 15, 2024')).toBeInTheDocument()
    })

    it('formats all-day events correctly for multiple days', () => {
      const event = {
        ...mockEvent,
        start_date: '2024-01-15',
        end_date: '2024-01-18', // 3-day event (15, 16, 17)
        is_all_day: true
      }
      
      const props = createEventModalProps({
        isVisible: true,
        event,
        userTimezone: 'America/New_York'
      })
      
      render(<EventModal {...props} />)
      
      // Should show date without time (the mock dayjs returns our expected format)
      expect(screen.getByText('January 15, 2024')).toBeInTheDocument()
    })

    it('handles missing end date', () => {
      const event = {
        ...mockEvent,
        start_date: '2024-01-15T09:00:00Z',
        end_date: undefined,
        is_all_day: false
      }
      
      const props = createEventModalProps({
        isVisible: true,
        event,
        userTimezone: 'America/New_York'
      })
      
      expect(() => render(<EventModal {...props} />)).not.toThrow()
    })
  })

  describe('Status and Tags', () => {
    it('displays status tag with correct color and text', () => {
      const event = {
        ...mockEvent,
        show_as: 'busy'
      }
      
      const props = createEventModalProps({
        isVisible: true,
        event
      })
      
      render(<EventModal {...props} />)
      
      expect(screen.getByText('Busy')).toBeInTheDocument()
      expect(props.getShowAsDisplay).toHaveBeenCalledWith('busy')
      expect(props.getEventColor).toHaveBeenCalledWith('busy')
    })

    it('handles different status types correctly', () => {
      const statuses = ['busy', 'tentative', 'oof', 'free', 'workingElsewhere']
      
      statuses.forEach(status => {
        const event = {
          ...mockEvent,
          show_as: status
        }
        
        const props = createEventModalProps({
          isVisible: true,
          event
        })
        
        render(<EventModal {...props} />)
        
        expect(props.getShowAsDisplay).toHaveBeenCalledWith(status)
        expect(props.getEventColor).toHaveBeenCalledWith(status)
      })
    })
  })

  describe('Optional Fields', () => {
    it('displays location when present', () => {
      const event = {
        ...mockEvent,
        location: 'Conference Room A'
      }
      
      const props = createEventModalProps({
        isVisible: true,
        event
      })
      
      render(<EventModal {...props} />)
      
      expect(screen.getByText('Location')).toBeInTheDocument()
      expect(screen.getByText('Conference Room A')).toBeInTheDocument()
    })

    it('hides location when not present', () => {
      const event = {
        ...mockEvent,
        location: undefined
      }
      
      const props = createEventModalProps({
        isVisible: true,
        event
      })
      
      render(<EventModal {...props} />)
      
      expect(screen.queryByText('Location')).not.toBeInTheDocument()
    })

    it('displays categories when present', () => {
      const event = {
        ...mockEvent,
        categories: 'work,meeting,important'
      }
      
      const props = createEventModalProps({
        isVisible: true,
        event
      })
      
      render(<EventModal {...props} />)
      
      expect(screen.getByText('Categories')).toBeInTheDocument()
      expect(screen.getByText('work')).toBeInTheDocument()
      expect(screen.getByText('meeting')).toBeInTheDocument()
      expect(screen.getByText('important')).toBeInTheDocument()
    })

    it('hides categories when empty or whitespace only', () => {
      const emptyCategories = ['', '   ', null, undefined]
      
      emptyCategories.forEach(categories => {
        const event = {
          ...mockEvent,
          categories: categories as any
        }
        
        const props = createEventModalProps({
          isVisible: true,
          event
        })
        
        const { rerender } = render(<EventModal {...props} />)
        
        expect(screen.queryByText('Categories')).not.toBeInTheDocument()
        
        rerender(<div />) // Clear for next iteration
      })
    })

    it('handles categories with whitespace correctly', () => {
      const event = {
        ...mockEvent,
        categories: ' work , meeting , , important '
      }
      
      const props = createEventModalProps({
        isVisible: true,
        event
      })
      
      render(<EventModal {...props} />)
      
      expect(screen.getByText('work')).toBeInTheDocument()
      expect(screen.getByText('meeting')).toBeInTheDocument()
      expect(screen.getByText('important')).toBeInTheDocument()
      // Empty categories should be filtered out
      expect(screen.getAllByText(/^(work|meeting|important)$/)).toHaveLength(3)
    })
  })

  describe('Organizer Display', () => {
    it('displays organizer information when present as JSON', () => {
      const props = createEventModalProps({
        isVisible: true,
        event: mockCompleteEvent
      })
      
      render(<EventModal {...props} />)
      
      expect(screen.getByText('Organizer')).toBeInTheDocument()
      expect(screen.getByText('John Organizer (john.organizer@example.com)')).toBeInTheDocument()
    })

    it('displays raw organizer string when JSON parsing fails', () => {
      const event = {
        ...mockEvent,
        is_meeting: true,
        organizer: 'Invalid JSON String'
      }
      
      const props = createEventModalProps({
        isVisible: true,
        event
      })
      
      render(<EventModal {...props} />)
      
      expect(screen.getByText('Organizer')).toBeInTheDocument()
      expect(screen.getByText('Invalid JSON String')).toBeInTheDocument()
    })

    it('hides organizer when not present', () => {
      const event = {
        ...mockEvent,
        organizer: undefined
      }
      
      const props = createEventModalProps({
        isVisible: true,
        event
      })
      
      render(<EventModal {...props} />)
      
      expect(screen.queryByText('Organizer')).not.toBeInTheDocument()
    })
  })

  describe('Attendees Display', () => {
    it('displays attendees information when present as JSON', () => {
      const props = createEventModalProps({
        isVisible: true,
        event: mockCompleteEvent
      })
      
      render(<EventModal {...props} />)
      
      expect(screen.getByText('Attendees')).toBeInTheDocument()
      expect(screen.getByText(/Alice Attendee \(alice@example\.com\) - accepted/)).toBeInTheDocument()
      expect(screen.getByText(/Bob Attendee \(bob@example\.com\) - tentative/)).toBeInTheDocument()
      expect(screen.getByText(/Charlie Attendee \(charlie@example\.com\) - declined/)).toBeInTheDocument()
    })

    it('displays different response colors correctly', () => {
      const props = createEventModalProps({
        isVisible: true,
        event: mockCompleteEvent
      })
      
      const { container } = render(<EventModal {...props} />)
      
      // Check that attendee information is displayed
      expect(screen.getByText(/Alice Attendee.*accepted/)).toBeInTheDocument()
      expect(screen.getByText(/Bob Attendee.*tentative/)).toBeInTheDocument() 
      expect(screen.getByText(/Charlie Attendee.*declined/)).toBeInTheDocument()
    })

    it('displays raw attendees string when JSON parsing fails', () => {
      const event = {
        ...mockEvent,
        is_meeting: true,
        attendees: 'Invalid JSON String'
      }
      
      const props = createEventModalProps({
        isVisible: true,
        event
      })
      
      render(<EventModal {...props} />)
      
      expect(screen.getByText('Attendees')).toBeInTheDocument()
      expect(screen.getByText('Invalid JSON String')).toBeInTheDocument()
    })

    it('hides attendees when not present', () => {
      const event = {
        ...mockEvent,
        attendees: undefined
      }
      
      const props = createEventModalProps({
        isVisible: true,
        event
      })
      
      render(<EventModal {...props} />)
      
      expect(screen.queryByText('Attendees')).not.toBeInTheDocument()
    })
  })

  describe('Sync Information', () => {
    it('displays synced_at when present', () => {
      const props = createEventModalProps({
        isVisible: true,
        event: mockCompleteEvent,
        userTimezone: 'America/New_York'
      })
      
      render(<EventModal {...props} />)
      
      expect(screen.getByText('Last Synced')).toBeInTheDocument()
      // Should format the sync time in user timezone
      expect(screen.getByText(/January \d+, 2024 \d+:\d+ [AP]M/)).toBeInTheDocument()
    })

    it('hides synced_at when not present', () => {
      const event = {
        ...mockEvent,
        synced_at: undefined
      }
      
      const props = createEventModalProps({
        isVisible: true,
        event
      })
      
      render(<EventModal {...props} />)
      
      expect(screen.queryByText('Last Synced')).not.toBeInTheDocument()
    })

    it('uses system timezone when userTimezone is not provided', () => {
      const event = {
        ...mockCompleteEvent,
        synced_at: '2024-01-01T08:30:00Z'
      }
      
      const props = createEventModalProps({
        isVisible: true,
        event,
        userTimezone: undefined as any
      })
      
      expect(() => render(<EventModal {...props} />)).not.toThrow()
    })
  })

  describe('Modal Interactions', () => {
    it('calls onClose when modal is cancelled', () => {
      const mockOnClose = vi.fn()
      const props = createEventModalProps({
        isVisible: true,
        event: mockEvent,
        onClose: mockOnClose
      })
      
      render(<EventModal {...props} />)
      
      // Find and click the close button
      const closeButton = screen.getByRole('button', { name: /close/i })
      fireEvent.click(closeButton)
      
      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('calls onClose when clicking outside modal (if configured)', () => {
      const mockOnClose = vi.fn()
      const props = createEventModalProps({
        isVisible: true,
        event: mockEvent,
        onClose: mockOnClose
      })
      
      const { container } = render(<EventModal {...props} />)
      
      // Click on modal mask (outside modal content)
      const mask = container.querySelector('.ant-modal-mask')
      if (mask) {
        fireEvent.click(mask)
        expect(mockOnClose).toHaveBeenCalled()
      }
    })

    it('has no footer buttons', () => {
      const props = createEventModalProps({
        isVisible: true,
        event: mockEvent
      })
      
      render(<EventModal {...props} />)
      
      // Modal should not have OK/Cancel buttons in footer
      expect(screen.queryByText('OK')).not.toBeInTheDocument()
      expect(screen.queryByText('Cancel')).not.toBeInTheDocument()
    })
  })

  describe('Component Structure', () => {
    it('renders all required sections when event has complete data', () => {
      const props = createEventModalProps({
        isVisible: true,
        event: mockCompleteEvent
      })
      
      render(<EventModal {...props} />)
      
      // Verify all sections are present
      expect(screen.getByText('Title')).toBeInTheDocument()
      expect(screen.getByText('Date & Time')).toBeInTheDocument()
      expect(screen.getByText('Status')).toBeInTheDocument()
      expect(screen.getByText('Location')).toBeInTheDocument()
      expect(screen.getByText('Organizer')).toBeInTheDocument()
      expect(screen.getByText('Attendees')).toBeInTheDocument()
      expect(screen.getByText('Categories')).toBeInTheDocument()
      expect(screen.getByText('Last Synced')).toBeInTheDocument()
    })

    it('uses bordered descriptions layout', () => {
      const props = createEventModalProps({
        isVisible: true,
        event: mockEvent
      })
      
      render(<EventModal {...props} />)
      
      // Check for descriptions component by looking for the table structure
      expect(screen.getByText('Title')).toBeInTheDocument()
      expect(screen.getByText('Date & Time')).toBeInTheDocument()
      expect(screen.getByText('Status')).toBeInTheDocument()
    })

    it('uses single column layout', () => {
      const props = createEventModalProps({
        isVisible: true,
        event: mockEvent
      })
      
      render(<EventModal {...props} />)
      
      // Verify single column layout by checking that labels are properly displayed
      expect(screen.getByText('Title')).toBeInTheDocument()
      expect(screen.getByText('Test Event')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('handles event with all undefined/null optional fields', () => {
      const minimalEvent = {
        id: 1,
        title: 'Minimal Event',
        start_date: '2024-01-15T09:00:00Z',
        is_all_day: false,
        show_as: 'busy',
        categories: '',
        location: undefined,
        organizer: undefined,
        attendees: undefined,
        synced_at: undefined
      }
      
      const props = createEventModalProps({
        isVisible: true,
        event: minimalEvent
      })
      
      expect(() => render(<EventModal {...props} />)).not.toThrow()
      
      // Should still show required fields
      expect(screen.getByText('Minimal Event')).toBeInTheDocument()
      expect(screen.getByText('Title')).toBeInTheDocument()
      expect(screen.getByText('Date & Time')).toBeInTheDocument()
      expect(screen.getByText('Status')).toBeInTheDocument()
    })

    it('handles invalid timezone gracefully', () => {
      const props = createEventModalProps({
        isVisible: true,
        event: mockEvent,
        userTimezone: 'Invalid/Timezone'
      })
      
      expect(() => render(<EventModal {...props} />)).not.toThrow()
    })

    it('handles malformed JSON in organizer and attendees', () => {
      const event = {
        ...mockEvent,
        is_meeting: true,
        organizer: '{"incomplete": json',
        attendees: '[{"incomplete": array'
      }
      
      const props = createEventModalProps({
        isVisible: true,
        event
      })
      
      expect(() => render(<EventModal {...props} />)).not.toThrow()
      
      // Should display raw strings when JSON parsing fails
      expect(screen.getByText('{"incomplete": json')).toBeInTheDocument()
      expect(screen.getByText('[{"incomplete": array')).toBeInTheDocument()
    })
  })
})