import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, act } from '@testing-library/react'
import { render } from '../../test/utils'
import EventTypesSettings from './EventTypesSettings'
import type { EventType } from '../../types'

// Mock the electron API
const mockElectronAPI = {
  getEventTypes: vi.fn(),
  createEventType: vi.fn(),
  updateEventType: vi.fn(),
  deleteEventType: vi.fn()
}

// Mock data
const mockEventTypes: EventType[] = [
  {
    id: 1,
    name: 'Work',
    color: '#1890ff',
    is_default: false,
    created_at: '2023-01-01T00:00:00Z'
  },
  {
    id: 2,
    name: 'Personal',
    color: '#52c41a',
    is_default: true,
    created_at: '2023-01-01T00:00:00Z'
  }
]

describe('EventTypesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    
    // Setup window.electronAPI mock
    Object.defineProperty(window, 'electronAPI', {
      value: mockElectronAPI,
      writable: true
    })
    
    // Default mock implementations
    mockElectronAPI.getEventTypes.mockResolvedValue(mockEventTypes)
    mockElectronAPI.createEventType.mockResolvedValue({ id: 3 })
    mockElectronAPI.updateEventType.mockResolvedValue(true)
    mockElectronAPI.deleteEventType.mockResolvedValue(true)
  })

  it('renders the component with basic elements', async () => {
    await act(async () => {
      render(<EventTypesSettings />)
    })
    
    expect(screen.getByText('Types')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add type/i })).toBeInTheDocument()
    expect(screen.getByText(/define event types that can be automatically assigned/i)).toBeInTheDocument()
  })

  it('loads and displays event types', async () => {
    await act(async () => {
      render(<EventTypesSettings />)
    })
    
    await waitFor(() => {
      expect(mockElectronAPI.getEventTypes).toHaveBeenCalled()
    })
    
    await waitFor(() => {
      expect(screen.getByText('Work')).toBeInTheDocument()
      expect(screen.getByText('Personal')).toBeInTheDocument()
    })
  })

  it('shows default type indicator', async () => {
    await act(async () => {
      render(<EventTypesSettings />)
    })
    
    await waitFor(() => {
      expect(screen.getByText('(Default)')).toBeInTheDocument()
    })
  })

  it('filters types based on search term', async () => {
    await act(async () => {
      render(<EventTypesSettings searchTerm="work" />)
    })
    
    await waitFor(() => {
      expect(screen.getByText('Work')).toBeInTheDocument()
      expect(screen.queryByText('Personal')).not.toBeInTheDocument()
    })
  })

  it('hides component when search term does not match', async () => {
    await act(async () => {
      const { container } = render(<EventTypesSettings searchTerm="nonexistent" />)
      expect(container.firstChild).toBeNull()
    })
  })

  it('handles API errors gracefully', async () => {
    mockElectronAPI.getEventTypes.mockRejectedValue(new Error('API Error'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    
    await act(async () => {
      render(<EventTypesSettings />)
    })
    
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith('Error loading event types:', expect.any(Error))
    })
    
    consoleSpy.mockRestore()
  })

  it('displays event type colors as color swatches', async () => {
    await act(async () => {
      render(<EventTypesSettings />)
    })
    
    await waitFor(() => {
      // Check if color swatches are rendered (they have specific background colors)
      const elements = document.querySelectorAll('[style*="background-color"]')
      expect(elements.length).toBeGreaterThan(0)
    })
  })

  it('shows edit and delete buttons for each type', async () => {
    await act(async () => {
      render(<EventTypesSettings />)
    })
    
    await waitFor(() => {
      const editButtons = screen.getAllByLabelText(/edit/i)
      const deleteButtons = screen.getAllByLabelText(/delete/i)
      
      expect(editButtons.length).toBe(2) // Two event types
      expect(deleteButtons.length).toBe(2)
    })
  })
})