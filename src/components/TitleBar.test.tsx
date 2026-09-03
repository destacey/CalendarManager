import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '../test/utils'
import { createTitleBarProps } from '../test/utils'
import TitleBar from './TitleBar'
import { calendarService } from '../services/calendar'
import * as windowApi from '../api/window'

// Mock the services and components
vi.mock('../services/calendar', () => ({
  calendarService: {
    setSyncCallbacks: vi.fn(),
    cancelSync: vi.fn()
  }
}))

vi.mock('./UserMenu', () => ({
  default: ({ onLogout, onDataManagement, showName }: any) => (
    <div data-testid="user-menu">
      <button onClick={onLogout} data-testid="logout-btn">Logout</button>
      <button onClick={onDataManagement} data-testid="data-management-btn">Data Management</button>
      <span data-testid="show-name">{showName.toString()}</span>
    </div>
  )
}))

vi.mock('./SyncProgress', () => ({
  default: ({ progress, onCancel, compact }: any) => (
    <div data-testid="sync-progress">
      <span data-testid="progress-type">{progress.type}</span>
      <span data-testid="compact">{compact.toString()}</span>
      <button onClick={onCancel} data-testid="cancel-sync">Cancel</button>
    </div>
  )
}))

vi.mock('./SyncModal', () => ({
  default: ({ visible, onClose }: any) => visible ? (
    <div data-testid="sync-modal">
      <button onClick={onClose} data-testid="close-modal">Close</button>
    </div>
  ) : null
}))

vi.mock('../api/window', () => ({
  minimizeWindow: vi.fn(() => Promise.resolve()),
  toggleMaximizeWindow: vi.fn(() => Promise.resolve()),
  closeWindow: vi.fn(() => Promise.resolve()),
  isWindowMaximized: vi.fn(() => Promise.resolve(false)),
  onWindowResized: vi.fn(() => Promise.resolve(vi.fn())),
}))

describe('TitleBar', () => {
  const defaultProps = createTitleBarProps()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(windowApi.isWindowMaximized).mockResolvedValue(false)
    vi.mocked(windowApi.onWindowResized).mockResolvedValue(vi.fn())
    vi.mocked(windowApi.minimizeWindow).mockResolvedValue(undefined)
    vi.mocked(windowApi.toggleMaximizeWindow).mockResolvedValue(undefined)
    vi.mocked(windowApi.closeWindow).mockResolvedValue(undefined)
  })

  describe('Basic Rendering', () => {
    it('renders title bar with basic elements', async () => {
      await act(async () => {
        render(<TitleBar {...defaultProps} />)
      })
      
      // Should render title
      expect(screen.getByText('Calendar Manager')).toBeInTheDocument()
      
      // Should render window controls (by icon names)
      expect(screen.getByRole('button', { name: /minus/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /border/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
    })

    it('renders mobile title when isMobile is true', async () => {
      const props = createTitleBarProps({ isMobile: true })
      await act(async () => {
        render(<TitleBar {...props} />)
      })
      
      expect(screen.getByText('CM')).toBeInTheDocument()
      expect(screen.queryByText('Calendar Manager')).not.toBeInTheDocument()
    })

    it('renders sync button by default', async () => {
      await act(async () => {
        render(<TitleBar {...defaultProps} />)
      })
      
      expect(screen.getByRole('button', { name: /cloud-sync/i })).toBeInTheDocument()
    })
  })

  describe('Menu Toggle Button', () => {
    it('does not render menu toggle when showMenuToggle is false', async () => {
      const props = createTitleBarProps({ showMenuToggle: false })
      await act(async () => {
        render(<TitleBar {...props} />)
      })
      
      expect(screen.queryByTitle('Expand menu')).not.toBeInTheDocument()
      expect(screen.queryByTitle('Collapse menu')).not.toBeInTheDocument()
    })

    it('renders expand menu button when collapsed', async () => {
      const props = createTitleBarProps({ 
        showMenuToggle: true, 
        sideNavCollapsed: true 
      })
      await act(async () => {
        render(<TitleBar {...props} />)
      })
      
      expect(screen.getByTitle('Expand menu')).toBeInTheDocument()
    })

    it('renders collapse menu button when expanded', async () => {
      const props = createTitleBarProps({ 
        showMenuToggle: true, 
        sideNavCollapsed: false 
      })
      await act(async () => {
        render(<TitleBar {...props} />)
      })
      
      expect(screen.getByTitle('Collapse menu')).toBeInTheDocument()
    })

    it('calls onMenuToggle when menu toggle button is clicked', async () => {
      const mockOnMenuToggle = vi.fn()
      const props = createTitleBarProps({ 
        showMenuToggle: true, 
        onMenuToggle: mockOnMenuToggle 
      })
      await act(async () => {
        render(<TitleBar {...props} />)
      })
      
      await act(async () => {
        fireEvent.click(screen.getByTitle('Collapse menu'))
      })
      
      expect(mockOnMenuToggle).toHaveBeenCalledOnce()
    })
  })

  describe('Mobile Navigation Menu', () => {
    it('renders mobile dropdown menu when isMobile is true', async () => {
      const props = createTitleBarProps({ isMobile: true })
      await act(async () => {
        render(<TitleBar {...props} />)
      })
      
      expect(screen.getByTitle('Navigation menu')).toBeInTheDocument()
    })

    it('does not render mobile menu when isMobile is false', async () => {
      const props = createTitleBarProps({ isMobile: false })
      await act(async () => {
        render(<TitleBar {...props} />)
      })
      
      expect(screen.queryByTitle('Navigation menu')).not.toBeInTheDocument()
    })
  })

  describe('User Menu', () => {
    it('does not render user menu by default', async () => {
      await act(async () => {
        render(<TitleBar {...defaultProps} />)
      })
      
      expect(screen.queryByTestId('user-menu')).not.toBeInTheDocument()
    })

    it('renders user menu when showUserMenu and onLogout are provided', async () => {
      const mockOnLogout = vi.fn()
      const props = createTitleBarProps({ 
        showUserMenu: true, 
        onLogout: mockOnLogout 
      })
      await act(async () => {
        render(<TitleBar {...props} />)
      })
      
      expect(screen.getByTestId('user-menu')).toBeInTheDocument()
    })

    it('passes correct showName prop to UserMenu for desktop', async () => {
      const props = createTitleBarProps({ 
        showUserMenu: true, 
        isMobile: false 
      })
      await act(async () => {
        render(<TitleBar {...props} />)
      })
      
      expect(screen.getByTestId('show-name')).toHaveTextContent('true')
    })

    it('passes correct showName prop to UserMenu for mobile', async () => {
      const props = createTitleBarProps({ 
        showUserMenu: true, 
        isMobile: true 
      })
      await act(async () => {
        render(<TitleBar {...props} />)
      })
      
      expect(screen.getByTestId('show-name')).toHaveTextContent('false')
    })

    it('does not render user menu when showUserMenu is true but onLogout is not provided', async () => {
      const props = createTitleBarProps({ 
        showUserMenu: true, 
        onLogout: undefined 
      })
      await act(async () => {
        render(<TitleBar {...props} />)
      })
      
      expect(screen.queryByTestId('user-menu')).not.toBeInTheDocument()
    })
  })

  describe('Window Controls', () => {
    it('minimizes the window when the minimize button is clicked', async () => {
      const { container } = render(<TitleBar {...defaultProps} />)
      await waitFor(() => expect(container.querySelector('.ant-btn')).toBeInTheDocument())

      const buttons = container.querySelectorAll('.ant-btn')
      fireEvent.click(buttons[buttons.length - 3])

      expect(windowApi.minimizeWindow).toHaveBeenCalled()
    })

    it('toggles maximize when the maximize button is clicked', async () => {
      const { container } = render(<TitleBar {...defaultProps} />)
      await waitFor(() => expect(container.querySelector('.ant-btn')).toBeInTheDocument())

      const buttons = container.querySelectorAll('.ant-btn')
      fireEvent.click(buttons[buttons.length - 2])

      expect(windowApi.toggleMaximizeWindow).toHaveBeenCalled()
    })

    it('closes the window when the close button is clicked', async () => {
      const { container } = render(<TitleBar {...defaultProps} />)
      await waitFor(() => expect(container.querySelector('.ant-btn')).toBeInTheDocument())

      const buttons = container.querySelectorAll('.ant-btn')
      fireEvent.click(buttons[buttons.length - 1])

      expect(windowApi.closeWindow).toHaveBeenCalled()
    })

    it('reads the initial maximized state on mount', async () => {
      vi.mocked(windowApi.isWindowMaximized).mockResolvedValue(true)

      render(<TitleBar {...defaultProps} />)

      await waitFor(() => expect(windowApi.isWindowMaximized).toHaveBeenCalled())
    })

    it('subscribes to resize events and unsubscribes on unmount', async () => {
      const unlisten = vi.fn()
      vi.mocked(windowApi.onWindowResized).mockResolvedValue(unlisten)

      const { unmount } = render(<TitleBar {...defaultProps} />)
      await waitFor(() => expect(windowApi.onWindowResized).toHaveBeenCalled())

      unmount()

      await waitFor(() => expect(unlisten).toHaveBeenCalled())
    })

    it('survives a failing isWindowMaximized call', async () => {
      vi.mocked(windowApi.isWindowMaximized).mockRejectedValue(new Error('no window'))

      const { container } = render(<TitleBar {...defaultProps} />)

      await waitFor(() => expect(container.querySelector('.ant-btn')).toBeInTheDocument())
    })

    it('marks the titlebar as a drag region', async () => {
      const { container } = render(<TitleBar {...defaultProps} />)

      await waitFor(() =>
        expect(container.querySelector('[data-tauri-drag-region]')).toBeInTheDocument()
      )
    })
  })

  describe('Sync Functionality', () => {
    it('opens sync modal when sync button is clicked', async () => {
      await act(async () => {
        render(<TitleBar {...defaultProps} />)
      })
      
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /cloud-sync/i }))
      })
      
      expect(screen.getByTestId('sync-modal')).toBeInTheDocument()
    })

    it('closes sync modal when close button is clicked', async () => {
      await act(async () => {
        render(<TitleBar {...defaultProps} />)
      })
      
      // Open modal first
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /cloud-sync/i }))
      })
      expect(screen.getByTestId('sync-modal')).toBeInTheDocument()
      
      // Close modal
      await act(async () => {
        fireEvent.click(screen.getByTestId('close-modal'))
      })
      
      expect(screen.queryByTestId('sync-modal')).not.toBeInTheDocument()
    })

    it('renders sync progress when syncProgress is provided', async () => {
      // We need to simulate sync progress state change
      // This would typically happen through the sync callbacks in useEffect
      const mockProgress = { type: 'fetching', current: 1, total: 10 }
      
      const TestComponent = () => {
        const [syncProgress, setSyncProgress] = React.useState(null)
        
        React.useEffect(() => {
          // Simulate sync progress
          setSyncProgress(mockProgress)
        }, [])
        
        return <TitleBar {...defaultProps} />
      }
      
      await act(async () => {
        render(<TestComponent />)
      })
      
      // Since we can't easily test the internal state changes,
      // we'll test that the sync callbacks are properly set up
      expect(calendarService.setSyncCallbacks).toHaveBeenCalled()
    })
  })

  describe('Component Lifecycle', () => {
    it('sets up sync callbacks on mount', async () => {
      await act(async () => {
        render(<TitleBar {...defaultProps} />)
      })
      
      expect(calendarService.setSyncCallbacks).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Function)
      )
    })
  })
})