import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { storageService } from './services/storage'
import { authService } from './services/auth'

/* Every screen is stubbed. What is under test is which of them App decides to
   build, and when — not what they render. CalendarView in particular cannot
   render in any test (the global dayjs mock), which is the other reason. */
vi.mock('./components/calendar/CalendarView', () => ({
  default: () => <div>calendar screen</div>
}))
vi.mock('./components/mapping/MapEvents', () => ({
  default: () => <div>map events screen</div>
}))
vi.mock('./components/timecards/Timecards', () => ({
  default: () => <div>timecards screen</div>
}))
vi.mock('./components/settings/Settings', () => ({
  default: () => <div>settings screen</div>
}))
vi.mock('./components/TitleBar', () => ({
  default: () => <div>title bar</div>
}))

vi.mock('./services/storage', () => ({
  storageService: {
    getAppRegistrationId: vi.fn(),
    setAppRegistrationId: vi.fn()
  }
}))
vi.mock('./services/auth', () => ({
  authService: { isLoggedIn: vi.fn() }
}))

/* `src/test/setup.ts` answers every media query with `matches: false`, which
   antd reads as a screen narrower than its smallest breakpoint — so App picks
   its mobile navigation and the sider, which these tests click, never renders.
   A desktop-width answer puts it back. */
beforeEach(() => {
  // Redefined rather than assigned: setup.ts installed it as a read-only
  // property, so a plain assignment throws.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: !query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })
})

const openDashboard = async () => {
  render(<App />)
  await waitFor(() => expect(screen.getByText(/welcome to calendar manager/i)).toBeInTheDocument())
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(storageService.getAppRegistrationId).mockResolvedValue('client-id')
    vi.mocked(authService.isLoggedIn).mockResolvedValue(true)
  })

  describe('which screens exist', () => {
    /* All five used to mount at startup, so sitting on Home still meant
       loading every event, grouping them for Map Events and filling the
       settings tables — before anything had been asked for. */
    it('builds nothing but Home until something else is asked for', async () => {
      await openDashboard()

      expect(screen.queryByText('calendar screen')).not.toBeInTheDocument()
      expect(screen.queryByText('map events screen')).not.toBeInTheDocument()
      expect(screen.queryByText('timecards screen')).not.toBeInTheDocument()
      expect(screen.queryByText('settings screen')).not.toBeInTheDocument()
    })

    it('builds a screen the first time it is opened', async () => {
      const user = userEvent.setup()
      await openDashboard()

      await user.click(screen.getByRole('menuitem', { name: /timecards/i }))

      expect(await screen.findByText('timecards screen')).toBeInTheDocument()
      // And still nothing that has not been asked for.
      expect(screen.queryByText('map events screen')).not.toBeInTheDocument()
    })

    /* Kept mounted, not unmounted, so a screen holds its state — the reason
       they are hidden with `display: none` rather than swapped out. */
    it('keeps a screen once built, hidden rather than discarded', async () => {
      const user = userEvent.setup()
      await openDashboard()

      await user.click(screen.getByRole('menuitem', { name: /timecards/i }))
      await screen.findByText('timecards screen')
      await user.click(screen.getByRole('menuitem', { name: /home/i }))

      const timecards = screen.getByText('timecards screen')
      expect(timecards).toBeInTheDocument()
      // The inline style, not the computed one: setup.ts stubs
      // getComputedStyle, so toHaveStyle sees nothing whatever is set.
      expect(timecards.closest('div[style]')).toHaveAttribute(
        'style',
        expect.stringContaining('display: none')
      )
    })

    it('shows the screen that is selected', async () => {
      const user = userEvent.setup()
      await openDashboard()

      await user.click(screen.getByRole('menuitem', { name: /map events/i }))

      const mapEvents = await screen.findByText('map events screen')
      expect(mapEvents.closest('div[style]')).toHaveAttribute(
        'style',
        expect.stringContaining('display: block')
      )
    })
  })

  describe('before the dashboard', () => {
    it('asks for an app registration when there is none', async () => {
      vi.mocked(storageService.getAppRegistrationId).mockResolvedValue(null)
      render(<App />)

      await waitFor(() =>
        expect(screen.queryByText(/welcome to calendar manager/i)).not.toBeInTheDocument()
      )
      expect(authService.isLoggedIn).not.toHaveBeenCalled()
    })

    it('asks for a login when the stored session cannot be restored', async () => {
      vi.mocked(authService.isLoggedIn).mockResolvedValue(false)
      render(<App />)

      await waitFor(() => expect(authService.isLoggedIn).toHaveBeenCalled())
      expect(screen.queryByText(/welcome to calendar manager/i)).not.toBeInTheDocument()
    })
  })
})
