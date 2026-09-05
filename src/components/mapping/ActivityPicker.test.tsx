import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import ActivityPicker from './ActivityPicker'
import { mapEvents } from '../../api/mapping'

vi.mock('../../api/mapping', () => ({ mapEvents: vi.fn() }))

const project = { id: 1, name: 'Website Rebuild', code: 'PRJ-001', program: 'Platform', is_active: true }

const groups = [
  { key: 'a', title: 'Daily Standup', categories: 'Scrum', typeName: 'Work', eventCount: 23, timedMinutes: 690, allDayCount: 0, eventIds: [1, 2, 3] },
  { key: 'b', title: 'Sprint Planning', categories: 'Scrum', typeName: 'Work', eventCount: 5, timedMinutes: 600, allDayCount: 0, eventIds: [4, 5] }
]

const activities = [
  { id: 5, name: 'Software Development', color: '#1890ff', is_active: true },
  { id: 7, name: 'Architecture', color: '#2f54eb', is_active: true }
]

const renderPicker = (overrides = {}) => {
  const onDone = vi.fn()
  const onCancel = vi.fn()
  render(
    <ActivityPicker
      project={project}
      groups={groups}
      activities={activities}
      onDone={onDone}
      onCancel={onCancel}
      {...overrides}
    />
  )
  return { onDone, onCancel }
}

describe('ActivityPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mapEvents).mockResolvedValue(28)
  })

  /* "Project only" is a real answer and often the right one, so it sits first
     rather than buried under the activities. */
  it('offers Project only before any activity', () => {
    renderPicker()

    const options = screen.getAllByRole('menuitem')
    expect(options[0]).toHaveTextContent('Project only, no activity')
    expect(options[1]).toHaveTextContent('Software Development')
  })

  /* One click finishes it — there is no confirm step. */
  it('maps every event across every dropped group on one click', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByText('Software Development'))

    await waitFor(() => {
      expect(mapEvents).toHaveBeenCalledWith([1, 2, 3, 4, 5], 1, 5)
    })
  })

  it('sends a null activity for Project only', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByText('Project only, no activity'))

    await waitFor(() => {
      expect(mapEvents).toHaveBeenCalledWith([1, 2, 3, 4, 5], 1, null)
    })
  })

  it('names the project and activity in the confirmation', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByText('Architecture'))

    await waitFor(() => {
      expect(
        screen.getByText('28 events mapped to Website Rebuild · Architecture')
      ).toBeInTheDocument()
    })
  })

  it('omits the activity from the confirmation when there is none', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByText('Project only, no activity'))

    await waitFor(() => {
      expect(screen.getByText('28 events mapped to Website Rebuild')).toBeInTheDocument()
    })
  })

  it('tells the caller it is done so the queue can reload', async () => {
    const user = userEvent.setup()
    const { onDone } = renderPicker()

    await user.click(screen.getByText('Software Development'))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
  })

  it('reports a failure rather than pretending it worked', async () => {
    const user = userEvent.setup()
    vi.mocked(mapEvents).mockRejectedValue(new Error('boom'))
    const { onDone } = renderPicker()

    await user.click(screen.getByText('Software Development'))

    await waitFor(() => {
      expect(screen.getByText('Failed to map events')).toBeInTheDocument()
    })
    expect(onDone).not.toHaveBeenCalled()
  })

  /* Double-clicking an option must not map the same events twice. */
  it('ignores a second click while the first is still in flight', async () => {
    const user = userEvent.setup()
    renderPicker()

    const option = screen.getByText('Software Development')
    await user.click(option)
    await user.click(option)

    await waitFor(() => expect(mapEvents).toHaveBeenCalledTimes(1))
  })

  /* Anchoring the picker to the drop point put it partly off-screen when the
     project was low in the viewport, with no way to reach the rest. */
  it('names the project and event count, since it no longer opens beside it', () => {
    renderPicker()

    expect(screen.getByText('28 events → Website Rebuild')).toBeInTheDocument()
  })

  it('cancels on Escape', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderPicker()

    await user.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalled()
    expect(mapEvents).not.toHaveBeenCalled()
  })

  /* Clicking the menu must not reach the scrim behind it, or choosing an
     activity would cancel at the same time. */
  it('does not cancel when the menu itself is clicked', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderPicker()

    await user.click(screen.getByRole('menu', { name: /choose an activity/i }))

    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels without mapping when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderPicker()

    await user.click(screen.getByTestId('picker-scrim'))

    expect(onCancel).toHaveBeenCalled()
    expect(mapEvents).not.toHaveBeenCalled()
  })

  /* The options are reachable without a mouse, which matters because the drag
     that opens this can also be driven from the keyboard. */
  it('picks an activity with the keyboard', async () => {
    renderPicker()

    screen.getByText('Software Development').closest('[role="menuitem"]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )

    await waitFor(() => expect(mapEvents).toHaveBeenCalled())
  })
})
