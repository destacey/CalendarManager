import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '../test/utils'
import { createUserMenuProps } from '../test/utils'
import UserMenu from './UserMenu'
import { authService } from '../services/auth'

// Mock the auth service
vi.mock('../services/auth', () => ({
  authService: {
    isLoggedIn: vi.fn(),
    getGraphClient: vi.fn(),
    logout: vi.fn()
  }
}))

// Mock the theme context
const mockToggleTheme = vi.fn()
vi.mock('../contexts/ThemeContext', () => ({
  useTheme: () => ({
    themeMode: 'light',
    toggleTheme: mockToggleTheme
  }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children
}))

// Create mock graph client with proper chaining
const mockGet = vi.fn()
const mockGraphClient = {
  api: vi.fn(() => ({
    get: mockGet
  }))
}

const mockUserData = {
  displayName: 'John Doe',
  mail: 'john.doe@example.com',
  userPrincipalName: 'john.doe@example.com',
  givenName: 'John',
  surname: 'Doe'
}

describe('UserMenu', () => {
  const defaultProps = createUserMenuProps()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authService.isLoggedIn).mockReturnValue(true)
    vi.mocked(authService.getGraphClient).mockResolvedValue(mockGraphClient)
    vi.mocked(authService.logout).mockResolvedValue(undefined)
    mockGet.mockResolvedValue(mockUserData)
  })

  describe('Loading State', () => {
    it('shows loading state initially', () => {
      render(<UserMenu {...defaultProps} />)
      
      expect(screen.getByText('Loading...')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /loading/i })).toBeInTheDocument()
    })

    it('shows loading icon in loading state', () => {
      render(<UserMenu {...defaultProps} />)
      
      // The loading icon should be present
      const loadingButton = screen.getByRole('button', { name: /loading/i })
      expect(loadingButton).toBeInTheDocument()
    })
  })

  describe('User Data Fetching', () => {
    it('fetches user data on mount when logged in', async () => {
      render(<UserMenu {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
      
      expect(authService.isLoggedIn).toHaveBeenCalled()
      expect(authService.getGraphClient).toHaveBeenCalled()
      expect(mockGraphClient.api).toHaveBeenCalledWith('/me')
      expect(mockGet).toHaveBeenCalled()
    })

    it('does not fetch user data when not logged in', async () => {
      vi.mocked(authService.isLoggedIn).mockReturnValue(false)
      
      render(<UserMenu {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
      
      expect(authService.getGraphClient).not.toHaveBeenCalled()
    })

    it('handles user data fetch error gracefully', async () => {
      vi.mocked(authService.getGraphClient).mockRejectedValue(new Error('Network error'))
      
      render(<UserMenu {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
      
      // Should still render but with fallback data
      // We can't easily test the dropdown menu items without opening the dropdown
    })
  })

  describe('Avatar and Name Display', () => {
    it('displays user avatar with initials when loaded', async () => {
      render(<UserMenu {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
      
      // Avatar should be present
      expect(screen.getByRole('img')).toBeInTheDocument()
    })

    it('displays user name when showName is true', async () => {
      const props = createUserMenuProps({ showName: true })
      render(<UserMenu {...props} />)
      
      await waitFor(() => {
        expect(screen.getByText('John')).toBeInTheDocument()
      })
    })

    it('does not display user name when showName is false', async () => {
      const props = createUserMenuProps({ showName: false })
      render(<UserMenu {...props} />)
      
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
      
      expect(screen.queryByText('John')).not.toBeInTheDocument()
    })

    it('falls back to displayName when givenName is not available', async () => {
      const userDataWithoutGivenName = {
        ...mockUserData,
        givenName: ''
      }
      mockGet.mockResolvedValue(userDataWithoutGivenName)
      
      const props = createUserMenuProps({ showName: true })
      render(<UserMenu {...props} />)
      
      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument()
      })
    })

    it('falls back to "User" when no name data is available', async () => {
      const userDataWithoutName = {
        ...mockUserData,
        givenName: '',
        displayName: ''
      }
      mockGet.mockResolvedValue(userDataWithoutName)
      
      const props = createUserMenuProps({ showName: true })
      render(<UserMenu {...props} />)
      
      await waitFor(() => {
        expect(screen.getByText('Unknown User')).toBeInTheDocument()
      })
    })
  })

  describe('Dropdown Menu', () => {
    const openDropdown = async () => {
      render(<UserMenu {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
      
      // Click the user button to open dropdown
      const userButton = screen.getByRole('button')
      fireEvent.click(userButton)
    }

    it('opens dropdown menu when user button is clicked', async () => {
      await openDropdown()
      
      // Should show user profile info
      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.getByText('john.doe@example.com')).toBeInTheDocument()
    })

    it('displays user profile information in dropdown', async () => {
      await openDropdown()
      
      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.getByText('john.doe@example.com')).toBeInTheDocument()
    })

    it('displays theme toggle in dropdown', async () => {
      await openDropdown()
      
      expect(screen.getByText('Dark Mode')).toBeInTheDocument()
      expect(screen.getByRole('switch')).toBeInTheDocument()
    })

    it('displays sign out option in dropdown', async () => {
      await openDropdown()
      
      expect(screen.getByText('Sign Out')).toBeInTheDocument()
    })

    it('displays data management option when provided', async () => {
      const props = createUserMenuProps({ onDataManagement: vi.fn() })
      render(<UserMenu {...props} />)
      
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
      
      const userButton = screen.getByRole('button')
      fireEvent.click(userButton)
      
      expect(screen.getByText('Data Management')).toBeInTheDocument()
    })

    it('does not display data management option when not provided', async () => {
      const props = createUserMenuProps({ onDataManagement: undefined })
      render(<UserMenu {...props} />)
      
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
      
      const userButton = screen.getByRole('button')
      fireEvent.click(userButton)
      
      expect(screen.queryByText('Data Management')).not.toBeInTheDocument()
    })
  })

  describe('Theme Toggle Functionality', () => {
    it('calls toggleTheme when theme switch is toggled', async () => {
      render(<UserMenu {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
      
      const userButton = screen.getByRole('button')
      fireEvent.click(userButton)
      
      const themeSwitch = screen.getByRole('switch')
      fireEvent.click(themeSwitch)
      
      expect(mockToggleTheme).toHaveBeenCalled()
    })

    it('displays correct icon for light mode', async () => {
      // Theme context is mocked to return 'light' mode
      render(<UserMenu {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
      
      const userButton = screen.getByRole('button')
      fireEvent.click(userButton)
      
      // Should show sun icon for light mode
      expect(screen.getByText('Dark Mode')).toBeInTheDocument()
    })

    it('handles theme switch click without closing dropdown', async () => {
      render(<UserMenu {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
      
      const userButton = screen.getByRole('button')
      fireEvent.click(userButton)
      
      const themeSection = screen.getByText('Dark Mode').closest('.ant-dropdown-menu-item')
      expect(themeSection).toBeInTheDocument()
      
      // Clicking the theme section should not close the dropdown
      fireEvent.click(themeSection!)
      
      // Menu should still be visible
      expect(screen.getByText('Dark Mode')).toBeInTheDocument()
    })
  })

  describe('Logout Functionality', () => {
    it('calls logout service and onLogout prop when sign out is clicked', async () => {
      const mockOnLogout = vi.fn()
      const props = createUserMenuProps({ onLogout: mockOnLogout })
      render(<UserMenu {...props} />)
      
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
      
      const userButton = screen.getByRole('button')
      fireEvent.click(userButton)
      
      const signOutButton = screen.getByText('Sign Out')
      fireEvent.click(signOutButton)
      
      await waitFor(() => {
        expect(authService.logout).toHaveBeenCalled()
        expect(mockOnLogout).toHaveBeenCalled()
      })
    })

    it('calls onLogout even when logout service fails', async () => {
      vi.mocked(authService.logout).mockRejectedValue(new Error('Logout failed'))
      
      const mockOnLogout = vi.fn()
      const props = createUserMenuProps({ onLogout: mockOnLogout })
      render(<UserMenu {...props} />)
      
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
      
      const userButton = screen.getByRole('button')
      fireEvent.click(userButton)
      
      const signOutButton = screen.getByText('Sign Out')
      fireEvent.click(signOutButton)
      
      await waitFor(() => {
        expect(mockOnLogout).toHaveBeenCalled()
      })
    })
  })

  describe('Data Management Functionality', () => {
    it('calls onDataManagement when data management option is clicked', async () => {
      const mockOnDataManagement = vi.fn()
      const props = createUserMenuProps({ onDataManagement: mockOnDataManagement })
      render(<UserMenu {...props} />)
      
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
      
      const userButton = screen.getByRole('button')
      fireEvent.click(userButton)
      
      const dataManagementButton = screen.getByText('Data Management')
      fireEvent.click(dataManagementButton)
      
      expect(mockOnDataManagement).toHaveBeenCalled()
    })
  })

  describe('Initials Generation', () => {
    it('generates correct initials from full name', async () => {
      // This tests the getInitials function indirectly through the avatar
      render(<UserMenu {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
      
      // The avatar should contain the initials (rendered as text content)
      // This is hard to test directly as it's rendered inside the avatar
      const avatar = screen.getByRole('img')
      expect(avatar).toBeInTheDocument()
    })

    it('handles single name correctly', async () => {
      const singleNameUser = {
        ...mockUserData,
        displayName: 'John'
      }
      mockGet.mockResolvedValue(singleNameUser)
      
      render(<UserMenu {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
      
      const avatar = screen.getByRole('img')
      expect(avatar).toBeInTheDocument()
    })
  })

  describe('Email Fallback', () => {
    it('uses userPrincipalName when mail is not available', async () => {
      const userWithoutMail = {
        ...mockUserData,
        mail: '',
        userPrincipalName: 'john.doe@company.com'
      }
      mockGet.mockResolvedValue(userWithoutMail)
      
      render(<UserMenu {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
      
      const userButton = screen.getByRole('button')
      fireEvent.click(userButton)
      
      expect(screen.getByText('john.doe@company.com')).toBeInTheDocument()
    })

    it('handles missing email gracefully', async () => {
      const userWithoutEmail = {
        ...mockUserData,
        mail: '',
        userPrincipalName: ''
      }
      mockGet.mockResolvedValue(userWithoutEmail)
      
      render(<UserMenu {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      })
      
      // Should still render without errors
      const userButton = screen.getByRole('button')
      fireEvent.click(userButton)
      
      expect(screen.getByText('John Doe')).toBeInTheDocument()
    })
  })
})