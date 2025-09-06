import React, { ReactElement } from 'react'
import { render, RenderOptions } from '@testing-library/react'
import { ConfigProvider, App } from 'antd'
import { ThemeProvider } from '../contexts/ThemeContext'
import { MessageProvider } from '../contexts/MessageContext'
import dayjs from 'dayjs'

// Custom render function that includes providers
const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
  return (
    <ThemeProvider>
      <ConfigProvider>
        <MessageProvider>
          <App>
            {children}
          </App>
        </MessageProvider>
      </ConfigProvider>
    </ThemeProvider>
  )
}

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) => render(ui, { wrapper: AllTheProviders, ...options })

// Re-export everything
export * from '@testing-library/react'
export { customRender as render }

// Mock event data for testing
export const mockEvent = {
  id: 'test-event-1',
  title: 'Test Event',
  start_date: '2024-01-01T09:00:00Z',
  end_date: '2024-01-01T10:00:00Z',
  is_all_day: false,
  description: 'Test event description',
  location: 'Test Location',
  categories: 'work,important',
  show_as: 'busy',
  sensitivity: 'normal',
  created: '2024-01-01T08:00:00Z',
  last_modified: '2024-01-01T08:00:00Z',
  graph_id: 'graph-event-1',
  graph_etag: 'etag-1'
}

export const mockAllDayEvent = {
  ...mockEvent,
  id: 'test-event-2',
  title: 'All Day Event',
  start_date: '2024-01-01',
  end_date: '2024-01-02',
  is_all_day: true
}

// Create a simple mock dayjs object that prevents infinite loops but allows controlled iteration
export const createMockDayjs = (initialDay = 15) => {
  let callCount = 0
  const mock = {
    format: vi.fn((formatStr) => {
      if (formatStr === 'YYYY-MM-DD') return `2024-01-${String(initialDay).padStart(2, '0')}`
      return `2024-01-${String(initialDay).padStart(2, '0')}`
    }),
    startOf: vi.fn((unit) => {
      if (unit === 'month') return createMockDayjs(1)
      if (unit === 'week') return createMockDayjs(1) // Start of week at day 1
      return mock
    }),
    endOf: vi.fn((unit) => {
      if (unit === 'month') return createMockDayjs(31)
      return mock  
    }),
    add: vi.fn((amount, unit) => {
      if (unit === 'day') {
        const newDay = initialDay + amount
        return createMockDayjs(newDay > 31 ? 32 : newDay) // 32 will be > 31 to stop loop
      }
      return mock
    }),
    subtract: vi.fn(() => mock),
    isSame: vi.fn(() => false),
    isBefore: vi.fn(() => false), 
    isAfter: vi.fn(() => false),
    isSameOrBefore: vi.fn((other, unit) => {
      if (unit === 'day') {
        callCount++
        // Allow up to 31 iterations then stop to prevent infinite loops
        if (callCount > 31) return false
        const otherDay = other && typeof other.date === 'function' ? other.date() : 31
        return initialDay <= otherDay
      }
      return false
    }),
    diff: vi.fn(() => 60),
    hour: vi.fn(() => 9),
    minute: vi.fn(() => 0),
    date: vi.fn(() => initialDay),
    tz: vi.fn(() => mock),
    isValid: vi.fn(() => true),
    valueOf: vi.fn(() => 1704067200000 + (initialDay - 1) * 86400000),
    toDate: vi.fn(() => new Date(2024, 0, initialDay)),
    clone: vi.fn(() => createMockDayjs(initialDay)),
  }
  return mock
}

// Mock dayjs object for consistent testing
export const mockDayjs = createMockDayjs()

// WeekView test props factory
export const createWeekViewProps = (overrides = {}) => ({
  currentWeek: mockDayjs as any,
  setCurrentWeek: vi.fn(),
  setViewMode: vi.fn(),
  setCalendarType: vi.fn(),
  getEventsForDate: vi.fn(() => []),
  getEventBackgroundColor: vi.fn(() => '#1890ff'),
  getEventDisplayColor: vi.fn(() => '#1890ff'),
  setSelectedEvent: vi.fn(),
  setIsModalVisible: vi.fn(),
  userTimezone: 'America/New_York',
  eventTypes: [],
  ...overrides
})

// ViewModeToggle test props factory
export const createViewModeToggleProps = (overrides = {}) => ({
  viewMode: 'week',
  calendarType: 'month',
  onViewModeChange: vi.fn(),
  onCalendarTypeChange: vi.fn(),
  onTypeChange: vi.fn(),
  ...overrides
})

// MonthEventCell test props factory
export const createMonthEventCellProps = (overrides = {}) => ({
  value: mockDayjs as any,
  getEventsForDate: vi.fn(() => []),
  ...overrides
})

// Extended mock event with more fields for EventModal testing
export const mockCompleteEvent = {
  ...mockEvent,
  description: 'This is a test event description',
  is_meeting: true,
  organizer: JSON.stringify({
    name: 'John Organizer',
    email: 'john.organizer@example.com'
  }),
  attendees: JSON.stringify([
    {
      name: 'Alice Attendee',
      email: 'alice@example.com',
      response: 'accepted'
    },
    {
      name: 'Bob Attendee', 
      email: 'bob@example.com',
      response: 'tentative'
    },
    {
      name: 'Charlie Attendee',
      email: 'charlie@example.com', 
      response: 'declined'
    }
  ]),
  synced_at: '2024-01-01T08:30:00Z'
}

// EventModal test props factory
export const createEventModalProps = (overrides = {}) => ({
  isVisible: false,
  onClose: vi.fn(),
  event: null,
  getEventColor: vi.fn((showAs: string) => {
    switch (showAs) {
      case 'busy': return 'processing'
      case 'tentative': return 'warning'
      case 'oof': return 'error'
      case 'free': return 'success'
      default: return 'default'
    }
  }),
  getShowAsDisplay: vi.fn((showAs: string) => {
    switch (showAs) {
      case 'busy': return 'Busy'
      case 'tentative': return 'Tentative'
      case 'oof': return 'Out of Office'
      case 'free': return 'Free'
      case 'workingElsewhere': return 'Working Elsewhere'
      default: return 'Unknown'
    }
  }),
  userTimezone: 'America/New_York',
  ...overrides
})

// CalendarNavigation test props factory
export const createCalendarNavigationProps = (overrides = {}) => ({
  value: dayjs('2024-01-15'),
  type: 'month' as const,
  viewMode: 'month',
  onChange: vi.fn(),
  onCurrentDateChange: vi.fn(),
  onCurrentWeekChange: vi.fn(),
  ...overrides
})

// CalendarHeader test props factory
export const createCalendarHeaderProps = (overrides = {}) => ({
  value: dayjs('2024-01-15'),
  type: 'month' as const,
  viewMode: 'month',
  calendarType: 'month',
  onChange: vi.fn(),
  onTypeChange: vi.fn(),
  onCurrentDateChange: vi.fn(),
  onCurrentWeekChange: vi.fn(),
  onViewModeChange: vi.fn(),
  onCalendarTypeChange: vi.fn(),
  ...overrides
})

// CalendarEventCell test props factory
export const createCalendarEventCellProps = (overrides = {}) => ({
  current: dayjs('2024-01-15'),
  dayEvents: [],
  isLargeScreen: true,
  userTimezone: 'America/New_York',
  onEventClick: vi.fn(),
  getShowAsDisplay: vi.fn((showAs: string) => {
    switch (showAs) {
      case 'busy': return 'Busy'
      case 'tentative': return 'Tentative'
      case 'oof': return 'Out of Office'
      case 'free': return 'Free'
      case 'workingElsewhere': return 'Working Elsewhere'
      default: return 'Unknown'
    }
  }),
  getEventDisplayColor: vi.fn(() => '#1890ff'),
  ...overrides
})

// TitleBar test props factory
export const createTitleBarProps = (overrides = {}) => ({
  showUserMenu: false,
  onLogout: vi.fn(),
  showMenuToggle: false,
  onMenuToggle: vi.fn(),
  sideNavCollapsed: false,
  isMobile: false,
  selectedNavKey: 'home',
  onNavSelect: vi.fn(),
  onDataManagement: vi.fn(),
  ...overrides
})

// UserMenu test props factory
export const createUserMenuProps = (overrides = {}) => ({
  onLogout: vi.fn(),
  showName: true,
  onDataManagement: vi.fn(),
  ...overrides
})

// TimezoneSettings test props factory
export const createTimezoneSettingsProps = (overrides = {}) => ({
  searchTerm: '',
  ...overrides
})

// MicrosoftGraphSettings test props factory
export const createMicrosoftGraphSettingsProps = (overrides = {}) => ({
  searchTerm: '',
  ...overrides
})

// Settings test props factory
export const createSettingsProps = (overrides = {}) => ({
  ...overrides
})

// EventTable test props factory
export const createEventTableProps = (overrides = {}) => ({
  currentDate: createMockDayjs(15),
  getEventsForDate: vi.fn(() => []),
  getEventDisplayColor: vi.fn(() => '#1890ff'),
  getEventBackgroundColor: vi.fn(() => '#1890ff'),
  setSelectedEvent: vi.fn(),
  setIsModalVisible: vi.fn(),
  userTimezone: 'America/New_York',
  eventTypes: [],
  onExportReady: vi.fn(),
  ...overrides
})

// Extended mock events for EventTable testing
export const mockBillableEventType = {
  id: 1,
  name: 'Work',
  color: '#52c41a',
  is_billable: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z'
}

export const mockNonBillableEventType = {
  id: 2,
  name: 'Personal',
  color: '#1890ff',
  is_billable: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z'
}

export const mockTimedEvent = {
  ...mockEvent,
  id: 1,
  title: 'Team Meeting',
  start_date: '2024-01-15T09:00:00Z',
  end_date: '2024-01-15T10:00:00Z',
  is_all_day: false,
  is_meeting: true,
  type_id: 1,
  categories: 'work,meeting',
  show_as: 'busy'
}

export const mockTimedEvent2 = {
  ...mockEvent,
  id: 2,
  title: 'Lunch Break',
  start_date: '2024-01-15T12:00:00Z',
  end_date: '2024-01-15T13:00:00Z',
  is_all_day: false,
  is_meeting: false,
  type_id: 2,
  categories: 'personal',
  show_as: 'free'
}

export const mockBillableEvent = {
  ...mockEvent,
  id: 3,
  title: 'Client Work',
  start_date: '2024-01-16T09:00:00Z',
  end_date: '2024-01-16T17:00:00Z',
  is_all_day: false,
  is_meeting: false,
  type_id: 1,
  categories: 'work,client',
  show_as: 'busy'
}