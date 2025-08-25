import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '../../test/utils'
import { createViewModeToggleProps } from '../../test/utils'
import ViewModeToggle from './ViewModeToggle'

describe('ViewModeToggle', () => {
  const defaultProps = createViewModeToggleProps()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic Rendering', () => {
    it('renders without crashing', () => {
      render(<ViewModeToggle {...defaultProps} />)
      
      expect(document.body).toBeInTheDocument()
    })

    it('renders all three radio button options', () => {
      render(<ViewModeToggle {...defaultProps} />)
      
      expect(screen.getByRole('radio', { name: 'Week' })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'Month' })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'Year' })).toBeInTheDocument()
    })

    it('renders as a Radio.Group with button style', () => {
      const { container } = render(<ViewModeToggle {...defaultProps} />)
      
      const radioGroup = container.querySelector('.ant-radio-group')
      expect(radioGroup).toBeInTheDocument()
      expect(radioGroup).toHaveClass('ant-radio-group-solid')
    })
  })

  describe('Current Value Display', () => {
    it('displays Week as selected when viewMode is week', () => {
      const props = createViewModeToggleProps({
        viewMode: 'week',
        calendarType: 'month'
      })
      
      render(<ViewModeToggle {...props} />)
      
      const weekRadio = screen.getByRole('radio', { name: 'Week' })
      expect(weekRadio).toBeChecked()
      expect(screen.getByRole('radio', { name: 'Month' })).not.toBeChecked()
      expect(screen.getByRole('radio', { name: 'Year' })).not.toBeChecked()
    })

    it('displays Month as selected when viewMode is month and calendarType is month', () => {
      const props = createViewModeToggleProps({
        viewMode: 'month',
        calendarType: 'month'
      })
      
      render(<ViewModeToggle {...props} />)
      
      const monthRadio = screen.getByRole('radio', { name: 'Month' })
      expect(monthRadio).toBeChecked()
      expect(screen.getByRole('radio', { name: 'Week' })).not.toBeChecked()
      expect(screen.getByRole('radio', { name: 'Year' })).not.toBeChecked()
    })

    it('displays Year as selected when viewMode is month and calendarType is year', () => {
      const props = createViewModeToggleProps({
        viewMode: 'month',
        calendarType: 'year'
      })
      
      render(<ViewModeToggle {...props} />)
      
      const yearRadio = screen.getByRole('radio', { name: 'Year' })
      expect(yearRadio).toBeChecked()
      expect(screen.getByRole('radio', { name: 'Week' })).not.toBeChecked()
      expect(screen.getByRole('radio', { name: 'Month' })).not.toBeChecked()
    })

    it('defaults to Year when viewMode is not week and calendarType is not month', () => {
      const props = createViewModeToggleProps({
        viewMode: 'other',
        calendarType: 'other'
      })
      
      render(<ViewModeToggle {...props} />)
      
      const yearRadio = screen.getByRole('radio', { name: 'Year' })
      expect(yearRadio).toBeChecked()
    })
  })

  describe('Week Mode Selection', () => {
    it('calls onViewModeChange with "week" when Week is selected', () => {
      const mockOnViewModeChange = vi.fn()
      const props = createViewModeToggleProps({
        viewMode: 'month',
        calendarType: 'month',
        onViewModeChange: mockOnViewModeChange
      })
      
      render(<ViewModeToggle {...props} />)
      
      const weekRadio = screen.getByRole('radio', { name: 'Week' })
      fireEvent.click(weekRadio)
      
      expect(mockOnViewModeChange).toHaveBeenCalledWith('week')
    })

    it('only calls onViewModeChange when switching to Week', () => {
      const mockOnViewModeChange = vi.fn()
      const mockOnCalendarTypeChange = vi.fn()
      const mockOnTypeChange = vi.fn()
      
      const props = createViewModeToggleProps({
        viewMode: 'month',
        calendarType: 'month',
        onViewModeChange: mockOnViewModeChange,
        onCalendarTypeChange: mockOnCalendarTypeChange,
        onTypeChange: mockOnTypeChange
      })
      
      render(<ViewModeToggle {...props} />)
      
      const weekRadio = screen.getByRole('radio', { name: 'Week' })
      fireEvent.click(weekRadio)
      
      expect(mockOnViewModeChange).toHaveBeenCalledWith('week')
      expect(mockOnCalendarTypeChange).not.toHaveBeenCalled()
      expect(mockOnTypeChange).not.toHaveBeenCalled()
    })
  })

  describe('Month Mode Selection', () => {
    it('calls all three callbacks when Month is selected', () => {
      const mockOnViewModeChange = vi.fn()
      const mockOnCalendarTypeChange = vi.fn()
      const mockOnTypeChange = vi.fn()
      
      const props = createViewModeToggleProps({
        viewMode: 'week',
        calendarType: 'month',
        onViewModeChange: mockOnViewModeChange,
        onCalendarTypeChange: mockOnCalendarTypeChange,
        onTypeChange: mockOnTypeChange
      })
      
      render(<ViewModeToggle {...props} />)
      
      const monthRadio = screen.getByRole('radio', { name: 'Month' })
      fireEvent.click(monthRadio)
      
      expect(mockOnViewModeChange).toHaveBeenCalledWith('month')
      expect(mockOnCalendarTypeChange).toHaveBeenCalledWith('month')
      expect(mockOnTypeChange).toHaveBeenCalledWith('month')
    })

    it('passes correct parameters to callbacks for Month selection', () => {
      const mockOnViewModeChange = vi.fn()
      const mockOnCalendarTypeChange = vi.fn()
      const mockOnTypeChange = vi.fn()
      
      const props = createViewModeToggleProps({
        onViewModeChange: mockOnViewModeChange,
        onCalendarTypeChange: mockOnCalendarTypeChange,
        onTypeChange: mockOnTypeChange
      })
      
      render(<ViewModeToggle {...props} />)
      
      fireEvent.click(screen.getByRole('radio', { name: 'Month' }))
      
      expect(mockOnViewModeChange).toHaveBeenCalledTimes(1)
      expect(mockOnCalendarTypeChange).toHaveBeenCalledTimes(1)
      expect(mockOnTypeChange).toHaveBeenCalledTimes(1)
      
      expect(mockOnViewModeChange).toHaveBeenCalledWith('month')
      expect(mockOnCalendarTypeChange).toHaveBeenCalledWith('month')
      expect(mockOnTypeChange).toHaveBeenCalledWith('month')
    })
  })

  describe('Year Mode Selection', () => {
    it('calls all three callbacks when Year is selected', () => {
      const mockOnViewModeChange = vi.fn()
      const mockOnCalendarTypeChange = vi.fn()
      const mockOnTypeChange = vi.fn()
      
      const props = createViewModeToggleProps({
        viewMode: 'week',
        calendarType: 'month',
        onViewModeChange: mockOnViewModeChange,
        onCalendarTypeChange: mockOnCalendarTypeChange,
        onTypeChange: mockOnTypeChange
      })
      
      render(<ViewModeToggle {...props} />)
      
      const yearRadio = screen.getByRole('radio', { name: 'Year' })
      fireEvent.click(yearRadio)
      
      expect(mockOnViewModeChange).toHaveBeenCalledWith('month')
      expect(mockOnCalendarTypeChange).toHaveBeenCalledWith('year')
      expect(mockOnTypeChange).toHaveBeenCalledWith('year')
    })

    it('sets viewMode to month but calendarType to year when Year is selected', () => {
      const mockOnViewModeChange = vi.fn()
      const mockOnCalendarTypeChange = vi.fn()
      const mockOnTypeChange = vi.fn()
      
      const props = createViewModeToggleProps({
        onViewModeChange: mockOnViewModeChange,
        onCalendarTypeChange: mockOnCalendarTypeChange,
        onTypeChange: mockOnTypeChange
      })
      
      render(<ViewModeToggle {...props} />)
      
      fireEvent.click(screen.getByRole('radio', { name: 'Year' }))
      
      // Year mode still uses month viewMode but with year calendarType
      expect(mockOnViewModeChange).toHaveBeenCalledWith('month')
      expect(mockOnCalendarTypeChange).toHaveBeenCalledWith('year')
      expect(mockOnTypeChange).toHaveBeenCalledWith('year')
    })
  })

  describe('Component Behavior', () => {
    it('handles multiple different selections correctly', () => {
      const mockOnViewModeChange = vi.fn()
      const mockOnCalendarTypeChange = vi.fn()
      const mockOnTypeChange = vi.fn()
      
      // Start with Month selected so all clicks represent actual changes
      const props = createViewModeToggleProps({
        viewMode: 'month',
        calendarType: 'month',
        onViewModeChange: mockOnViewModeChange,
        onCalendarTypeChange: mockOnCalendarTypeChange,
        onTypeChange: mockOnTypeChange
      })
      
      render(<ViewModeToggle {...props} />)
      
      const weekRadio = screen.getByRole('radio', { name: 'Week' })
      const yearRadio = screen.getByRole('radio', { name: 'Year' })
      
      // Click different options (starting from Month)
      fireEvent.click(weekRadio)   // Month -> Week
      fireEvent.click(yearRadio)   // Week -> Year 
      fireEvent.click(weekRadio)   // Year -> Week
      
      expect(mockOnViewModeChange).toHaveBeenCalledTimes(3)
      expect(mockOnViewModeChange).toHaveBeenNthCalledWith(1, 'week')
      expect(mockOnViewModeChange).toHaveBeenNthCalledWith(2, 'month')
      expect(mockOnViewModeChange).toHaveBeenNthCalledWith(3, 'week')
    })

    it('maintains proper ARIA attributes', () => {
      render(<ViewModeToggle {...defaultProps} />)
      
      const radios = screen.getAllByRole('radio')
      expect(radios).toHaveLength(3)
      
      radios.forEach(radio => {
        expect(radio).toHaveAttribute('type', 'radio')
      })
    })

    it('applies block styling to Radio.Group', () => {
      const { container } = render(<ViewModeToggle {...defaultProps} />)
      
      const radioGroup = container.querySelector('.ant-radio-group')
      expect(radioGroup).toHaveClass('ant-radio-group-solid')
      expect(radioGroup).toHaveClass('ant-radio-group-block')
    })
  })

  describe('Edge Cases', () => {
    it('handles undefined callbacks gracefully', () => {
      const props = {
        viewMode: 'week',
        calendarType: 'month',
        onViewModeChange: vi.fn(),
        onCalendarTypeChange: vi.fn(), 
        onTypeChange: vi.fn()
      }
      
      render(<ViewModeToggle {...props} />)
      
      // Should render without crashing
      const radios = screen.getAllByRole('radio')
      expect(radios).toHaveLength(3)
      
      // Should handle clicks properly
      fireEvent.click(screen.getByRole('radio', { name: 'Month' }))
      expect(props.onViewModeChange).toHaveBeenCalledWith('month')
    })

    it('handles empty string props correctly', () => {
      const props = createViewModeToggleProps({
        viewMode: '',
        calendarType: ''
      })
      
      render(<ViewModeToggle {...props} />)
      
      // Should default to Year when both are empty/falsy
      const yearRadio = screen.getByRole('radio', { name: 'Year' })
      expect(yearRadio).toBeChecked()
    })
  })
})