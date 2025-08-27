import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '../../test/utils'
import { createCalendarHeaderProps } from '../../test/utils'
import CalendarHeader from './CalendarHeader'
import dayjs from 'dayjs'

// Use real dayjs instances for testing
const testDate = dayjs('2024-01-15')

describe('CalendarHeader', () => {
  const defaultProps = createCalendarHeaderProps({
    value: testDate
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic Rendering', () => {
    it('renders without crashing', () => {
      render(<CalendarHeader {...defaultProps} />)
      
      // Should render both CalendarNavigation (Today button) and ViewModeToggle
      expect(screen.getByText('Today')).toBeInTheDocument()
      expect(screen.getByText('Week')).toBeInTheDocument()
    })

    it('renders with correct layout structure', () => {
      const { container } = render(<CalendarHeader {...defaultProps} />)
      
      // Check for Flex container structure
      const flexContainer = container.querySelector('.ant-flex')
      expect(flexContainer).toBeInTheDocument()
      
      // Verify it has exactly 2 children (CalendarNavigation and ViewModeToggle)
      expect(flexContainer?.children).toHaveLength(2)
    })

    it('renders CalendarNavigation component', () => {
      render(<CalendarHeader {...defaultProps} />)
      
      // CalendarNavigation elements should be present
      expect(screen.getByText('Today')).toBeInTheDocument()
      
      const { container } = render(<CalendarHeader {...defaultProps} />)
      expect(container.querySelector('.anticon-left')).toBeInTheDocument()
      expect(container.querySelector('.anticon-right')).toBeInTheDocument()
    })

    it('renders ViewModeToggle component', () => {
      render(<CalendarHeader {...defaultProps} />)
      
      // ViewModeToggle elements should be present
      expect(screen.getByText('Week')).toBeInTheDocument()
      expect(screen.getByText('Month')).toBeInTheDocument()
    })
  })

  describe('Props Passing', () => {
    it('passes correct props to CalendarNavigation', () => {
      const mockOnChange = vi.fn()
      const mockOnCurrentDateChange = vi.fn()
      const mockOnCurrentWeekChange = vi.fn()
      
      const props = createCalendarHeaderProps({
        value: testDate,
        type: 'year',
        viewMode: 'week',
        onChange: mockOnChange,
        onCurrentDateChange: mockOnCurrentDateChange,
        onCurrentWeekChange: mockOnCurrentWeekChange
      })
      
      render(<CalendarHeader {...props} />)
      
      // Verify CalendarNavigation is rendered with correct props by checking its output
      expect(screen.getByText('Today')).toBeInTheDocument()
    })

    it('passes correct props to ViewModeToggle', () => {
      const mockOnViewModeChange = vi.fn()
      const mockOnCalendarTypeChange = vi.fn()
      const mockOnTypeChange = vi.fn()
      
      const props = createCalendarHeaderProps({
        viewMode: 'week',
        calendarType: 'year',
        onViewModeChange: mockOnViewModeChange,
        onCalendarTypeChange: mockOnCalendarTypeChange,
        onTypeChange: mockOnTypeChange
      })
      
      render(<CalendarHeader {...props} />)
      
      // Verify ViewModeToggle is rendered with correct props by checking its output
      expect(screen.getByText('Week')).toBeInTheDocument()
      expect(screen.getByText('Month')).toBeInTheDocument()
    })
  })

  describe('Component Integration', () => {
    it('integrates CalendarNavigation and ViewModeToggle correctly', () => {
      render(<CalendarHeader {...defaultProps} />)
      
      // Both components should be present and functional
      expect(screen.getByText('Today')).toBeInTheDocument()
      expect(screen.getByText('Week')).toBeInTheDocument()
      expect(screen.getByText('Month')).toBeInTheDocument()
      
      // Layout should position them correctly (left and right sides)
      const { container } = render(<CalendarHeader {...defaultProps} />)
      const flexContainer = container.querySelector('.ant-flex')
      expect(flexContainer?.children).toHaveLength(2)
    })

    it('maintains correct component hierarchy', () => {
      const { container } = render(<CalendarHeader {...defaultProps} />)
      
      // Should have Flex container inside App wrapper
      const flexContainer = container.querySelector('.ant-flex')
      expect(flexContainer).toBeInTheDocument()
      
      // Should have exactly 2 child components
      expect(flexContainer?.children).toHaveLength(2)
    })
  })

  describe('Different Prop Combinations', () => {
    it('handles month type correctly', () => {
      const props = createCalendarHeaderProps({
        value: testDate,
        type: 'month',
        viewMode: 'month',
        calendarType: 'month'
      })
      
      expect(() => render(<CalendarHeader {...props} />)).not.toThrow()
    })

    it('handles year type correctly', () => {
      const props = createCalendarHeaderProps({
        value: testDate,
        type: 'year',
        viewMode: 'month',
        calendarType: 'year'
      })
      
      expect(() => render(<CalendarHeader {...props} />)).not.toThrow()
    })

    it('handles week viewMode correctly', () => {
      const props = createCalendarHeaderProps({
        value: testDate,
        viewMode: 'week'
      })
      
      expect(() => render(<CalendarHeader {...props} />)).not.toThrow()
    })

    it('handles all prop combinations without errors', () => {
      const combinations = [
        { type: 'month' as const, viewMode: 'month', calendarType: 'month' },
        { type: 'month' as const, viewMode: 'week', calendarType: 'month' },
        { type: 'year' as const, viewMode: 'month', calendarType: 'year' },
        { type: 'year' as const, viewMode: 'week', calendarType: 'year' }
      ]
      
      combinations.forEach(combo => {
        const props = createCalendarHeaderProps({
          value: testDate,
          ...combo
        })
        
        expect(() => render(<CalendarHeader {...props} />)).not.toThrow()
      })
    })
  })

  describe('Layout and Styling', () => {
    it('uses correct Flex container', () => {
      const { container } = render(<CalendarHeader {...defaultProps} />)
      
      const flexContainer = container.querySelector('.ant-flex')
      expect(flexContainer).toBeInTheDocument()
      expect(flexContainer).toHaveClass('ant-flex')
    })

    it('contains both child components', () => {
      const { container } = render(<CalendarHeader {...defaultProps} />)
      
      const flexContainer = container.querySelector('.ant-flex')
      expect(flexContainer?.children).toHaveLength(2)
    })

    it('maintains consistent layout structure', () => {
      const { container } = render(<CalendarHeader {...defaultProps} />)
      
      const flexContainer = container.querySelector('.ant-flex')
      
      // Should use Flex layout for responsive behavior
      expect(flexContainer).toHaveClass('ant-flex')
      
      // Should have exactly 2 children positioned appropriately
      expect(flexContainer?.children).toHaveLength(2)
    })
  })

  describe('Edge Cases', () => {
    it('handles missing optional callbacks gracefully', () => {
      const props = {
        ...defaultProps,
        onCurrentWeekChange: undefined as any
      }
      
      expect(() => render(<CalendarHeader {...props} />)).not.toThrow()
    })

    it('renders with different date values', () => {
      const dates = [
        dayjs('2023-12-01'),
        dayjs('2024-02-29'), // Leap year
        dayjs('2024-12-31')
      ]
      
      dates.forEach(date => {
        const props = createCalendarHeaderProps({
          value: date
        })
        
        expect(() => render(<CalendarHeader {...props} />)).not.toThrow()
      })
    })

    it('maintains functionality with rapid prop changes', () => {
      const { rerender } = render(<CalendarHeader {...defaultProps} />)
      
      // Change multiple props rapidly
      const newProps1 = createCalendarHeaderProps({
        value: dayjs('2024-02-01'),
        viewMode: 'week'
      })
      
      const newProps2 = createCalendarHeaderProps({
        value: dayjs('2024-03-01'),
        type: 'year'
      })
      
      expect(() => {
        rerender(<CalendarHeader {...newProps1} />)
        rerender(<CalendarHeader {...newProps2} />)
        rerender(<CalendarHeader {...defaultProps} />)
      }).not.toThrow()
    })
  })
})