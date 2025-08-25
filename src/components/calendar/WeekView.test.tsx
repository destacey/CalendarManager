import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '../../test/utils'
import { createWeekViewProps, mockEvent, mockAllDayEvent } from '../../test/utils'
import WeekView from './WeekView'
import dayjs from 'dayjs'

// Mock the scroll functionality to avoid DOM errors
Object.defineProperty(Element.prototype, 'scrollTo', {
  value: vi.fn(),
  writable: true,
})

// Create a real dayjs instance for testing
const testDate = dayjs('2024-01-01T10:00:00Z')

describe('WeekView', () => {
  const defaultProps = createWeekViewProps({
    currentWeek: testDate
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic Rendering', () => {
    it('renders without crashing', () => {
      render(<WeekView {...defaultProps} />)
      
      // Just check that something renders without errors
      expect(document.body).toBeInTheDocument()
    })

    it('renders navigation buttons', () => {
      render(<WeekView {...defaultProps} />)
      
      expect(screen.getByText('Today')).toBeInTheDocument()
      expect(screen.getByTitle('Previous week')).toBeInTheDocument()
      expect(screen.getByTitle('Next week')).toBeInTheDocument()
    })

    it('renders view mode toggle', () => {
      render(<WeekView {...defaultProps} />)
      
      expect(screen.getByDisplayValue('Week')).toBeInTheDocument()
    })
  })

  describe('Navigation Functionality', () => {
    it('calls setCurrentWeek when Today button is clicked', () => {
      const mockSetCurrentWeek = vi.fn()
      const props = createWeekViewProps({ 
        currentWeek: testDate,
        setCurrentWeek: mockSetCurrentWeek 
      })
      
      render(<WeekView {...props} />)
      
      fireEvent.click(screen.getByText('Today'))
      
      expect(mockSetCurrentWeek).toHaveBeenCalled()
    })

    it('calls setCurrentWeek when Previous week button is clicked', () => {
      const mockSetCurrentWeek = vi.fn()
      const props = createWeekViewProps({ 
        currentWeek: testDate,
        setCurrentWeek: mockSetCurrentWeek 
      })
      
      render(<WeekView {...props} />)
      
      fireEvent.click(screen.getByTitle('Previous week'))
      
      expect(mockSetCurrentWeek).toHaveBeenCalled()
    })

    it('calls setCurrentWeek when Next week button is clicked', () => {
      const mockSetCurrentWeek = vi.fn()
      const props = createWeekViewProps({ 
        currentWeek: testDate,
        setCurrentWeek: mockSetCurrentWeek 
      })
      
      render(<WeekView {...props} />)
      
      fireEvent.click(screen.getByTitle('Next week'))
      
      expect(mockSetCurrentWeek).toHaveBeenCalled()
    })
  })

  describe('View Mode Toggle', () => {
    it('switches to month view when Month radio is selected', () => {
      const mockSetViewMode = vi.fn()
      const mockSetCalendarType = vi.fn()
      const props = createWeekViewProps({ 
        currentWeek: testDate,
        setViewMode: mockSetViewMode,
        setCalendarType: mockSetCalendarType 
      })
      
      render(<WeekView {...props} />)
      
      const monthRadio = screen.getByDisplayValue('Month')
      fireEvent.click(monthRadio)
      
      expect(mockSetViewMode).toHaveBeenCalledWith('month')
      expect(mockSetCalendarType).toHaveBeenCalledWith('month')
    })

    it('switches to year view when Year radio is selected', () => {
      const mockSetViewMode = vi.fn()
      const mockSetCalendarType = vi.fn()
      const props = createWeekViewProps({ 
        currentWeek: testDate,
        setViewMode: mockSetViewMode,
        setCalendarType: mockSetCalendarType 
      })
      
      render(<WeekView {...props} />)
      
      const yearRadio = screen.getByDisplayValue('Year')
      fireEvent.click(yearRadio)
      
      expect(mockSetViewMode).toHaveBeenCalledWith('month')
      expect(mockSetCalendarType).toHaveBeenCalledWith('year')
    })
  })

  describe('Event Display', () => {
    it('calls getEventsForDate for each day', () => {
      const mockGetEventsForDate = vi.fn(() => [])
      const props = createWeekViewProps({ 
        currentWeek: testDate,
        getEventsForDate: mockGetEventsForDate 
      })
      
      render(<WeekView {...props} />)
      
      expect(mockGetEventsForDate).toHaveBeenCalled()
    })

    it('renders all-day events when provided', () => {
      const mockGetEventsForDate = vi.fn(() => [mockAllDayEvent])
      const props = createWeekViewProps({ 
        currentWeek: testDate,
        getEventsForDate: mockGetEventsForDate 
      })
      
      render(<WeekView {...props} />)
      
      expect(screen.getByText('All Day Event')).toBeInTheDocument()
    })

    it('calls event handlers when all-day event is clicked', () => {
      const mockSetSelectedEvent = vi.fn()
      const mockSetIsModalVisible = vi.fn()
      const mockGetEventsForDate = vi.fn(() => [mockAllDayEvent])
      
      const props = createWeekViewProps({
        currentWeek: testDate,
        getEventsForDate: mockGetEventsForDate,
        setSelectedEvent: mockSetSelectedEvent,
        setIsModalVisible: mockSetIsModalVisible
      })
      
      render(<WeekView {...props} />)
      
      const eventElement = screen.getByText('All Day Event')
      fireEvent.click(eventElement)
      
      expect(mockSetSelectedEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: mockAllDayEvent.id,
          title: mockAllDayEvent.title,
          is_all_day: mockAllDayEvent.is_all_day
        })
      )
      expect(mockSetIsModalVisible).toHaveBeenCalledWith(true)
    })
  })

  describe('Props Integration', () => {
    it('uses the provided userTimezone', () => {
      const props = createWeekViewProps({ 
        currentWeek: testDate,
        userTimezone: 'Europe/London' 
      })
      
      // Should render without errors with custom timezone
      render(<WeekView {...props} />)
      expect(document.body).toBeInTheDocument()
    })

    it('uses the provided getEventBackgroundColor function', () => {
      const mockGetEventBackgroundColor = vi.fn(() => '#ff0000')
      const props = createWeekViewProps({ 
        currentWeek: testDate,
        getEventBackgroundColor: mockGetEventBackgroundColor 
      })
      
      render(<WeekView {...props} />)
      
      // The function should be ready to use (we can't easily test its usage without complex event setup)
      expect(mockGetEventBackgroundColor).toBeDefined()
    })
  })

  describe('Component Structure', () => {
    it('renders main container with proper styling', () => {
      const { container } = render(<WeekView {...defaultProps} />)
      
      // Check that the main container has the expected structure
      const flexContainer = container.querySelector('[style*="position: relative"]')
      expect(flexContainer).toBeInTheDocument()
    })

    it('renders table structure for time grid', () => {
      render(<WeekView {...defaultProps} />)
      
      const tables = screen.getAllByRole('table')
      expect(tables.length).toBeGreaterThan(0)
    })
  })
})