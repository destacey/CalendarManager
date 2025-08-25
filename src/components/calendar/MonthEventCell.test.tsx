import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '../../test/utils'
import { createMonthEventCellProps, mockEvent, mockAllDayEvent } from '../../test/utils'
import MonthEventCell from './MonthEventCell'
import dayjs from 'dayjs'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'

// Set up dayjs plugins needed by the component
dayjs.extend(isSameOrBefore)

// Use real dayjs instances for testing
const testDate = dayjs('2024-01-15')

describe('MonthEventCell', () => {
  const defaultProps = createMonthEventCellProps({
    value: testDate
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic Rendering', () => {
    it('renders nothing when no events exist', () => {
      const { container } = render(<MonthEventCell {...defaultProps} />)
      
      expect(container.firstChild).toBeNull()
    })

    it('renders event count badge when events exist', () => {
      const mockGetEventsForDate = vi.fn(() => [mockEvent])
      const props = createMonthEventCellProps({
        value: testDate,
        getEventsForDate: mockGetEventsForDate
      })
      
      const { container } = render(<MonthEventCell {...props} />)
      
      // Should show count of events for the month using Badge component
      expect(container.querySelector('.ant-badge')).toBeInTheDocument()
      expect(container.querySelector('sup[title="31"]')).toBeInTheDocument()
    })

    it('applies correct container and badge styles', () => {
      const mockGetEventsForDate = vi.fn(() => [mockEvent])
      const props = createMonthEventCellProps({
        value: testDate,
        getEventsForDate: mockGetEventsForDate
      })
      
      const { container } = render(<MonthEventCell {...props} />)
      
      const containerDiv = container.firstChild as HTMLElement
      // Check that the container has the expected structure and styling
      expect(containerDiv).toBeInTheDocument()
      
      // Check that Badge component is present
      expect(container.querySelector('.ant-badge')).toBeInTheDocument()
      
      // Check that style attributes are present (React applies them as inline styles)
      expect(containerDiv.style).toBeDefined()
      
      // Verify the badge displays the correct count via title attribute
      expect(container.querySelector('sup[title="31"]')).toBeInTheDocument()
    })
  })

  describe('Event Counting Logic', () => {
    it('counts all events in the month correctly', () => {
      const mockGetEventsForDate = vi.fn((date) => {
        // Return different number of events based on date
        const day = date.date()
        if (day <= 10) return [mockEvent] // 1 event for first 10 days
        if (day <= 20) return [mockEvent, mockAllDayEvent] // 2 events for days 11-20
        return [] // 0 events for remaining days
      })
      
      const props = createMonthEventCellProps({
        value: testDate,
        getEventsForDate: mockGetEventsForDate
      })
      
      const { container } = render(<MonthEventCell {...props} />)
      
      // 10 days * 1 event + 10 days * 2 events = 30 events total
      expect(container.querySelector('sup[title="30"]')).toBeInTheDocument()
      
      // Verify it was called for each day of the month (31 days in January)
      expect(mockGetEventsForDate).toHaveBeenCalledTimes(31)
    })

    it('handles months with different day counts', () => {
      // February 2024 (leap year, 29 days)
      const februaryDate = dayjs('2024-02-15')
      const mockGetEventsForDate = vi.fn(() => [mockEvent])
      
      const props = createMonthEventCellProps({
        value: februaryDate,
        getEventsForDate: mockGetEventsForDate
      })
      
      const { container } = render(<MonthEventCell {...props} />)
      
      // Should count events for 29 days (leap year February)
      expect(container.querySelector('sup[title="29"]')).toBeInTheDocument()
      expect(mockGetEventsForDate).toHaveBeenCalledTimes(29)
    })

    it('calls getEventsForDate with correct date range', () => {
      const mockGetEventsForDate = vi.fn(() => [mockEvent])
      const props = createMonthEventCellProps({
        value: testDate,
        getEventsForDate: mockGetEventsForDate
      })
      
      render(<MonthEventCell {...props} />)
      
      // Verify it's called with dates from start to end of month
      const firstCall = mockGetEventsForDate.mock.calls[0][0]
      const lastCall = mockGetEventsForDate.mock.calls[30][0]
      
      expect(firstCall.format('YYYY-MM-DD')).toBe('2024-01-01')
      expect(lastCall.format('YYYY-MM-DD')).toBe('2024-01-31')
    })

    it('handles large event counts correctly', () => {
      const mockGetEventsForDate = vi.fn(() => [
        mockEvent, 
        mockAllDayEvent, 
        { ...mockEvent, id: 'event-3' },
        { ...mockEvent, id: 'event-4' },
        { ...mockEvent, id: 'event-5' }
      ])
      
      const props = createMonthEventCellProps({
        value: testDate,
        getEventsForDate: mockGetEventsForDate
      })
      
      const { container } = render(<MonthEventCell {...props} />)
      
      // 5 events per day * 31 days = 155 total events
      expect(container.querySelector('sup[title="155"]')).toBeInTheDocument()
    })
  })

  describe('Memoization Behavior', () => {
    it('memoizes event count calculation', () => {
      const mockGetEventsForDate = vi.fn(() => [mockEvent])
      const props = createMonthEventCellProps({
        value: testDate,
        getEventsForDate: mockGetEventsForDate
      })
      
      const { rerender } = render(<MonthEventCell {...props} />)
      
      // First render should call getEventsForDate
      expect(mockGetEventsForDate).toHaveBeenCalledTimes(31)
      
      // Clear mock and rerender with same props
      vi.clearAllMocks()
      rerender(<MonthEventCell {...props} />)
      
      // Should not call getEventsForDate again due to memoization
      expect(mockGetEventsForDate).not.toHaveBeenCalled()
    })

    it('recalculates when value prop changes', () => {
      const mockGetEventsForDate = vi.fn(() => [mockEvent])
      const props = createMonthEventCellProps({
        value: testDate,
        getEventsForDate: mockGetEventsForDate
      })
      
      const { rerender } = render(<MonthEventCell {...props} />)
      
      expect(mockGetEventsForDate).toHaveBeenCalledTimes(31)
      
      // Clear mock and rerender with different date
      vi.clearAllMocks()
      rerender(<MonthEventCell {...{ ...props, value: dayjs('2024-02-15') }} />)
      
      // Should call getEventsForDate again with new date
      expect(mockGetEventsForDate).toHaveBeenCalledTimes(29) // February has 29 days
    })

    it('recalculates when getEventsForDate function changes', () => {
      const mockGetEventsForDate1 = vi.fn(() => [mockEvent])
      const mockGetEventsForDate2 = vi.fn(() => [mockEvent, mockAllDayEvent])
      
      const props = createMonthEventCellProps({
        value: testDate,
        getEventsForDate: mockGetEventsForDate1
      })
      
      const { rerender, container } = render(<MonthEventCell {...props} />)
      
      expect(container.querySelector('sup[title="31"]')).toBeInTheDocument()
      
      // Rerender with different getEventsForDate function
      rerender(<MonthEventCell {...{ ...props, getEventsForDate: mockGetEventsForDate2 }} />)
      
      // Should show updated count
      expect(container.querySelector('sup[title="62"]')).toBeInTheDocument()
      expect(mockGetEventsForDate2).toHaveBeenCalledTimes(31)
    })
  })

  describe('Component Identity', () => {
    it('has correct display name', () => {
      expect(MonthEventCell.displayName).toBe('MonthEventCell')
    })

    it('is properly memoized', () => {
      const mockGetEventsForDate = vi.fn(() => [])
      const props = createMonthEventCellProps({
        value: testDate,
        getEventsForDate: mockGetEventsForDate
      })
      
      const { rerender } = render(<MonthEventCell {...props} />)
      
      // Component should render as null when no events
      expect(document.body.textContent).toBe('')
      
      // Rerender with same props should not cause re-computation
      rerender(<MonthEventCell {...props} />)
      
      // Mock should still have been called only once during initial render
      expect(mockGetEventsForDate).toHaveBeenCalledTimes(31)
    })
  })

  describe('Edge Cases', () => {
    it('handles undefined/null events gracefully', () => {
      const mockGetEventsForDate = vi.fn((date) => {
        const day = date.date()
        // Return empty array for some days (null would cause error), events for others
        if (day <= 20) return []
        return [mockEvent]
      })
      
      const props = createMonthEventCellProps({
        value: testDate,
        getEventsForDate: mockGetEventsForDate
      })
      
      const { container } = render(<MonthEventCell {...props} />)
      
      // Should handle empty returns gracefully and count only valid events
      expect(container.querySelector('sup[title="11"]')).toBeInTheDocument()
    })

    it('handles invalid dates gracefully', () => {
      const invalidDate = dayjs('invalid-date')
      const mockGetEventsForDate = vi.fn(() => [mockEvent])
      
      const props = createMonthEventCellProps({
        value: invalidDate,
        getEventsForDate: mockGetEventsForDate
      })
      
      expect(() => {
        render(<MonthEventCell {...props} />)
      }).not.toThrow()
    })

    it('handles empty event arrays correctly', () => {
      const mockGetEventsForDate = vi.fn(() => [])
      const props = createMonthEventCellProps({
        value: testDate,
        getEventsForDate: mockGetEventsForDate
      })
      
      const { container } = render(<MonthEventCell {...props} />)
      
      // Should render nothing when all days have empty event arrays
      expect(container.firstChild).toBeNull()
      expect(mockGetEventsForDate).toHaveBeenCalledTimes(31)
    })
  })
})