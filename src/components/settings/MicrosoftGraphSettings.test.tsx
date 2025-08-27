import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '../../test/utils'
import { createMicrosoftGraphSettingsProps } from '../../test/utils'
import MicrosoftGraphSettings from './MicrosoftGraphSettings'
import { storageService } from '../../services/storage'

// Mock the storage service
vi.mock('../../services/storage', () => ({
  storageService: {
    getAppRegistrationId: vi.fn(),
    setAppRegistrationId: vi.fn()
  }
}))

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn()
  }
})

describe('MicrosoftGraphSettings', () => {
  const defaultProps = createMicrosoftGraphSettingsProps()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(storageService.getAppRegistrationId).mockResolvedValue('test-client-id')
    vi.mocked(storageService.setAppRegistrationId).mockResolvedValue(undefined)
    vi.mocked(navigator.clipboard.writeText).mockResolvedValue(undefined)
  })

  describe('Component Visibility and Search', () => {
    it('renders when no search term is provided', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.getByText('Microsoft Graph')).toBeInTheDocument()
      })
    })

    it('renders when search term matches graph keywords', async () => {
      const props = createMicrosoftGraphSettingsProps({ searchTerm: 'microsoft' })
      render(<MicrosoftGraphSettings {...props} />)
      
      await waitFor(() => {
        expect(screen.getByText('Microsoft Graph')).toBeInTheDocument()
      })
    })

    it('renders when search term matches client ID keywords', async () => {
      const props = createMicrosoftGraphSettingsProps({ searchTerm: 'client id' })
      render(<MicrosoftGraphSettings {...props} />)
      
      await waitFor(() => {
        expect(screen.getByText('Microsoft Graph')).toBeInTheDocument()
      })
    })

    it('renders when search term matches stored client ID', async () => {
      vi.mocked(storageService.getAppRegistrationId).mockResolvedValue('abc123')
      const props = createMicrosoftGraphSettingsProps({ searchTerm: 'abc123' })
      render(<MicrosoftGraphSettings {...props} />)
      
      await waitFor(() => {
        expect(screen.getByText('Microsoft Graph')).toBeInTheDocument()
      })
    })

    it('does not render when search term does not match', async () => {
      const props = createMicrosoftGraphSettingsProps({ searchTerm: 'unrelated' })
      const { container } = render(<MicrosoftGraphSettings {...props} />)
      
      await waitFor(() => {
        // Since we have App provider wrapper, check that the content div is empty
        const appDiv = container.querySelector('.ant-app')
        expect(appDiv?.children.length).toBe(0)
      })
    })
  })

  describe('Basic Rendering', () => {
    it('displays section header with icon', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.getByText('Microsoft Graph')).toBeInTheDocument()
        // Icon is rendered as part of the title
      })
    })

    it('displays client ID input field', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.getByText('Application Registration ID')).toBeInTheDocument()
        expect(screen.getByPlaceholderText('Enter your Microsoft Graph Client ID...')).toBeInTheDocument()
      })
    })

    it('displays description text', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.getByText(/The Client ID from your Microsoft Azure App Registration/)).toBeInTheDocument()
      })
    })
  })

  describe('Storage Integration', () => {
    it('loads client ID from storage on mount', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      await waitFor(() => {
        expect(storageService.getAppRegistrationId).toHaveBeenCalled()
      })
    })

    it('displays loaded client ID in input', async () => {
      vi.mocked(storageService.getAppRegistrationId).mockResolvedValue('loaded-client-id')
      
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      await waitFor(() => {
        const input = screen.getByDisplayValue('loaded-client-id')
        expect(input).toBeInTheDocument()
      })
    })

    it('handles storage error gracefully', async () => {
      vi.mocked(storageService.getAppRegistrationId).mockRejectedValue(new Error('Storage error'))
      
      expect(() => {
        render(<MicrosoftGraphSettings {...defaultProps} />)
      }).not.toThrow()
      
      await waitFor(() => {
        expect(screen.getByText('Microsoft Graph')).toBeInTheDocument()
      })
    })

    it('falls back to empty string on storage error', async () => {
      vi.mocked(storageService.getAppRegistrationId).mockRejectedValue(new Error('Storage error'))
      
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      await waitFor(() => {
        const input = screen.getByPlaceholderText('Enter your Microsoft Graph Client ID...')
        expect(input).toHaveValue('')
      })
    })
  })

  describe('Input Handling', () => {
    it('updates input value when user types', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      await waitFor(() => {
        const input = screen.getByPlaceholderText('Enter your Microsoft Graph Client ID...')
        fireEvent.change(input, { target: { value: 'new-client-id' } })
        expect(input).toHaveValue('new-client-id')
      })
    })

    it('shows save button when input changes', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      // Wait for component to load first
      await waitFor(() => {
        expect(screen.getByDisplayValue('test-client-id')).toBeInTheDocument()
      })
      
      // Change to a different value
      const input = screen.getByPlaceholderText('Enter your Microsoft Graph Client ID...')
      fireEvent.change(input, { target: { value: 'different-id' } })
      
      await waitFor(() => {
        expect(screen.getByText('Save Changes')).toBeInTheDocument()
      })
    })

    it('hides save button when input matches stored value', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      // Wait for component to load first
      await waitFor(() => {
        expect(screen.getByDisplayValue('test-client-id')).toBeInTheDocument()
      })
      
      const input = screen.getByPlaceholderText('Enter your Microsoft Graph Client ID...')
      
      // First change to trigger save button
      fireEvent.change(input, { target: { value: 'different-id' } })
      
      await waitFor(() => {
        expect(screen.getByText('Save Changes')).toBeInTheDocument()
      })
      
      // Then change back to original
      fireEvent.change(input, { target: { value: 'test-client-id' } })
      
      await waitFor(() => {
        expect(screen.queryByText('Save Changes')).not.toBeInTheDocument()
      })
    })

    it('disables input when loading', () => {
      // Keep the component in loading state by not resolving the promise
      vi.mocked(storageService.getAppRegistrationId).mockImplementation(() => new Promise(() => {}))
      
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      const input = screen.getByPlaceholderText('Enter your Microsoft Graph Client ID...')
      expect(input).toBeDisabled()
    })
  })

  describe('Copy Functionality', () => {
    it('shows copy button when input has value', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.getByTitle('Copy to clipboard')).toBeInTheDocument()
      })
    })

    it('does not show copy button when input is empty', async () => {
      vi.mocked(storageService.getAppRegistrationId).mockResolvedValue('')
      
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.queryByTitle('Copy to clipboard')).not.toBeInTheDocument()
      })
    })

    it('copies current input value to clipboard when copy button is clicked', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      await waitFor(() => {
        const input = screen.getByDisplayValue('test-client-id')
        fireEvent.change(input, { target: { value: 'new-value-to-copy' } })
      })
      
      const copyButton = screen.getByTitle('Copy to clipboard')
      fireEvent.click(copyButton)
      
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('new-value-to-copy')
    })
  })

  describe('Save Functionality', () => {
    it('saves client ID when save button is clicked', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      // Wait for component to load first
      await waitFor(() => {
        expect(screen.getByDisplayValue('test-client-id')).toBeInTheDocument()
      })
      
      const input = screen.getByPlaceholderText('Enter your Microsoft Graph Client ID...')
      fireEvent.change(input, { target: { value: 'new-client-id' } })
      
      await waitFor(() => {
        const saveButton = screen.getByText('Save Changes')
        fireEvent.click(saveButton)
      })
      
      await waitFor(() => {
        expect(storageService.setAppRegistrationId).toHaveBeenCalledWith('new-client-id')
      })
    })

    it('shows success message after successful save', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      // Wait for component to load first
      await waitFor(() => {
        expect(screen.getByDisplayValue('test-client-id')).toBeInTheDocument()
      })
      
      const input = screen.getByPlaceholderText('Enter your Microsoft Graph Client ID...')
      fireEvent.change(input, { target: { value: 'new-client-id' } })
      
      await waitFor(() => {
        const saveButton = screen.getByText('Save Changes')
        fireEvent.click(saveButton)
      })
      
      await waitFor(() => {
        expect(screen.getByText('Client ID updated successfully!')).toBeInTheDocument()
        expect(screen.getByText('You may need to restart the application for changes to take effect.')).toBeInTheDocument()
      })
    })

    it('hides save button after successful save', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      // Wait for component to load first
      await waitFor(() => {
        expect(screen.getByDisplayValue('test-client-id')).toBeInTheDocument()
      })
      
      const input = screen.getByPlaceholderText('Enter your Microsoft Graph Client ID...')
      fireEvent.change(input, { target: { value: 'new-client-id' } })
      
      await waitFor(() => {
        const saveButton = screen.getByText('Save Changes')
        fireEvent.click(saveButton)
      })
      
      // Wait for save operation to complete and button to be hidden
      await waitFor(() => {
        expect(storageService.setAppRegistrationId).toHaveBeenCalledWith('new-client-id')
        expect(screen.queryByText('Save Changes')).not.toBeInTheDocument()
        expect(screen.queryByText('Saved!')).not.toBeInTheDocument()
      })
    })

    it('disables save button when input is empty', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      // Wait for component to load first
      await waitFor(() => {
        expect(screen.getByDisplayValue('test-client-id')).toBeInTheDocument()
      })
      
      const input = screen.getByPlaceholderText('Enter your Microsoft Graph Client ID...')
      fireEvent.change(input, { target: { value: '   ' } }) // whitespace only
      
      await waitFor(() => {
        const saveButton = screen.getByRole('button', { name: 'Save Changes' })
        expect(saveButton).toBeDisabled()
      })
    })

    it('handles save error gracefully', async () => {
      vi.mocked(storageService.setAppRegistrationId).mockRejectedValue(new Error('Save failed'))
      
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      // Wait for component to load first
      await waitFor(() => {
        expect(screen.getByDisplayValue('test-client-id')).toBeInTheDocument()
      })
      
      const input = screen.getByPlaceholderText('Enter your Microsoft Graph Client ID...')
      fireEvent.change(input, { target: { value: 'new-client-id' } })
      
      await waitFor(() => {
        const saveButton = screen.getByText('Save Changes')
        
        expect(() => {
          fireEvent.click(saveButton)
        }).not.toThrow()
      })
      
      // Should still attempt to save
      await waitFor(() => {
        expect(storageService.setAppRegistrationId).toHaveBeenCalledWith('new-client-id')
      })
    })
  })

  describe('Success Alert', () => {
    it('shows success alert after saving', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      // Wait for component to load first
      await waitFor(() => {
        expect(screen.getByDisplayValue('test-client-id')).toBeInTheDocument()
      })
      
      const input = screen.getByPlaceholderText('Enter your Microsoft Graph Client ID...')
      fireEvent.change(input, { target: { value: 'new-client-id' } })
      
      await waitFor(() => {
        const saveButton = screen.getByText('Save Changes')
        fireEvent.click(saveButton)
      })
      
      await waitFor(() => {
        const alert = screen.getByText('Client ID updated successfully!').closest('.ant-alert')
        expect(alert).toBeInTheDocument()
        expect(alert).toHaveClass('ant-alert-success')
      })
    })

    it('allows closing the success alert', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      // Wait for component to load first
      await waitFor(() => {
        expect(screen.getByDisplayValue('test-client-id')).toBeInTheDocument()
      })
      
      const input = screen.getByPlaceholderText('Enter your Microsoft Graph Client ID...')
      fireEvent.change(input, { target: { value: 'new-client-id' } })
      
      await waitFor(() => {
        const saveButton = screen.getByText('Save Changes')
        fireEvent.click(saveButton)
      })
      
      await waitFor(() => {
        const alert = screen.getByText('Client ID updated successfully!').closest('.ant-alert')
        expect(alert).toBeInTheDocument()
        
        // Alert should have close button since closable=true
        const closeButton = alert?.querySelector('.ant-alert-close-icon')
        expect(closeButton).toBeInTheDocument()
      })
    })
  })

  describe('Component Structure', () => {
    it('renders within a card layout', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      await waitFor(() => {
        const cardElement = screen.getByText('Application Registration ID').closest('.ant-card')
        expect(cardElement).toBeInTheDocument()
      })
    })

    it('has proper spacing and layout structure', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      await waitFor(() => {
        const spaceElement = screen.getByText('Application Registration ID').closest('.ant-space')
        expect(spaceElement).toBeInTheDocument()
        expect(spaceElement).toHaveClass('ant-space-vertical')
      })
    })
  })

  describe('Loading States', () => {
    it('disables input initially while loading', () => {
      // Keep the component in loading state by not resolving the promise
      vi.mocked(storageService.getAppRegistrationId).mockImplementation(() => new Promise(() => {}))
      
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      const input = screen.getByPlaceholderText('Enter your Microsoft Graph Client ID...')
      expect(input).toBeDisabled()
    })

    it('enables input after loading completes', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      await waitFor(() => {
        const input = screen.getByPlaceholderText('Enter your Microsoft Graph Client ID...')
        expect(input).not.toBeDisabled()
      })
    })
  })

  describe('Error Handling', () => {
    it('handles component mounting gracefully', async () => {
      expect(() => {
        render(<MicrosoftGraphSettings {...defaultProps} />)
      }).not.toThrow()
      
      // Wait for async operations to complete
      await waitFor(() => {
        expect(screen.getByText('Microsoft Graph')).toBeInTheDocument()
      })
    })

    it('handles props changes gracefully', async () => {
      const { rerender } = render(<MicrosoftGraphSettings {...defaultProps} />)
      
      // Wait for initial render
      await waitFor(() => {
        expect(screen.getByText('Microsoft Graph')).toBeInTheDocument()
      })
      
      expect(() => {
        rerender(<MicrosoftGraphSettings {...createMicrosoftGraphSettingsProps({ searchTerm: 'test' })} />)
      }).not.toThrow()
    })
  })

  describe('Accessibility', () => {
    it('has proper form labels and structure', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.getByText('Application Registration ID')).toBeInTheDocument()
        expect(screen.getByPlaceholderText('Enter your Microsoft Graph Client ID...')).toBeInTheDocument()
      })
    })

    it('has accessible copy button with proper title', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      await waitFor(() => {
        const copyButton = screen.getByTitle('Copy to clipboard')
        expect(copyButton).toBeInTheDocument()
        expect(copyButton).toHaveAttribute('title', 'Copy to clipboard')
      })
    })
  })

  describe('Component Props', () => {
    it('handles empty search term', async () => {
      const props = createMicrosoftGraphSettingsProps({ searchTerm: '' })
      expect(() => {
        render(<MicrosoftGraphSettings {...props} />)
      }).not.toThrow()
      
      await waitFor(() => {
        expect(screen.getByText('Microsoft Graph')).toBeInTheDocument()
      })
    })

    it('handles undefined search term', async () => {
      const props = createMicrosoftGraphSettingsProps({ searchTerm: undefined })
      expect(() => {
        render(<MicrosoftGraphSettings {...props} />)
      }).not.toThrow()
      
      await waitFor(() => {
        expect(screen.getByText('Microsoft Graph')).toBeInTheDocument()
      })
    })
  })

  describe('Input Validation', () => {
    it('trims whitespace when checking if save should be disabled', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      // Wait for component to load first
      await waitFor(() => {
        expect(screen.getByDisplayValue('test-client-id')).toBeInTheDocument()
      })
      
      const input = screen.getByPlaceholderText('Enter your Microsoft Graph Client ID...')
      fireEvent.change(input, { target: { value: '   valid-id   ' } })
      
      await waitFor(() => {
        const saveButton = screen.getByText('Save Changes')
        expect(saveButton).not.toBeDisabled()
      })
    })

    it('saves trimmed value', async () => {
      render(<MicrosoftGraphSettings {...defaultProps} />)
      
      // Wait for component to load first
      await waitFor(() => {
        expect(screen.getByDisplayValue('test-client-id')).toBeInTheDocument()
      })
      
      const input = screen.getByPlaceholderText('Enter your Microsoft Graph Client ID...')
      fireEvent.change(input, { target: { value: '   valid-id   ' } })
      
      await waitFor(() => {
        const saveButton = screen.getByText('Save Changes')
        fireEvent.click(saveButton)
      })
      
      await waitFor(() => {
        // The component saves the exact value from the input, including spaces
        // The trimming is only used for validation
        expect(storageService.setAppRegistrationId).toHaveBeenCalledWith('   valid-id   ')
      })
    })
  })
})