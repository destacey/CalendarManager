import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import WorkingDaysSettings from './WorkingDaysSettings'
import { storageService } from '../../services/storage'

vi.mock('../../services/storage', () => ({
  storageService: {
    getWorkingDays: vi.fn(),
    setWorkingDays: vi.fn(),
    getWorkdayStart: vi.fn(),
    setWorkdayStart: vi.fn()
  }
}))

describe('WorkingDaysSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(storageService.getWorkingDays).mockResolvedValue([1, 2, 3, 4, 5])
    vi.mocked(storageService.getWorkdayStart).mockResolvedValue('08:00')
    vi.mocked(storageService.setWorkingDays).mockResolvedValue(undefined)
    vi.mocked(storageService.setWorkdayStart).mockResolvedValue(undefined)
  })

  it('shows Monday to Friday ticked by default', async () => {
    render(<WorkingDaysSettings />)

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Mon' })).toBeChecked()
    })
    expect(screen.getByRole('checkbox', { name: 'Fri' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Sat' })).not.toBeChecked()
  })

  it('saves a day being added', async () => {
    const user = userEvent.setup()
    render(<WorkingDaysSettings />)
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Mon' })).toBeChecked())

    await user.click(screen.getByRole('checkbox', { name: 'Sat' }))

    await waitFor(() => {
      expect(storageService.setWorkingDays).toHaveBeenCalledWith([1, 2, 3, 4, 5, 6])
    })
  })

  it('saves a day being removed', async () => {
    const user = userEvent.setup()
    render(<WorkingDaysSettings />)
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Fri' })).toBeChecked())

    await user.click(screen.getByRole('checkbox', { name: 'Fri' }))

    await waitFor(() => {
      expect(storageService.setWorkingDays).toHaveBeenCalledWith([1, 2, 3, 4])
    })
  })

  /* An empty week would make every multi-day all-day event worth nothing,
     which is never what someone means by unticking the last day. */
  it('refuses to save an empty week', async () => {
    const user = userEvent.setup()
    vi.mocked(storageService.getWorkingDays).mockResolvedValue([1])
    render(<WorkingDaysSettings />)
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Mon' })).toBeChecked())

    await user.click(screen.getByRole('checkbox', { name: 'Mon' }))

    await waitFor(() => {
      expect(screen.getByText('At least one working day is needed')).toBeInTheDocument()
    })
    expect(storageService.setWorkingDays).not.toHaveBeenCalled()
  })

  it('keeps the day ticked when the change was refused', async () => {
    const user = userEvent.setup()
    vi.mocked(storageService.getWorkingDays).mockResolvedValue([1])
    render(<WorkingDaysSettings />)
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Mon' })).toBeChecked())

    await user.click(screen.getByRole('checkbox', { name: 'Mon' }))

    expect(screen.getByRole('checkbox', { name: 'Mon' })).toBeChecked()
  })

  it('loads the stored start time', async () => {
    vi.mocked(storageService.getWorkdayStart).mockResolvedValue('09:30')
    render(<WorkingDaysSettings />)

    await waitFor(() => expect(screen.getByTitle('09:30')).toBeInTheDocument())
  })

  /* Says what it does NOT do, because "working days" reads like a global
     filter and it deliberately is not one. */
  it('explains that work on a non-working day still counts', async () => {
    render(<WorkingDaysSettings />)

    await waitFor(() => {
      expect(
        screen.getByText(/Work on a non-working day still counts/)
      ).toBeInTheDocument()
    })
  })

  it('hides itself when the settings search does not match', () => {
    render(<WorkingDaysSettings searchTerm="microsoft graph" />)

    expect(screen.queryByText('Working days')).not.toBeInTheDocument()
  })

  it('shows itself when the search matches', async () => {
    render(<WorkingDaysSettings searchTerm="hours" />)

    await waitFor(() => expect(screen.getByText('Working days')).toBeInTheDocument())
  })
})
