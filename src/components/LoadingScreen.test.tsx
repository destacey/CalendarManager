import { describe, it, expect } from 'vitest'
import { render, screen } from '../test/utils'
import LoadingScreen from './LoadingScreen'

describe('LoadingScreen', () => {
  it('renders the loading screen with correct content', () => {
    render(<LoadingScreen />)
    
    // Check for the main title
    expect(screen.getByText('Calendar Manager')).toBeInTheDocument()
    
    // Check for the loading text
    expect(screen.getByText('Initializing your workspace...')).toBeInTheDocument()
    
    // Check for the calendar icon
    expect(screen.getByRole('img', { name: /calendar/i })).toBeInTheDocument()
  })

  it('applies correct styling classes', () => {
    const { container } = render(<LoadingScreen />)
    
    // Check that the main container has the expected Flex structure
    const flexContainer = container.querySelector('[style*="min-height: 100vh"]')
    expect(flexContainer).toBeInTheDocument()
  })
})