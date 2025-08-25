import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '../../test/utils'
import { createCalendarNavigationProps } from '../../test/utils'
import CalendarNavigation from './CalendarNavigation'
import dayjs from 'dayjs'

// Use real dayjs instances for testing (similar to EventModal approach)
const testDate = dayjs('2024-01-15')

describe('CalendarNavigation', () => {
  const defaultProps = createCalendarNavigationProps({
    value: testDate
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic Rendering', () => {
    it('renders without crashing', () => {
      render(<CalendarNavigation {...defaultProps} />)
      
      expect(screen.getByText('Today')).toBeInTheDocument()
    })

    it('renders Today button with correct title', () => {
      const { container } = render(<CalendarNavigation {...defaultProps} />)
      
      const todayButton = screen.getByText('Today')
      expect(todayButton).toBeInTheDocument()
      
      // Check if title is on the button element or its parent (Ant Design Button behavior)
      const buttonElement = container.querySelector('button')
      expect(buttonElement).toHaveAttribute('title', 'Go to today')
    })

    it('renders navigation arrows', () => {
      const { container } = render(<CalendarNavigation {...defaultProps} />)
      
      // Check for left and right arrow icons
      expect(container.querySelector('.anticon-left')).toBeInTheDocument()
      expect(container.querySelector('.anticon-right')).toBeInTheDocument()
    })

    it('has correct CSS class on container', () => {
      const { container } = render(<CalendarNavigation {...defaultProps} />)
      
      const containerDiv = container.firstChild
      expect(containerDiv).toHaveClass('ant-picker-calendar-header-value')
    })
  })

  describe('Date Picker Rendering', () => {
    it('renders month picker when type is month', () => {
      const props = createCalendarNavigationProps({
        value: testDate,
        type: 'month'
      })
      
      const { container } = render(<CalendarNavigation {...props} />)
      
      // Month picker should be present
      const monthPicker = container.querySelector('.ant-picker')
      expect(monthPicker).toBeInTheDocument()
    })

    it('renders year picker when type is year', () => {
      const props = createCalendarNavigationProps({
        value: testDate,
        type: 'year'
      })
      
      const { container } = render(<CalendarNavigation {...props} />)
      
      // Year picker should be present
      const yearPicker = container.querySelector('.ant-picker')
      expect(yearPicker).toBeInTheDocument()
    })

    it('date picker has allowClear=false', () => {
      const { container } = render(<CalendarNavigation {...defaultProps} />)
      
      const datePicker = container.querySelector('.ant-picker')
      expect(datePicker).not.toHaveClass('ant-picker-allow-clear')
    })

    it('displays formatted date correctly', () => {
      render(<CalendarNavigation {...defaultProps} />)
      
      // The mock dayjs format function returns 'Jan 2024' for month picker
      expect(screen.getByDisplayValue('Jan 2024')).toBeInTheDocument()
    })
  })

  describe('Today Button Functionality', () => {
    it('calls onChange when Today button is clicked', () => {
      const mockOnChange = vi.fn()
      const props = createCalendarNavigationProps({
        value: testDate,
        onChange: mockOnChange
      })
      
      render(<CalendarNavigation {...props} />)
      
      fireEvent.click(screen.getByText('Today'))
      
      expect(mockOnChange).toHaveBeenCalledTimes(1)
    })

    it('calls onCurrentDateChange when Today button is clicked', () => {
      const mockOnCurrentDateChange = vi.fn()
      const props = createCalendarNavigationProps({
        value: testDate,
        onCurrentDateChange: mockOnCurrentDateChange
      })
      
      render(<CalendarNavigation {...props} />)
      
      fireEvent.click(screen.getByText('Today'))
      
      expect(mockOnCurrentDateChange).toHaveBeenCalledTimes(1)
    })

    it('calls onCurrentWeekChange when Today button is clicked in week mode', () => {
      const mockOnCurrentWeekChange = vi.fn()
      const props = createCalendarNavigationProps({
        value: testDate,
        viewMode: 'week',
        onCurrentWeekChange: mockOnCurrentWeekChange
      })
      
      render(<CalendarNavigation {...props} />)
      
      fireEvent.click(screen.getByText('Today'))
      
      expect(mockOnCurrentWeekChange).toHaveBeenCalledTimes(1)
    })

    it('does not call onCurrentWeekChange when Today button is clicked in non-week mode', () => {
      const mockOnCurrentWeekChange = vi.fn()
      const props = createCalendarNavigationProps({
        value: testDate,
        viewMode: 'month',
        onCurrentWeekChange: mockOnCurrentWeekChange
      })
      
      render(<CalendarNavigation {...props} />)
      
      fireEvent.click(screen.getByText('Today'))
      
      expect(mockOnCurrentWeekChange).not.toHaveBeenCalled()
    })

    it('does not call onCurrentWeekChange when callback is not provided', () => {
      const props = createCalendarNavigationProps({
        value: testDate,
        viewMode: 'week',
        onCurrentWeekChange: undefined
      })
      
      // Should not throw when onCurrentWeekChange is undefined
      expect(() => {
        render(<CalendarNavigation {...props} />)
        fireEvent.click(screen.getByText('Today'))
      }).not.toThrow()
    })
  })

  describe('Previous Arrow Functionality', () => {
    it('calls onChange when previous arrow is clicked', () => {
      const mockOnChange = vi.fn()
      const props = createCalendarNavigationProps({
        value: testDate,
        onChange: mockOnChange
      })
      
      const { container } = render(<CalendarNavigation {...props} />)
      
      const leftArrow = container.querySelector('.anticon-left')!
      fireEvent.click(leftArrow)
      
      expect(mockOnChange).toHaveBeenCalledTimes(1)
    })

    it('calls onCurrentDateChange when previous arrow is clicked', () => {
      const mockOnCurrentDateChange = vi.fn()
      const props = createCalendarNavigationProps({
        value: testDate,
        onCurrentDateChange: mockOnCurrentDateChange
      })
      
      const { container } = render(<CalendarNavigation {...props} />)
      
      const leftArrow = container.querySelector('.anticon-left')!
      fireEvent.click(leftArrow)
      
      expect(mockOnCurrentDateChange).toHaveBeenCalledTimes(1)
    })
  })

  describe('Next Arrow Functionality', () => {
    it('calls onChange when next arrow is clicked', () => {
      const mockOnChange = vi.fn()
      const props = createCalendarNavigationProps({
        value: testDate,
        onChange: mockOnChange
      })
      
      const { container } = render(<CalendarNavigation {...props} />)
      
      const rightArrow = container.querySelector('.anticon-right')!
      fireEvent.click(rightArrow)
      
      expect(mockOnChange).toHaveBeenCalledTimes(1)
    })

    it('calls onCurrentDateChange when next arrow is clicked', () => {
      const mockOnCurrentDateChange = vi.fn()
      const props = createCalendarNavigationProps({
        value: testDate,
        onCurrentDateChange: mockOnCurrentDateChange
      })
      
      const { container } = render(<CalendarNavigation {...props} />)
      
      const rightArrow = container.querySelector('.anticon-right')!
      fireEvent.click(rightArrow)
      
      expect(mockOnCurrentDateChange).toHaveBeenCalledTimes(1)
    })
  })

  describe('Component Props', () => {
    it('handles different viewMode values correctly', () => {
      const viewModes = ['week', 'month', 'year']
      
      viewModes.forEach(mode => {
        const props = createCalendarNavigationProps({
          value: testDate,
          viewMode: mode
        })
        
        expect(() => render(<CalendarNavigation {...props} />)).not.toThrow()
      })
    })

    it('handles both month and year type props correctly', () => {
      const types = ['month', 'year'] as const
      
      types.forEach(type => {
        const props = createCalendarNavigationProps({
          value: testDate,
          type
        })
        
        expect(() => render(<CalendarNavigation {...props} />)).not.toThrow()
      })
    })

    it('renders correctly without onCurrentWeekChange prop', () => {
      const { onCurrentWeekChange, ...propsWithoutCallback } = defaultProps
      
      expect(() => {
        render(<CalendarNavigation {...propsWithoutCallback} />)
      }).not.toThrow()
    })
  })

  describe('Edge Cases', () => {
    it('handles undefined onCurrentWeekChange gracefully', () => {
      const props = createCalendarNavigationProps({
        value: testDate,
        viewMode: 'week',
        onCurrentWeekChange: undefined
      })
      
      expect(() => {
        render(<CalendarNavigation {...props} />)
        fireEvent.click(screen.getByText('Today'))
      }).not.toThrow()
    })

    it('handles rapid consecutive clicks on navigation elements', () => {
      const mockOnChange = vi.fn()
      const props = createCalendarNavigationProps({
        value: testDate,
        onChange: mockOnChange
      })
      
      const { container } = render(<CalendarNavigation {...props} />)
      
      const todayButton = screen.getByText('Today')
      const leftArrow = container.querySelector('.anticon-left')!
      const rightArrow = container.querySelector('.anticon-right')!
      
      // Click multiple elements rapidly
      fireEvent.click(todayButton)
      fireEvent.click(leftArrow)
      fireEvent.click(rightArrow)
      fireEvent.click(todayButton)
      
      expect(mockOnChange).toHaveBeenCalledTimes(4)
    })
  })
})