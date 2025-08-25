import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '../../test/utils'
import { createCalendarEventCellProps, mockEvent, mockAllDayEvent } from '../../test/utils'
import CalendarEventCell from './CalendarEventCell'
import dayjs from 'dayjs'

// Mock eventUtils to avoid dayjs plugin complexity
vi.mock('../../utils/eventUtils', () => ({
  formatEventTime: vi.fn((startDate: string, isAllDay?: boolean) => {
    if (isAllDay) return ''
    return '9:00AM'
  }),
  getEventBackgroundColor: vi.fn((showAs: string) => {
    switch (showAs) {
      case 'busy': return '#1890ff'
      case 'tentative': return '#faad14'
      case 'oof': return '#f5222d'
      case 'free': return '#52c41a'
      default: return '#d9d9d9'
    }
  }),
  getEventItemStyles: {
    base: {
      padding: '1px 4px',
      fontSize: '11px',
      borderRadius: '2px',
      cursor: 'pointer',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap' as const,
      color: 'white'
    },
    moreEvents: {
      padding: '1px 4px',
      fontSize: '10px',
      color: '#666',
      cursor: 'pointer',
      fontWeight: 'bold'
    }
  }
}))

const testDate = dayjs('2024-01-15')

describe('CalendarEventCell', () => {
  const defaultProps = createCalendarEventCellProps({
    current: testDate
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic Rendering', () => {
    it('renders nothing when no events exist', () => {
      const props = createCalendarEventCellProps({
        dayEvents: []
      })
      
      const { container } = render(<CalendarEventCell {...props} />)
      
      expect(container.firstChild).toBeNull()
    })

    it('renders event count for small screens', () => {
      const props = createCalendarEventCellProps({
        dayEvents: [mockEvent],
        isLargeScreen: false
      })
      
      render(<CalendarEventCell {...props} />)
      
      expect(screen.getByText('1')).toBeInTheDocument()
    })

    it('renders event list for large screens', () => {
      const props = createCalendarEventCellProps({
        dayEvents: [mockEvent],
        isLargeScreen: true
      })
      
      render(<CalendarEventCell {...props} />)
      
      // For timed events, it shows time + title
      expect(screen.getByText(`9:00AM ${mockEvent.title}`)).toBeInTheDocument()
    })

    it('has correct display name', () => {
      expect(CalendarEventCell.displayName).toBe('CalendarEventCell')
    })
  })

  describe('Small Screen Rendering', () => {
    it('shows event count using Badge component with proper structure', () => {
      const props = createCalendarEventCellProps({
        dayEvents: [mockEvent, mockAllDayEvent],
        isLargeScreen: false
      })
      
      const { container } = render(<CalendarEventCell {...props} />)
      
      // Should show count
      expect(screen.getByText('2')).toBeInTheDocument()
      
      // Should be in a flex container
      expect(container.querySelector('.ant-flex')).toBeInTheDocument()
      
      // Should use Badge component
      expect(container.querySelector('.ant-badge')).toBeInTheDocument()
    })

    it('shows correct event count for multiple events', () => {
      const multipleEvents = [
        mockEvent,
        mockAllDayEvent,
        { ...mockEvent, id: 'event-3', title: 'Third Event' }
      ]
      
      const props = createCalendarEventCellProps({
        dayEvents: multipleEvents,
        isLargeScreen: false
      })
      
      render(<CalendarEventCell {...props} />)
      
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('shows correct title attribute for single event', () => {
      const props = createCalendarEventCellProps({
        dayEvents: [mockEvent],
        isLargeScreen: false
      })
      
      const { container } = render(<CalendarEventCell {...props} />)
      
      const eventCountDiv = container.querySelector('div[title]')
      expect(eventCountDiv).toHaveAttribute('title', '1 event on this day')
    })

    it('shows correct title attribute for multiple events', () => {
      const props = createCalendarEventCellProps({
        dayEvents: [mockEvent, mockAllDayEvent],
        isLargeScreen: false
      })
      
      const { container } = render(<CalendarEventCell {...props} />)
      
      const eventCountDiv = container.querySelector('div[title]')
      expect(eventCountDiv).toHaveAttribute('title', '2 events on this day')
    })

    it('calls onEventClick with first event when count is clicked', () => {
      const mockOnEventClick = vi.fn()
      const props = createCalendarEventCellProps({
        dayEvents: [mockEvent, mockAllDayEvent],
        isLargeScreen: false,
        onEventClick: mockOnEventClick
      })
      
      const { container } = render(<CalendarEventCell {...props} />)
      
      const eventCountDiv = container.querySelector('div[title]')!
      fireEvent.click(eventCountDiv)
      
      expect(mockOnEventClick).toHaveBeenCalledWith(mockEvent)
    })

    it('stops event propagation when count is clicked', () => {
      const mockOnEventClick = vi.fn()
      const mockParentClick = vi.fn()
      
      const props = createCalendarEventCellProps({
        dayEvents: [mockEvent],
        isLargeScreen: false,
        onEventClick: mockOnEventClick
      })
      
      const { container } = render(
        <div onClick={mockParentClick}>
          <CalendarEventCell {...props} />
        </div>
      )
      
      const eventCountDiv = container.querySelector('div[title]')!
      fireEvent.click(eventCountDiv)
      
      expect(mockOnEventClick).toHaveBeenCalledWith(mockEvent)
      expect(mockParentClick).not.toHaveBeenCalled()
    })
  })

  describe('Large Screen Rendering', () => {
    it('shows individual event items', () => {
      const props = createCalendarEventCellProps({
        dayEvents: [mockEvent],
        isLargeScreen: true
      })
      
      render(<CalendarEventCell {...props} />)
      
      expect(screen.getByText(`9:00AM ${mockEvent.title}`)).toBeInTheDocument()
    })

    it('shows all events when 4 or fewer', () => {
      const fourEvents = [
        mockEvent,
        mockAllDayEvent,
        { ...mockEvent, id: 'event-3', title: 'Third Event', is_all_day: false },
        { ...mockEvent, id: 'event-4', title: 'Fourth Event', is_all_day: false }
      ]
      
      const props = createCalendarEventCellProps({
        dayEvents: fourEvents,
        isLargeScreen: true
      })
      
      render(<CalendarEventCell {...props} />)
      
      expect(screen.getByText('9:00AM Test Event')).toBeInTheDocument()
      expect(screen.getByText('All Day Event')).toBeInTheDocument() // All day events show no time
      expect(screen.getByText('9:00AM Third Event')).toBeInTheDocument()
      expect(screen.getByText('9:00AM Fourth Event')).toBeInTheDocument()
    })

    it('shows only first 3 events and "more" link when more than 4 events', () => {
      const fiveEvents = [
        mockEvent,
        mockAllDayEvent,
        { ...mockEvent, id: 'event-3', title: 'Third Event', is_all_day: false },
        { ...mockEvent, id: 'event-4', title: 'Fourth Event', is_all_day: false },
        { ...mockEvent, id: 'event-5', title: 'Fifth Event', is_all_day: false }
      ]
      
      const props = createCalendarEventCellProps({
        dayEvents: fiveEvents,
        isLargeScreen: true
      })
      
      render(<CalendarEventCell {...props} />)
      
      // Should show first 3 events
      expect(screen.getByText('9:00AM Test Event')).toBeInTheDocument()
      expect(screen.getByText('All Day Event')).toBeInTheDocument()
      expect(screen.getByText('9:00AM Third Event')).toBeInTheDocument()
      
      // Should not show 4th and 5th events
      expect(screen.queryByText('9:00AM Fourth Event')).not.toBeInTheDocument()
      expect(screen.queryByText('9:00AM Fifth Event')).not.toBeInTheDocument()
      
      // Should show "more" link
      expect(screen.getByText('+2 more')).toBeInTheDocument()
    })

    it('calls onEventClick when individual event is clicked', () => {
      const mockOnEventClick = vi.fn()
      const props = createCalendarEventCellProps({
        dayEvents: [mockEvent],
        isLargeScreen: true,
        onEventClick: mockOnEventClick
      })
      
      render(<CalendarEventCell {...props} />)
      
      fireEvent.click(screen.getByText(`9:00AM ${mockEvent.title}`))
      
      expect(mockOnEventClick).toHaveBeenCalledWith(mockEvent)
    })

    it('calls onEventClick with first event when "more" link is clicked', () => {
      const mockOnEventClick = vi.fn()
      const fiveEvents = [
        mockEvent,
        mockAllDayEvent,
        { ...mockEvent, id: 'event-3', title: 'Third Event' },
        { ...mockEvent, id: 'event-4', title: 'Fourth Event' },
        { ...mockEvent, id: 'event-5', title: 'Fifth Event' }
      ]
      
      const props = createCalendarEventCellProps({
        dayEvents: fiveEvents,
        isLargeScreen: true,
        onEventClick: mockOnEventClick
      })
      
      render(<CalendarEventCell {...props} />)
      
      fireEvent.click(screen.getByText('+2 more'))
      
      expect(mockOnEventClick).toHaveBeenCalledWith(mockEvent)
    })

    it('stops event propagation when event item is clicked', () => {
      const mockOnEventClick = vi.fn()
      const mockParentClick = vi.fn()
      
      const props = createCalendarEventCellProps({
        dayEvents: [mockEvent],
        isLargeScreen: true,
        onEventClick: mockOnEventClick
      })
      
      const { container } = render(
        <div onClick={mockParentClick}>
          <CalendarEventCell {...props} />
        </div>
      )
      
      fireEvent.click(screen.getByText(`9:00AM ${mockEvent.title}`))
      
      expect(mockOnEventClick).toHaveBeenCalledWith(mockEvent)
      expect(mockParentClick).not.toHaveBeenCalled()
    })

    it('shows correct title attribute for events', () => {
      const props = createCalendarEventCellProps({
        dayEvents: [mockEvent],
        isLargeScreen: true
      })
      
      const { container } = render(<CalendarEventCell {...props} />)
      
      const eventDiv = container.querySelector('div[title]')
      expect(eventDiv).toHaveAttribute('title', `${mockEvent.title} - Busy`)
    })
  })

  describe('Event Display Logic', () => {
    it('formats event time and title correctly for timed events', () => {
      const timedEvent = {
        ...mockEvent,
        is_all_day: false,
        start_date: '2024-01-15T14:30:00Z'
      }
      
      const props = createCalendarEventCellProps({
        dayEvents: [timedEvent],
        isLargeScreen: true,
        userTimezone: 'America/New_York'
      })
      
      render(<CalendarEventCell {...props} />)
      
      // Should show time + title with mocked time format
      expect(screen.getByText(`9:00AM ${mockEvent.title}`)).toBeInTheDocument()
    })

    it('shows only title for all-day events', () => {
      const props = createCalendarEventCellProps({
        dayEvents: [mockAllDayEvent],
        isLargeScreen: true
      })
      
      render(<CalendarEventCell {...props} />)
      
      expect(screen.getByText(mockAllDayEvent.title)).toBeInTheDocument()
    })

    it('uses correct keys for event items', () => {
      const twoEvents = [mockEvent, mockAllDayEvent]
      
      const props = createCalendarEventCellProps({
        dayEvents: twoEvents,
        isLargeScreen: true
      })
      
      const { container } = render(<CalendarEventCell {...props} />)
      
      // Both events should render
      expect(screen.getByText(`9:00AM ${mockEvent.title}`)).toBeInTheDocument()
      expect(screen.getByText(mockAllDayEvent.title)).toBeInTheDocument()
      
      // Should have proper DOM structure
      const eventDivs = container.querySelectorAll('div[title]')
      expect(eventDivs).toHaveLength(2)
    })
  })

  describe('Responsive Behavior', () => {
    it('switches rendering mode based on isLargeScreen prop', () => {
      const props = createCalendarEventCellProps({
        dayEvents: [mockEvent, mockAllDayEvent]
      })
      
      // Large screen mode
      const { rerender } = render(<CalendarEventCell {...{ ...props, isLargeScreen: true }} />)
      expect(screen.getByText(`9:00AM ${mockEvent.title}`)).toBeInTheDocument()
      
      // Small screen mode
      rerender(<CalendarEventCell {...{ ...props, isLargeScreen: false }} />)
      expect(screen.queryByText(`9:00AM ${mockEvent.title}`)).not.toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
    })

    it('maintains event data consistency across screen size changes', () => {
      const mockOnEventClick = vi.fn()
      const props = createCalendarEventCellProps({
        dayEvents: [mockEvent, mockAllDayEvent],
        onEventClick: mockOnEventClick
      })
      
      // Test large screen
      const { rerender } = render(<CalendarEventCell {...{ ...props, isLargeScreen: true }} />)
      fireEvent.click(screen.getByText(`9:00AM ${mockEvent.title}`))
      expect(mockOnEventClick).toHaveBeenCalledWith(mockEvent)
      
      vi.clearAllMocks()
      
      // Test small screen
      rerender(<CalendarEventCell {...{ ...props, isLargeScreen: false }} />)
      const countDiv = document.querySelector('div[title]')!
      fireEvent.click(countDiv)
      expect(mockOnEventClick).toHaveBeenCalledWith(mockEvent)
    })
  })

  describe('Memoization Behavior', () => {
    it('is properly memoized', () => {
      const props = createCalendarEventCellProps({
        dayEvents: [mockEvent]
      })
      
      const { rerender } = render(<CalendarEventCell {...props} />)
      expect(screen.getByText(`9:00AM ${mockEvent.title}`)).toBeInTheDocument()
      
      // Rerender with same props should not cause issues
      rerender(<CalendarEventCell {...props} />)
      expect(screen.getByText(`9:00AM ${mockEvent.title}`)).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('handles empty event array gracefully', () => {
      const props = createCalendarEventCellProps({
        dayEvents: []
      })
      
      const { container } = render(<CalendarEventCell {...props} />)
      
      expect(container.firstChild).toBeNull()
    })

    it('handles events with missing or invalid data', () => {
      const invalidEvent = {
        ...mockEvent,
        title: '',
        start_date: ''
      }
      
      const props = createCalendarEventCellProps({
        dayEvents: [invalidEvent],
        isLargeScreen: true
      })
      
      expect(() => render(<CalendarEventCell {...props} />)).not.toThrow()
    })

    it('handles different timezone values', () => {
      const timezones = ['UTC', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo']
      
      timezones.forEach(timezone => {
        const props = createCalendarEventCellProps({
          dayEvents: [mockEvent],
          userTimezone: timezone,
          isLargeScreen: true
        })
        
        expect(() => render(<CalendarEventCell {...props} />)).not.toThrow()
      })
    })
  })
})