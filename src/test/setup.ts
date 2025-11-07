import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock electron API for components that use it
Object.defineProperty(window, 'electronAPI', {
  value: {
    getEvents: vi.fn(() => Promise.resolve([])),
    syncGraphEvents: vi.fn(() => Promise.resolve()),
    getConfig: vi.fn(() => Promise.resolve({})),
    setConfig: vi.fn(() => Promise.resolve()),
    clearConfig: vi.fn(() => Promise.resolve()),
    // Add other electronAPI methods as needed
  },
  writable: true,
})

// Create a chainable mock dayjs object for module mocking
const createChainableDayjs = () => {
  const mock = {
    format: vi.fn(() => '2024-01-01'),
    startOf: vi.fn(() => mock),
    endOf: vi.fn(() => mock),
    add: vi.fn(() => mock),
    subtract: vi.fn(() => mock),
    isSame: vi.fn(() => false),
    isBefore: vi.fn(() => false),
    isAfter: vi.fn(() => false),
    isSameOrBefore: vi.fn(() => true),
    diff: vi.fn(() => 60), // 60 minutes default
    hour: vi.fn(() => 9),
    minute: vi.fn(() => 0),
    date: vi.fn(() => 1),
    tz: vi.fn(() => mock),
    utc: vi.fn(() => mock),
    isValid: vi.fn(() => true),
    valueOf: vi.fn(() => 1704067200000),
    toDate: vi.fn(() => new Date('2024-01-01')),
    clone: vi.fn(() => mock),
    extend: vi.fn(() => {}),
  }
  return mock
}

// Mock dayjs module to return our chainable mock
vi.mock('dayjs', () => {
  const mockDayjs = createChainableDayjs()
  // Make the default export callable and return the mock
  const dayjsFunction = vi.fn(() => mockDayjs)
  // Add static methods that are typically on dayjs
  Object.assign(dayjsFunction, {
    utc: vi.fn(() => mockDayjs),
    extend: vi.fn(() => {}),
    min: vi.fn(() => mockDayjs),
    max: vi.fn(() => mockDayjs),
    ...mockDayjs
  })
  return { default: dayjsFunction }
})

// Mock dayjs plugins to avoid import issues in testing
vi.mock('dayjs/plugin/timezone', () => ({
  default: () => {}
}))

vi.mock('dayjs/plugin/utc', () => ({
  default: () => {}
}))

vi.mock('dayjs/plugin/minMax', () => ({
  default: () => {}
}))

// Mock getComputedStyle to avoid jsdom warnings
Object.defineProperty(window, 'getComputedStyle', {
  value: (element: Element) => ({
    getPropertyValue: (prop: string) => '',
    backgroundColor: '',
    color: '',
    borderRadius: '50%',
  }),
  configurable: true,
})

// Mock matchMedia for Ant Design components
Object.defineProperty(window, 'matchMedia', {
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
  configurable: true,
})

// Suppress React key warnings in tests as they're caused by our mock dayjs returning identical dates
// These warnings don't affect test functionality but create noise in the output
const originalConsoleError = console.error
console.error = (message, ...args) => {
  // Suppress React duplicate key warnings during tests
  if (typeof message === 'string' && message.includes('Encountered two children with the same key')) {
    return
  }
  // Call original console.error for other messages
  originalConsoleError(message, ...args)
}