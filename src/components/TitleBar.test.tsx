import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '../test/utils'
import { createTitleBarProps } from '../test/utils'
import TitleBar from './TitleBar'
import * as calendarService from '../services/calendar'
import * as windowApi from '../api/window'

// Mock the services and components
vi.mock('../services/calendar', () => ({
  cancelSync: vi.fn(() => Promise.resolve()),
  onSyncStatus: vi.fn(() => Promise.resolve(vi.fn())),
  onSyncComplete: vi.fn(() => Promise.resolve(vi.fn())),
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
    vi.mocked(calendarService.cancelSync).mockResolvedValue(undefined)
    vi.mocked(calendarService.onSyncStatus).mockResolvedValue(vi.fn())
    vi.mocked(calendarService.onSyncComplete).mockResolvedValue(vi.fn())
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

    it('shows the restore icon when the window starts maximized', async () => {
      vi.mocked(windowApi.isWindowMaximized).mockResolvedValue(true)

      const { container } = render(<TitleBar {...defaultProps} />)

      await waitFor(() => expect(windowApi.isWindowMaximized).toHaveBeenCalled())
      await waitFor(() =>
        expect(container.querySelector('.anticon-block')).toBeInTheDocument()
      )
      expect(container.querySelector('.anticon-border')).not.toBeInTheDocument()
    })

    it('shows the maximize icon when the window starts unmaximized', async () => {
      vi.mocked(windowApi.isWindowMaximized).mockResolvedValue(false)

      const { container } = render(<TitleBar {...defaultProps} />)

      await waitFor(() => expect(windowApi.isWindowMaximized).toHaveBeenCalled())
      await waitFor(() =>
        expect(container.querySelector('.anticon-border')).toBeInTheDocument()
      )
      expect(container.querySelector('.anticon-block')).not.toBeInTheDocument()
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

    it('shows a sync status indicator once a sync-status event arrives', async () => {
      let statusCallback: ((status: { fetched: number; phase: string }) => void) | undefined
      vi.mocked(calendarService.onSyncStatus).mockImplementation((callback: any) => {
        statusCallback = callback
        return Promise.resolve(vi.fn())
      })

      await act(async () => {
        render(<TitleBar {...defaultProps} />)
      })
      await waitFor(() => expect(calendarService.onSyncStatus).toHaveBeenCalled())

      // No sync in progress yet: the plain sync button still shows.
      expect(screen.getByRole('button', { name: /cloud-sync/i })).toBeInTheDocument()

      await act(async () => {
        statusCallback?.({ fetched: 12, phase: 'fetching' })
      })

      expect(screen.getByText('12 fetched · fetching')).toBeInTheDocument()
    })

    it('clears the sync status indicator once sync-complete fires', async () => {
      let statusCallback: ((status: { fetched: number; phase: string }) => void) | undefined
      let completeCallback: ((result: unknown) => void) | undefined
      vi.mocked(calendarService.onSyncStatus).mockImplementation((callback: any) => {
        statusCallback = callback
        return Promise.resolve(vi.fn())
      })
      vi.mocked(calendarService.onSyncComplete).mockImplementation((callback: any) => {
        completeCallback = callback
        return Promise.resolve(vi.fn())
      })

      await act(async () => {
        render(<TitleBar {...defaultProps} />)
      })
      await waitFor(() => expect(calendarService.onSyncComplete).toHaveBeenCalled())

      await act(async () => {
        statusCallback?.({ fetched: 5, phase: 'saving' })
      })
      expect(screen.getByText('5 fetched · saving')).toBeInTheDocument()

      await act(async () => {
        completeCallback?.({ success: true, message: '', stats: { created: 0, updated: 0, deleted: 0, total: 5 } })
      })
      expect(screen.queryByText(/fetched ·/)).not.toBeInTheDocument()
    })

    it('cancels the sync when the indicator cancel button is clicked', async () => {
      let statusCallback: ((status: { fetched: number; phase: string }) => void) | undefined
      vi.mocked(calendarService.onSyncStatus).mockImplementation((callback: any) => {
        statusCallback = callback
        return Promise.resolve(vi.fn())
      })

      await act(async () => {
        render(<TitleBar {...defaultProps} />)
      })
      await act(async () => {
        statusCallback?.({ fetched: 3, phase: 'fetching' })
      })

      await act(async () => {
        fireEvent.click(screen.getByTitle('Cancel sync'))
      })

      expect(calendarService.cancelSync).toHaveBeenCalled()
    })
  })

  describe('Component Lifecycle', () => {
    it('subscribes to sync status and completion events on mount, and unsubscribes on unmount', async () => {
      const unlistenStatus = vi.fn()
      const unlistenComplete = vi.fn()
      vi.mocked(calendarService.onSyncStatus).mockResolvedValue(unlistenStatus)
      vi.mocked(calendarService.onSyncComplete).mockResolvedValue(unlistenComplete)

      const { unmount } = render(<TitleBar {...defaultProps} />)

      await waitFor(() => expect(calendarService.onSyncStatus).toHaveBeenCalled())
      await waitFor(() => expect(calendarService.onSyncComplete).toHaveBeenCalled())

      unmount()

      await waitFor(() => expect(unlistenStatus).toHaveBeenCalled())
      await waitFor(() => expect(unlistenComplete).toHaveBeenCalled())
    })
  })
})
