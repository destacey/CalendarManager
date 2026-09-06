import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/utils'
import TimecardDayModal from './TimecardDayModal'
import { TimecardEntry } from '../../api/timecards'

const projects = [
  { id: 1, name: 'Website Rebuild', code: 'PRJ-001', program: 'Platform', is_active: true },
  { id: 2, name: 'Billing', code: 'PRJ-002', program: null, is_active: true }
]
const activities = [{ id: 7, name: 'Software Development', color: '#1890ff', is_active: true }]

const entry = (over: Partial<TimecardEntry>): TimecardEntry => ({
  id: 1,
  timecard_id: 1,
  event_id: 5,
  date: '2026-09-01',
  hours: 2,
  project_id: 1,
  activity_id: 7,
  source: 'event',
  note: null,
  ...over
})

const renderModal = (over: {
  date?: string | null
  entries?: TimecardEntry[]
  disabled?: boolean
} = {}) => {
  const handlers = {
    onClose: vi.fn(),
    onPatch: vi.fn(),
    onDelete: vi.fn(),
    onAdd: vi.fn()
  }
  render(
    <TimecardDayModal
      date={over.date === undefined ? '2026-09-01' : over.date}
      entries={over.entries ?? [entry({})]}
      projects={projects}
      activities={activities}
      disabled={over.disabled ?? false}
      {...handlers}
    />
  )
  return handlers
}

describe('TimecardDayModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stays shut until a day is given', () => {
    renderModal({ date: null })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('lists the day and what it adds up to', () => {
    renderModal({ entries: [entry({ id: 1, hours: 2 }), entry({ id: 2, hours: 1.5 })] })

    expect(screen.getByText('Items on 2026-09-01')).toBeInTheDocument()
    expect(screen.getByText('3.50 hours')).toBeInTheDocument()
  })

  /* The point of the modal: the grid shows a sum, this shows what made it. */
  it('shows each item with its note and where it came from', () => {
    renderModal({
      entries: [
        entry({ id: 1 }),
        entry({ id: 2, source: 'manual', event_id: null, note: 'Called the vendor' })
      ]
    })

    expect(screen.getByText('From event')).toBeInTheDocument()
    expect(screen.getByText('Yours')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Called the vendor')).toBeInTheDocument()
  })

  it('marks an item whose event a sync has since deleted', () => {
    renderModal({ entries: [entry({ event_id: null })] })

    expect(screen.getByText('Event (deleted)')).toBeInTheDocument()
  })

  /* Typing over a cell is the one edit that also keeps events out of it, so
     the modal has to say so rather than leave a refresh looking broken. */
  it('explains a cell that was typed in', () => {
    renderModal({ entries: [entry({ source: 'cell' })] })

    expect(screen.getByText('Typed in')).toBeInTheDocument()
    expect(
      screen.getByText(/a refresh will not add event time to it/i)
    ).toBeInTheDocument()
  })

  it('says nothing about refreshes when nothing was typed in', () => {
    renderModal()

    expect(screen.queryByText(/will not add event time/i)).not.toBeInTheDocument()
  })

  describe('adding an item', () => {
    it('adds it to the day it was opened on', async () => {
      const user = userEvent.setup()
      const { onAdd } = renderModal()

      await user.click(screen.getByRole('button', { name: /add item/i }))
      await user.click(screen.getByRole('combobox', { name: 'Project for the new item' }))
      await user.click(await screen.findByTitle('PRJ-002 — Billing'))
      await user.click(screen.getByRole('button', { name: /^add$/i }))

      await waitFor(() =>
        expect(onAdd).toHaveBeenCalledWith({
          date: '2026-09-01',
          hours: 1,
          project_id: 2,
          activity_id: null,
          note: null
        })
      )
    })

    it('can be abandoned', async () => {
      const user = userEvent.setup()
      const { onAdd } = renderModal()

      await user.click(screen.getByRole('button', { name: /add item/i }))
      await user.click(screen.getByRole('button', { name: /^cancel$/i }))

      expect(onAdd).not.toHaveBeenCalled()
      expect(
        screen.queryByRole('combobox', { name: 'Project for the new item' })
      ).not.toBeInTheDocument()
    })
  })

  it('edits an item in place', async () => {
    const user = userEvent.setup()
    const { onPatch } = renderModal()

    const note = screen.getByRole('textbox', { name: 'Note on 2026-09-01' })
    await user.type(note, 'Ran long')
    await user.tab()

    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), {
        note: 'Ran long'
      })
    )
  })

  it('deletes an item after confirmation', async () => {
    const user = userEvent.setup()
    const { onDelete } = renderModal()

    await user.click(screen.getByRole('button', { name: 'Delete entry on 2026-09-01' }))
    await user.click(await screen.findByRole('button', { name: /^yes$/i }))

    await waitFor(() =>
      expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
    )
  })

  it('says when a day holds nothing', () => {
    renderModal({ entries: [] })

    expect(screen.getByText('Nothing on this day')).toBeInTheDocument()
  })

  it('offers no edits at all when the timecard is submitted', () => {
    renderModal({ disabled: true })

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: /add item/i })).toBeDisabled()
    expect(within(dialog).getByRole('spinbutton', { name: 'Hours on 2026-09-01' })).toBeDisabled()
  })
})
