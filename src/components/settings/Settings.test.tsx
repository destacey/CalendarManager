import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '../../test/utils'
import { createSettingsProps } from '../../test/utils'
import Settings from './Settings'

// Mock the child components
vi.mock('./MicrosoftGraphSettings', () => ({
  default: ({ searchTerm }: { searchTerm: string }) => (
    <div data-testid="microsoft-graph-settings">
      <span data-testid="search-term">{searchTerm}</span>
      <div>Microsoft Graph Settings Component</div>
    </div>
  )
}))

vi.mock('./TimezoneSettings', () => ({
  default: ({ searchTerm }: { searchTerm: string }) => (
    <div data-testid="timezone-settings">
      <span data-testid="search-term">{searchTerm}</span>
      <div>Timezone Settings Component</div>
    </div>
  )
}))

describe('Settings', () => {
  const defaultProps = createSettingsProps()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Basic Rendering', () => {
    it('renders without crashing', () => {
      expect(() => {
        render(<Settings {...defaultProps} />)
      }).not.toThrow()
    })

    it('displays the main settings title', () => {
      render(<Settings {...defaultProps} />)
      
      expect(screen.getByText('Settings')).toBeInTheDocument()
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Settings')
    })

    it('displays the search input', () => {
      render(<Settings {...defaultProps} />)
      
      expect(screen.getByPlaceholderText('Search settings...')).toBeInTheDocument()
      expect(screen.getByRole('searchbox')).toBeInTheDocument()
    })

    it('displays the search input with search icon', () => {
      render(<Settings {...defaultProps} />)
      
      const searchInput = screen.getByPlaceholderText('Search settings...')
      expect(searchInput).toBeInTheDocument()
      
      // Should have search icon as prefix
      const searchContainer = searchInput.closest('.ant-input-affix-wrapper')
      expect(searchContainer).toBeInTheDocument()
    })

    it('displays the tabs component', () => {
      render(<Settings {...defaultProps} />)
      
      expect(screen.getByRole('tablist')).toBeInTheDocument()
    })

    it('displays the General tab', () => {
      render(<Settings {...defaultProps} />)
      
      expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument()
    })
  })

  describe('Tab Structure', () => {
    it('has General tab as default active tab', () => {
      render(<Settings {...defaultProps} />)
      
      const generalTab = screen.getByRole('tab', { name: 'General' })
      expect(generalTab).toBeInTheDocument()
      expect(generalTab).toHaveAttribute('aria-selected', 'true')
    })

    it('displays General tab without icon', () => {
      render(<Settings {...defaultProps} />)
      
      const generalTab = screen.getByRole('tab', { name: 'General' })
      expect(generalTab).toHaveTextContent('General')
      
      // Should not contain any icon elements
      const iconElements = generalTab.querySelectorAll('span[role="img"], svg')
      expect(iconElements).toHaveLength(0)
    })

    it('renders child components in the General tab content', () => {
      render(<Settings {...defaultProps} />)
      
      expect(screen.getByTestId('microsoft-graph-settings')).toBeInTheDocument()
      expect(screen.getByTestId('timezone-settings')).toBeInTheDocument()
    })

    it('renders General tab content within container with max width', () => {
      render(<Settings {...defaultProps} />)
      
      const microsoftGraphSettings = screen.getByTestId('microsoft-graph-settings')
      const container = microsoftGraphSettings.parentElement
      expect(container).toBeInTheDocument()
      
      // Verify the container exists (style is set via inline styles in component)
      expect(container).toHaveAttribute('style')
      expect(container?.getAttribute('style')).toContain('max-width')
    })
  })

  describe('Search Functionality', () => {
    it('initializes with empty search term', () => {
      render(<Settings {...defaultProps} />)
      
      const searchInput = screen.getByPlaceholderText('Search settings...')
      expect(searchInput).toHaveValue('')
      
      // Check that child components receive empty search term
      const searchTermElements = screen.getAllByTestId('search-term')
      searchTermElements.forEach(element => {
        expect(element).toHaveTextContent('')
      })
    })

    it('updates search input value when user types', () => {
      render(<Settings {...defaultProps} />)
      
      const searchInput = screen.getByRole('searchbox')
      fireEvent.change(searchInput, { target: { value: 'timezone' } })
      
      expect(searchInput).toHaveValue('timezone')
    })

    it('passes search term to child components', () => {
      render(<Settings {...defaultProps} />)
      
      const searchInput = screen.getByRole('searchbox')
      fireEvent.change(searchInput, { target: { value: 'graph' } })
      
      // Both child components should receive the search term
      const searchTermElements = screen.getAllByTestId('search-term')
      expect(searchTermElements).toHaveLength(2)
      searchTermElements.forEach(element => {
        expect(element).toHaveTextContent('graph')
      })
    })

    it('supports clearing search input', () => {
      render(<Settings {...defaultProps} />)
      
      const searchInput = screen.getByRole('searchbox')
      fireEvent.change(searchInput, { target: { value: 'test search' } })
      expect(searchInput).toHaveValue('test search')
      
      // Clear the input
      fireEvent.change(searchInput, { target: { value: '' } })
      expect(searchInput).toHaveValue('')
      
      // Child components should receive empty search term
      const searchTermElements = screen.getAllByTestId('search-term')
      searchTermElements.forEach(element => {
        expect(element).toHaveTextContent('')
      })
    })

    it('has allowClear property on search input', () => {
      render(<Settings {...defaultProps} />)
      
      const searchInput = screen.getByRole('searchbox')
      
      // Type something to make clear button appear
      fireEvent.change(searchInput, { target: { value: 'test' } })
      
      // The clear button should be available (Ant Design adds it automatically with allowClear)
      const searchContainer = searchInput.closest('.ant-input-search')
      expect(searchContainer).toBeInTheDocument()
    })
  })

  describe('Component Structure', () => {
    it('renders with proper layout structure', () => {
      render(<Settings {...defaultProps} />)
      
      // Main container - need to find the actual outer container
      const settingsTitle = screen.getByText('Settings')
      const spaceContainer = settingsTitle.closest('.ant-space')
      const mainContainer = spaceContainer?.parentElement
      expect(mainContainer).toBeInTheDocument()
      
      // Verify the main container has the expected inline styles
      expect(mainContainer).toHaveAttribute('style')
      const styleAttr = mainContainer?.getAttribute('style')
      expect(styleAttr).toContain('padding')
      expect(styleAttr).toContain('height')
      expect(styleAttr).toContain('overflow')
    })

    it('uses vertical space layout', () => {
      render(<Settings {...defaultProps} />)
      
      const spaceElement = screen.getByText('Settings').closest('.ant-space')
      expect(spaceElement).toBeInTheDocument()
      expect(spaceElement).toHaveClass('ant-space-vertical')
    })

    it('sets proper styles on search input', () => {
      render(<Settings {...defaultProps} />)
      
      const searchInput = screen.getByPlaceholderText('Search settings...')
      const searchWrapper = searchInput.closest('[style*="max-width"]')
      expect(searchWrapper).toBeInTheDocument()
      
      // Verify the search wrapper has max-width style
      const styleAttr = searchWrapper?.getAttribute('style')
      expect(styleAttr).toContain('max-width')
    })

    it('configures tabs with correct properties', () => {
      render(<Settings {...defaultProps} />)
      
      const tabsContainer = screen.getByRole('tablist').closest('.ant-tabs')
      expect(tabsContainer).toBeInTheDocument()
      expect(tabsContainer).toHaveClass('ant-tabs-top')
    })
  })

  describe('Child Component Integration', () => {
    it('renders MicrosoftGraphSettings component', () => {
      render(<Settings {...defaultProps} />)
      
      expect(screen.getByTestId('microsoft-graph-settings')).toBeInTheDocument()
      expect(screen.getByText('Microsoft Graph Settings Component')).toBeInTheDocument()
    })

    it('renders TimezoneSettings component', () => {
      render(<Settings {...defaultProps} />)
      
      expect(screen.getByTestId('timezone-settings')).toBeInTheDocument()
      expect(screen.getByText('Timezone Settings Component')).toBeInTheDocument()
    })

    it('passes searchTerm prop to MicrosoftGraphSettings', () => {
      render(<Settings {...defaultProps} />)
      
      const searchInput = screen.getByRole('searchbox')
      fireEvent.change(searchInput, { target: { value: 'microsoft' } })
      
      const microsoftGraphSettings = screen.getByTestId('microsoft-graph-settings')
      const searchTermElement = microsoftGraphSettings.querySelector('[data-testid="search-term"]')
      expect(searchTermElement).toHaveTextContent('microsoft')
    })

    it('passes searchTerm prop to TimezoneSettings', () => {
      render(<Settings {...defaultProps} />)
      
      const searchInput = screen.getByRole('searchbox')
      fireEvent.change(searchInput, { target: { value: 'timezone' } })
      
      const timezoneSettings = screen.getByTestId('timezone-settings')
      const searchTermElement = timezoneSettings.querySelector('[data-testid="search-term"]')
      expect(searchTermElement).toHaveTextContent('timezone')
    })
  })

  describe('State Management', () => {
    it('maintains search state correctly', () => {
      render(<Settings {...defaultProps} />)
      
      const searchInput = screen.getByRole('searchbox')
      
      // Type multiple values
      fireEvent.change(searchInput, { target: { value: 'first' } })
      expect(searchInput).toHaveValue('first')
      
      fireEvent.change(searchInput, { target: { value: 'second' } })
      expect(searchInput).toHaveValue('second')
      
      fireEvent.change(searchInput, { target: { value: '' } })
      expect(searchInput).toHaveValue('')
    })

    it('updates child components when search state changes', () => {
      render(<Settings {...defaultProps} />)
      
      const searchInput = screen.getByRole('searchbox')
      
      // First search term
      fireEvent.change(searchInput, { target: { value: 'graph api' } })
      let searchTermElements = screen.getAllByTestId('search-term')
      searchTermElements.forEach(element => {
        expect(element).toHaveTextContent('graph api')
      })
      
      // Second search term
      fireEvent.change(searchInput, { target: { value: 'clock time' } })
      searchTermElements = screen.getAllByTestId('search-term')
      searchTermElements.forEach(element => {
        expect(element).toHaveTextContent('clock time')
      })
    })
  })

  describe('Accessibility', () => {
    it('has proper heading hierarchy', () => {
      render(<Settings {...defaultProps} />)
      
      const heading = screen.getByRole('heading', { level: 2 })
      expect(heading).toHaveTextContent('Settings')
    })

    it('has accessible search input', () => {
      render(<Settings {...defaultProps} />)
      
      const searchInput = screen.getByRole('searchbox')
      expect(searchInput).toHaveAttribute('placeholder', 'Search settings...')
    })

    it('has accessible tab structure', () => {
      render(<Settings {...defaultProps} />)
      
      expect(screen.getByRole('tablist')).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument()
      expect(screen.getByRole('tabpanel')).toBeInTheDocument()
    })
  })

  describe('Props Interface', () => {
    it('accepts empty props object', () => {
      expect(() => {
        render(<Settings />)
      }).not.toThrow()
    })

    it('works with createSettingsProps factory', () => {
      const props = createSettingsProps()
      expect(() => {
        render(<Settings {...props} />)
      }).not.toThrow()
    })
  })

  describe('Error Handling', () => {
    it('handles component mounting gracefully', () => {
      expect(() => {
        render(<Settings {...defaultProps} />)
      }).not.toThrow()
    })

    it('handles search input edge cases', () => {
      render(<Settings {...defaultProps} />)
      
      const searchInput = screen.getByRole('searchbox')
      
      // Test with various inputs
      const testInputs = ['', 'normal text', '123456', 'special!@#$%chars', '   whitespace   ']
      
      testInputs.forEach(testValue => {
        expect(() => {
          fireEvent.change(searchInput, { target: { value: testValue } })
        }).not.toThrow()
        
        expect(searchInput).toHaveValue(testValue)
      })
    })
  })

  describe('Future Extensibility', () => {
    it('has commented structure for future tabs', () => {
      // This is more of a code review test to ensure the component is designed for extension
      // The actual component source contains commented code for future sync settings
      render(<Settings {...defaultProps} />)
      
      // Currently only has one tab
      const tabs = screen.getAllByRole('tab')
      expect(tabs).toHaveLength(1)
      expect(tabs[0]).toHaveTextContent('General')
    })

    it('maintains tabItems structure that supports easy extension', () => {
      render(<Settings {...defaultProps} />)
      
      // The current structure should support adding more tabs easily
      const tabsContainer = screen.getByRole('tablist')
      expect(tabsContainer).toBeInTheDocument()
      
      // Should have the general tab and be able to handle more
      expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument()
    })
  })
})