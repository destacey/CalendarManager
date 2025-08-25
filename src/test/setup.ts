import '@testing-library/jest-dom'

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

// Mock dayjs plugins to avoid import issues in testing
vi.mock('dayjs/plugin/timezone', () => ({
  default: () => {}
}))

vi.mock('dayjs/plugin/utc', () => ({
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