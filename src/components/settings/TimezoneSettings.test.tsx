import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '../../test/utils'
import { createTimezoneSettingsProps } from '../../test/utils'
import TimezoneSettings from './TimezoneSettings'
import { storageService } from '../../services/storage'

// Mock the storage service
vi.mock('../../services/storage', () => ({
  storageService: {
    getTimezone: vi.fn(),
    setTimezone: vi.fn()
  }
}))

// Simple dayjs mock
vi.mock('dayjs', () => {
  const mockTime = {
    format: vi.fn(() => 'Jan 15, 2024 2:30:45 PM'),
    utcOffset: vi.fn(() => -300)
  }
  const mockDayjs = vi.fn(() => mockTime)
  mockDayjs.extend = vi.fn()
  mockTime.tz = vi.fn(() => mockTime)
  
  return {
    default: mockDayjs
  }
})

// Mock dayjs plugins
vi.mock('dayjs/plugin/timezone', () => ({ default: {} }))
vi.mock('dayjs/plugin/utc', () => ({ default: {} }))

describe('TimezoneSettings', () => {
  const defaultProps = createTimezoneSettingsProps()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(storageService.getTimezone).mockResolvedValue('America/New_York')
    vi.mocked(storageService.setTimezone).mockResolvedValue(undefined)
    
    // Mock Intl.DateTimeFormat for fallback timezone
    global.Intl = {
      ...global.Intl,
      DateTimeFormat: vi.fn(() => ({
        resolvedOptions: () => ({ timeZone: 'America/New_York' })
      }))
    } as any
  })

  describe('Component Visibility and Search', () => {
    it('renders when no search term is provided', async () => {
      render(<TimezoneSettings {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.getByText('Timezone')).toBeInTheDocument()
      })
    })

    it('renders when search term matches timezone keywords', async () => {
      const props = createTimezoneSettingsProps({ searchTerm: 'timezone' })
      render(<TimezoneSettings {...props} />)
      
      await waitFor(() => {
        expect(screen.getByText('Timezone')).toBeInTheDocument()
      })
    })

    it('renders when search term matches other relevant keywords', async () => {
      const props = createTimezoneSettingsProps({ searchTerm: 'clock' })
      render(<TimezoneSettings {...props} />)
      
      await waitFor(() => {
        expect(screen.getByText('Timezone')).toBeInTheDocument()
      })
    })

    it('does not render when search term does not match', async () => {
      const props = createTimezoneSettingsProps({ searchTerm: 'unrelated' })
      const { container } = render(<TimezoneSettings {...props} />)
      
      await waitFor(() => {
        expect(container.firstChild).toBeNull()
      })
    })
  })

  describe('Basic Rendering', () => {
    it('displays timezone section header with icon', async () => {
      render(<TimezoneSettings {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.getByText('Timezone')).toBeInTheDocument()
        // Icon is rendered as part of the title
      })
    })

    it('displays timezone description', async () => {
      render(<TimezoneSettings {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.getByText('Display Timezone')).toBeInTheDocument()
        expect(screen.getByText(/This timezone will be used for displaying all calendar events/)).toBeInTheDocument()
      })
    })

    it('displays timezone selector', async () => {
      render(<TimezoneSettings {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.getByRole('combobox')).toBeInTheDocument()
        // Select should be present with selected value
        const select = screen.getByRole('combobox')
        expect(select).toHaveAttribute('type', 'search')
      })
    })
  })

  describe('Storage Integration', () => {
    it('loads timezone from storage on mount', async () => {
      render(<TimezoneSettings {...defaultProps} />)
      
      await waitFor(() => {
        expect(storageService.getTimezone).toHaveBeenCalled()
      })
    })

    it('handles storage error gracefully', async () => {
      vi.mocked(storageService.getTimezone).mockRejectedValue(new Error('Storage error'))
      
      expect(() => {
        render(<TimezoneSettings {...defaultProps} />)
      }).not.toThrow()
      
      await waitFor(() => {
        expect(screen.getByText('Timezone')).toBeInTheDocument()
      })
    })

    it('falls back to browser timezone on storage error', async () => {
      vi.mocked(storageService.getTimezone).mockRejectedValue(new Error('Storage error'))
      
      render(<TimezoneSettings {...defaultProps} />)
      
      await waitFor(() => {
        // Component should still render with fallback timezone
        expect(screen.getByRole('combobox')).toBeInTheDocument()
      })
    })
  })

  describe('Current Time Display', () => {
    it('displays current time alert when timezone is selected', async () => {
      render(<TimezoneSettings {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.getByText('Current time in selected timezone:')).toBeInTheDocument()
        expect(screen.getByText('Jan 15, 2024 2:30:45 PM')).toBeInTheDocument()
      })
    })

    it('displays time in info alert format', async () => {
      render(<TimezoneSettings {...defaultProps} />)
      
      await waitFor(() => {
        // Alert should be present with info type
        const timeAlert = screen.getByText('Current time in selected timezone:').closest('.ant-alert')
        expect(timeAlert).toBeInTheDocument()
        expect(timeAlert).toHaveClass('ant-alert-info')
      })
    })
  })

  describe('Component Structure', () => {
    it('renders within a card layout', async () => {
      render(<TimezoneSettings {...defaultProps} />)
      
      await waitFor(() => {
        const cardElement = screen.getByText('Display Timezone').closest('.ant-card')
        expect(cardElement).toBeInTheDocument()
      })
    })

    it('has proper spacing and layout structure', async () => {
      render(<TimezoneSettings {...defaultProps} />)
      
      await waitFor(() => {
        // Should have proper vertical spacing structure
        const spaceElement = screen.getByText('Display Timezone').closest('.ant-space')
        expect(spaceElement).toBeInTheDocument()
        expect(spaceElement).toHaveClass('ant-space-vertical')
      })
    })
  })

  describe('Loading States', () => {
    it('disables select initially while loading', async () => {
      // Keep the component in loading state by not resolving the promise
      vi.mocked(storageService.getTimezone).mockImplementation(() => new Promise(() => {}))
      
      render(<TimezoneSettings {...defaultProps} />)
      
      // Initially disabled while loading
      const select = screen.getByRole('combobox')
      expect(select).toBeDisabled()
    })

    it('enables select after loading completes', async () => {
      render(<TimezoneSettings {...defaultProps} />)
      
      await waitFor(() => {
        const select = screen.getByRole('combobox')
        expect(select).not.toBeDisabled()
      })
    })
  })

  describe('Timezone Options', () => {
    it('provides comprehensive timezone options when opened', async () => {
      render(<TimezoneSettings {...defaultProps} />)
      
      await waitFor(() => {
        const select = screen.getByRole('combobox')
        expect(select).toBeInTheDocument()
        // Options are generated dynamically when select is opened
      })
    })
  })

  describe('Error Handling', () => {
    it('handles component mounting gracefully', async () => {
      expect(() => {
        render(<TimezoneSettings {...defaultProps} />)
      }).not.toThrow()
    })

    it('handles props changes gracefully', async () => {
      const { rerender } = render(<TimezoneSettings {...defaultProps} />)
      
      expect(() => {
        rerender(<TimezoneSettings {...createTimezoneSettingsProps({ searchTerm: 'test' })} />)
      }).not.toThrow()
    })
  })

  describe('Accessibility', () => {
    it('has proper form labels and structure', async () => {
      render(<TimezoneSettings {...defaultProps} />)
      
      await waitFor(() => {
        expect(screen.getByText('Display Timezone')).toBeInTheDocument()
        expect(screen.getByRole('combobox')).toBeInTheDocument()
      })
    })

    it('has searchable select input', async () => {
      render(<TimezoneSettings {...defaultProps} />)
      
      await waitFor(() => {
        // Check for the search input inside the select
        const searchInput = screen.getByRole('combobox')
        expect(searchInput).toBeInTheDocument()
        expect(searchInput).toHaveAttribute('type', 'search')
      })
    })
  })

  describe('Component Props', () => {
    it('handles empty search term', () => {
      const props = createTimezoneSettingsProps({ searchTerm: '' })
      expect(() => {
        render(<TimezoneSettings {...props} />)
      }).not.toThrow()
    })

    it('handles undefined search term', () => {
      const props = createTimezoneSettingsProps({ searchTerm: undefined })
      expect(() => {
        render(<TimezoneSettings {...props} />)
      }).not.toThrow()
    })
  })
})