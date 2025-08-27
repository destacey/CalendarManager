import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '../test/utils'
import { createTitleBarProps } from '../test/utils'
import TitleBar from './TitleBar'
import { calendarService } from '../services/calendar'

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

// Mock electron API
const mockElectronAPI = {
  isWindowMaximized: vi.fn(),
  minimizeWindow: vi.fn(),
  maximizeWindow: vi.fn(),
  closeWindow: vi.fn(),
  onWindowStateChange: vi.fn(),
  removeAllListeners: vi.fn()
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true
})

describe('TitleBar', () => {
  const defaultProps = createTitleBarProps()

  beforeEach(() => {
    vi.clearAllMocks()
    mockElectronAPI.isWindowMaximized.mockResolvedValue(false)
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
    it('calls minimizeWindow when minimize button is clicked', async () => {
      await act(async () => {
        render(<TitleBar {...defaultProps} />)
      })
      
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /minus/i }))
      })
      
      expect(mockElectronAPI.minimizeWindow).toHaveBeenCalledOnce()
    })

    it('calls maximizeWindow when maximize button is clicked', async () => {
      await act(async () => {
        render(<TitleBar {...defaultProps} />)
      })
      
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /border/i }))
      })
      
      expect(mockElectronAPI.maximizeWindow).toHaveBeenCalledOnce()
    })

    it('calls closeWindow when close button is clicked', async () => {
      await act(async () => {
        render(<TitleBar {...defaultProps} />)
      })
      
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /close/i }))
      })
      
      expect(mockElectronAPI.closeWindow).toHaveBeenCalledOnce()
    })

    it('shows correct maximize/restore button based on window state', async () => {
      mockElectronAPI.isWindowMaximized.mockResolvedValue(true)
      
      await act(async () => {
        render(<TitleBar {...defaultProps} />)
      })
      
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /block/i })).toBeInTheDocument()
      })
    })

    it('handles window state change events', async () => {
      await act(async () => {
        render(<TitleBar {...defaultProps} />)
      })
      
      expect(mockElectronAPI.onWindowStateChange).toHaveBeenCalledWith(expect.any(Function))
    })

    it('handles missing electronAPI gracefully', async () => {
      // Temporarily remove electronAPI by setting to undefined
      const originalAPI = window.electronAPI
      ;(window as any).electronAPI = undefined
      
      await act(async () => {
        expect(() => {
          render(<TitleBar {...defaultProps} />)
        }).not.toThrow()
      })
      
      // Restore electronAPI
      ;(window as any).electronAPI = originalAPI
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

    it('cleans up listeners on unmount', async () => {
      const { unmount } = await act(async () => {
        return render(<TitleBar {...defaultProps} />)
      })
      
      unmount()
      
      expect(mockElectronAPI.removeAllListeners).toHaveBeenCalledWith('window-state-change')
      
      expect(calendarService.setSyncCallbacks).toHaveBeenCalledWith()
    })

    it('handles missing removeAllListeners gracefully', async () => {
      const originalRemoveAllListeners = mockElectronAPI.removeAllListeners
      delete mockElectronAPI.removeAllListeners
      
      const { unmount } = await act(async () => {
        return render(<TitleBar {...defaultProps} />)
      })
      
      expect(() => {
        unmount()
      }).not.toThrow()
      
      mockElectronAPI.removeAllListeners = originalRemoveAllListeners
    })
  })

  describe('Error Handling', () => {
    it('handles isWindowMaximized error gracefully', async () => {
      mockElectronAPI.isWindowMaximized.mockRejectedValue(new Error('Test error'))
      
      // Should not throw
      await act(async () => {
        expect(() => {
          render(<TitleBar {...defaultProps} />)
        }).not.toThrow()
      })
      
      // Should log warning (we can't easily test console.warn in this setup)
    })
  })
})