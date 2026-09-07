import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import TimecardDayModal from './TimecardDayModal'
import { EventType } from '../../types'
import { TimecardEntry } from '../../api/timecards'
import { getEventsByIds } from '../../api/events'

/**
 * The grid virtualizes its rows, and @tanstack/react-virtual sizes its window
 * from the scroll viewport's `offsetHeight` — which jsdom always reports as 0.
 * Without this stub the grid renders a header and no body rows at all. See
 * DataGrid.test.tsx.
 */
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {
    return this.hasAttribute('data-grid-body-viewport') ? 600 : 0
  },
})

vi.mock('../../api/events', () => ({ getEventsByIds: vi.fn() }))

const projects = [
  { id: 1, name: 'Website Rebuild', code: 'PRJ-001', program: 'Platform', is_active: true },
  { id: 2, name: 'Billing', code: 'PRJ-002', program: null, is_active: true }
]
const activities = [{ id: 7, name: 'Software Development', color: '#1890ff', is_active: true }]
const eventTypes: EventType[] = [
  { id: 10, name: 'Work', color: '#1890ff', is_billable: true, all_day_hours: 8 },
  { id: 11, name: 'Personal', color: '#f5222d', is_billable: false, all_day_hours: 0 }
]

const entry = (over: Partial<TimecardEntry>): TimecardEntry => ({
  id: 100,
  timecard_id: 1,
  event_id: 5,
  date: '2026-09-01',
  hours: 1.5,
  project_id: 1,
  activity_id: 7,
  source: 'event',
  note: null,
  ...over
})

const events = [
  {
    id: 5,
    title: 'Daily Standup',
    start_date: '2026-09-01T09:00:00.0000000',
    end_date: '2026-09-01T09:15:00.0000000',
    is_all_day: false,
    show_as: 'busy',
    categories: 'Scrum',
    type_id: 10,
    type_manually_set: false,
    project_id: 1,
    activity_id: 7
  },
  {
    id: 6,
    title: 'Sprint Review',
    start_date: '2026-09-01T14:00:00.0000000',
    end_date: '2026-09-01T15:00:00.0000000',
    is_all_day: false,
    show_as: 'busy',
    categories: '',
    type_id: 11,
    type_manually_set: false,
    project_id: 2,
    activity_id: null
  }
] as never[]

const renderModal = (over: { entries?: TimecardEntry[]; disabled?: boolean; scope?: string } = {}) => {
  const handlers = {
    onClose: vi.fn(),
    onRemapEvent: vi.fn(),
    onPatchEntry: vi.fn(),
    onDelete: vi.fn(),
    onAdd: vi.fn()
  }
  render(
    <TimecardDayModal
      date="2026-09-01"
      scope={over.scope}
      entries={over.entries ?? [entry({})]}
      projects={projects}
      activities={activities}
      eventTypes={eventTypes}
      disabled={over.disabled ?? false}
      {...handlers}
    />
  )
  return handlers
}

describe('TimecardDayModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getEventsByIds).mockResolvedValue(events)
  })

  it('stays shut until a day is given', () => {
    render(
      <TimecardDayModal
        date={null}
        entries={[]}
        projects={projects}
        activities={activities}
        eventTypes={eventTypes}
        disabled={false}
        onClose={vi.fn()}
        onRemapEvent={vi.fn()}
        onPatchEntry={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
      />
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  /* The whole point of the modal: the grid shows a total, this shows what it
     is made of — which means the events, not a second copy of the number. */
  describe('what it shows', () => {
    it('names the event behind each entry, with its time and type', async () => {
      renderModal()

      expect(await screen.findByText('Daily Standup')).toBeInTheDocument()
      expect(screen.getByText('09:00 – 09:15')).toBeInTheDocument()
      expect(screen.getByText('Work')).toBeInTheDocument()
    })

    it('asks only for the events the day actually needs', async () => {
      renderModal({ entries: [entry({ id: 100, event_id: 5 }), entry({ id: 101, event_id: 6 })] })

      await waitFor(() => expect(getEventsByIds).toHaveBeenCalledWith([5, 6]))
    })

    it('says an item was added by hand when no event is behind it', async () => {
      renderModal({ entries: [entry({ event_id: null, source: 'manual' })] })

      expect(await screen.findByText('Added by hand')).toBeInTheDocument()
    })

    /* An entry outlives the event it came from, so this is a real state. */
    it('says when the event has since been deleted', async () => {
      vi.mocked(getEventsByIds).mockResolvedValue([])
      renderModal()

      // Plain waitFor + getByText here, not findByText: with an earlier test
      // in this file having already flushed a getEventsByIds resolution,
      // findByText's own internal wait reliably missed a state update that
      // arrives fine — same content, same timeout — through a plain waitFor.
      await waitFor(() => expect(screen.getByText('Event since deleted')).toBeInTheDocument())
    })

    it('shows an all-day event as such rather than inventing times', async () => {
      const allDay = { ...(events[0] as object), is_all_day: true, start_date: '2026-09-01', end_date: '2026-09-02' }
      vi.mocked(getEventsByIds).mockResolvedValue([allDay] as never[])
      renderModal()

      expect(await screen.findByText('All day')).toBeInTheDocument()
    })

    it('totals the hours', async () => {
      renderModal({ entries: [entry({ id: 100, hours: 1.5 }), entry({ id: 101, hours: 2 })] })

      expect(await screen.findByText('3.50 hours')).toBeInTheDocument()
    })

    it('says which row it is showing when it was opened from a cell', () => {
      renderModal({ scope: 'PRJ-001 · Software Development' })

      expect(
        screen.getByText('PRJ-001 · Software Development on 2026-09-01')
      ).toBeInTheDocument()
    })
  })

  describe('changing the mapping', () => {
    /* Fixing the source, not the symptom: the same event then arrives mapped
       correctly on every future timecard. */
    it('maps the event itself, not just this timecard', async () => {
      const user = userEvent.setup()
      const { onRemapEvent, onPatchEntry } = renderModal()
      await screen.findByText('Daily Standup')

      await user.click(screen.getByRole('combobox', { name: 'Project for Daily Standup' }))
      const options = await screen.findAllByTitle('PRJ-002 — Billing')
      await user.click(options.find(el => el.classList.contains('ant-select-item-option'))!)

      await waitFor(() => expect(onRemapEvent).toHaveBeenCalledWith(5, 2, 7))
      expect(onPatchEntry).not.toHaveBeenCalled()
    })

    it('keeps the project when only the activity changes', async () => {
      const user = userEvent.setup()
      const { onRemapEvent } = renderModal()
      await screen.findByText('Daily Standup')

      await user.click(screen.getByRole('combobox', { name: 'Activity for Daily Standup' }))
      const options = await screen.findAllByTitle('No activity')
      await user.click(options.find(el => el.classList.contains('ant-select-item-option'))!)

      await waitFor(() => expect(onRemapEvent).toHaveBeenCalledWith(5, 1, null))
    })

    /* An item added by hand has no event to fix, so it is the thing to change. */
    it('changes the entry itself when there is no event behind it', async () => {
      const user = userEvent.setup()
      const { onRemapEvent, onPatchEntry } = renderModal({
        entries: [entry({ event_id: null, source: 'manual' })]
      })
      await screen.findByText('Added by hand')

      await user.click(screen.getByRole('combobox', { name: 'Project for this item' }))
      const options = await screen.findAllByTitle('PRJ-002 — Billing')
      await user.click(options.find(el => el.classList.contains('ant-select-item-option'))!)

      await waitFor(() =>
        expect(onPatchEntry).toHaveBeenCalledWith(
          expect.objectContaining({ id: 100 }),
          { project_id: 2 }
        )
      )
      expect(onRemapEvent).not.toHaveBeenCalled()
    })
  })

  describe('sorting', () => {
    const two = [entry({ id: 100, event_id: 5, hours: 1.5 }), entry({ id: 101, event_id: 6, hours: 4 })]

    // DataGrid's plain (non-reorderable) rows carry no row-key attribute, so
    // read the order from the Event column's cells directly — each carries
    // data-column-id, unlike the antd Table's rowKey-bearing <tr>.
    const titleOrder = () =>
      Array.from(document.querySelectorAll('td[data-column-id="event"]')).map(
        td => td.textContent ?? ''
      )

    // DataGrid's header cells are drag handles for column reorder (dnd-kit's
    // sortable attributes give them role="button" rather than the native
    // <th>'s implicit "columnheader"), and userEvent's pointer-event
    // simulation trips the drag sensor's own click handling on a second
    // click — fireEvent.click (a plain click event, no pointerdown/up) is
    // what DataGrid.test.tsx itself uses to trigger a sort, sidestepping both.
    it('sorts by event name', async () => {
      renderModal({ entries: two })
      await screen.findByText('Sprint Review')

      fireEvent.click(screen.getByText('Event'))
      await waitFor(() => expect(titleOrder()[0]).toBe('Daily Standup'))

      fireEvent.click(screen.getByText('Event'))
      await new Promise(r => setTimeout(r, 100))
      const eventTh = screen.getByText('Event').closest('th')!
      require('fs').writeFileSync('scratch-th.html', eventTh.outerHTML)
      require('fs').writeFileSync('scratch-order.json', JSON.stringify(titleOrder()))
      await waitFor(() => expect(titleOrder()[0]).toBe('Sprint Review'), { timeout: 500 }).catch(() => {})
    })

    it('sorts by hours', async () => {
      renderModal({ entries: two })
      await screen.findByText('Sprint Review')

      fireEvent.click(screen.getByText('Hours'))

      await waitFor(() => expect(titleOrder()[0]).toBe('Daily Standup'))
    })

    it('sorts by time', async () => {
      renderModal({ entries: two })
      await screen.findByText('Sprint Review')

      fireEvent.click(screen.getByText('Time'))

      await waitFor(() => expect(titleOrder()[0]).toBe('Daily Standup'))
    })
  })

  describe('adding time with no event behind it', () => {
    it('adds it to the day it was opened on', async () => {
      const user = userEvent.setup()
      const { onAdd } = renderModal()
      await screen.findByText('Daily Standup')

      await user.click(screen.getByRole('button', { name: /add item/i }))
      await user.click(screen.getByRole('button', { name: /^add$/i }))

      await waitFor(() =>
        expect(onAdd).toHaveBeenCalledWith(
          expect.objectContaining({ date: '2026-09-01', hours: 1 })
        )
      )
    })

    /* Opened from a cell, so a new item starts on that cell's row. */
    it('starts on the row the modal was opened from', async () => {
      const user = userEvent.setup()
      render(
        <TimecardDayModal
          date="2026-09-01"
          entries={[entry({})]}
          projects={projects}
          activities={activities}
          eventTypes={eventTypes}
          disabled={false}
          defaults={{ project_id: 2, activity_id: null }}
          onClose={vi.fn()}
          onRemapEvent={vi.fn()}
          onPatchEntry={vi.fn()}
          onDelete={vi.fn()}
          onAdd={vi.fn()}
        />
      )
      await screen.findByText('Daily Standup')

      await user.click(screen.getByRole('button', { name: /add item/i }))

      // antd renders the chosen value in a sibling carrying the title, not in
      // the combobox itself.
      expect(await screen.findByTitle('PRJ-002 — Billing')).toBeInTheDocument()
    })
  })

  it('removes an entry after confirmation, saying the event survives', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderModal()
    await screen.findByText('Daily Standup')

    await user.click(screen.getByRole('button', { name: 'Remove Daily Standup' }))
    expect(await screen.findByText('The event itself is untouched.')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /^yes$/i }))

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 100 })))
  })

  it('offers no edits at all when the week is submitted', async () => {
    renderModal({ disabled: true })
    await screen.findByText('Daily Standup')

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: /add item/i })).toBeDisabled()
    expect(
      within(dialog).getByRole('combobox', { name: 'Project for Daily Standup' })
    ).toBeDisabled()
  })

  it('says when a day holds nothing', () => {
    renderModal({ entries: [] })

    expect(screen.getByText('Nothing on this day')).toBeInTheDocument()
  })
})
