import { describe, it, expect } from 'vitest'
import { dateKeyOf, groupEventsByDate } from './eventsByDate'
import { Event } from '../types'

const LA = 'America/Los_Angeles'

const event = (over: Partial<Event>): Event =>
  ({
    id: 1,
    title: 'Meeting',
    start_date: '2026-09-01T16:00:00.0000000',
    end_date: '2026-09-01T17:00:00.0000000',
    is_all_day: false,
    show_as: 'busy',
    categories: '',
    type_id: 1,
    type_manually_set: false,
    ...over
  }) as Event

describe('dateKeyOf', () => {
  /* The format Graph actually sends, seven fractional digits and no zone
     marker — the app stores it verbatim and treats it as UTC. */
  it('reads Graph datetimes as UTC', () => {
    expect(dateKeyOf('2026-09-01T16:00:00.0000000', 'UTC')).toBe('2026-09-01')
  })

  it('gives the day in the timezone asked for, not UTC', () => {
    // 03:00 UTC on the 2nd is still the evening of the 1st in Los Angeles.
    expect(dateKeyOf('2026-09-02T03:00:00.0000000', LA)).toBe('2026-09-01')
    expect(dateKeyOf('2026-09-02T03:00:00.0000000', 'UTC')).toBe('2026-09-02')
  })

  it('handles a zone where the day is already ahead', () => {
    expect(dateKeyOf('2026-09-01T20:00:00.0000000', 'Asia/Tokyo')).toBe('2026-09-02')
  })

  it('returns a bare date unchanged', () => {
    expect(dateKeyOf('2026-09-01', LA)).toBe('2026-09-01')
  })

  it('refuses something it cannot read rather than guessing', () => {
    expect(dateKeyOf('not a date at all', LA)).toBeNull()
    expect(dateKeyOf('', LA)).toBeNull()
  })
})

describe('groupEventsByDate', () => {
  it('puts a timed event on its own day', () => {
    const map = groupEventsByDate([event({ id: 1 })], 'UTC')

    expect(map.get('2026-09-01')).toHaveLength(1)
    expect(map.size).toBe(1)
  })

  /* An all-day event carries calendar dates, not instants: no timezone
     applies, or a morning in Tokyo would move someone's day off. */
  it('leaves an all-day event on the date it names, whatever the timezone', () => {
    const allDay = event({
      is_all_day: true,
      start_date: '2026-09-01',
      end_date: '2026-09-02'
    })

    for (const zone of ['UTC', LA, 'Asia/Tokyo']) {
      const map = groupEventsByDate([allDay], zone)
      expect([...map.keys()]).toEqual(['2026-09-01'])
    }
  })

  /* Graph's all-day end is exclusive: Mon → Thu is three days off, not four. */
  it('drops the exclusive end day of a multi-day all-day event', () => {
    const map = groupEventsByDate(
      [event({ is_all_day: true, start_date: '2026-09-01', end_date: '2026-09-04' })],
      'UTC'
    )

    expect([...map.keys()]).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
  })

  it('puts a timed event that runs past midnight on both days', () => {
    const map = groupEventsByDate(
      [
        event({
          start_date: '2026-09-01T23:00:00.0000000',
          end_date: '2026-09-02T01:00:00.0000000'
        })
      ],
      'UTC'
    )

    expect([...map.keys()]).toEqual(['2026-09-01', '2026-09-02'])
  })

  it('keeps an event with no end on its starting day', () => {
    const map = groupEventsByDate([event({ end_date: undefined })], 'UTC')

    expect(map.get('2026-09-01')).toHaveLength(1)
  })

  /* Rather than vanishing, or looping forever. */
  it('keeps an event whose end is before its start on the starting day', () => {
    const map = groupEventsByDate(
      [
        event({
          start_date: '2026-09-05T10:00:00.0000000',
          end_date: '2026-09-01T10:00:00.0000000'
        })
      ],
      'UTC'
    )

    expect([...map.keys()]).toEqual(['2026-09-05'])
  })

  it('skips an all-day event whose date cannot be read', () => {
    const map = groupEventsByDate(
      [event({ is_all_day: true, start_date: 'rubbish', end_date: 'rubbish' })],
      'UTC'
    )

    expect(map.size).toBe(0)
  })

  it('skips an event whose start cannot be read rather than failing the load', () => {
    const map = groupEventsByDate([event({ start_date: 'rubbish' }), event({ id: 2 })], 'UTC')

    expect(map.size).toBe(1)
    expect(map.get('2026-09-01')).toHaveLength(1)
  })

  describe('order within a day', () => {
    it('puts all-day events first', () => {
      const map = groupEventsByDate(
        [
          event({ id: 1, start_date: '2026-09-01T09:00:00.0000000' }),
          event({ id: 2, is_all_day: true, start_date: '2026-09-01', end_date: '2026-09-02' })
        ],
        'UTC'
      )

      // 2 is the all-day one.
      expect(map.get('2026-09-01')!.map(e => e.id)).toEqual([2, 1])
    })

    it('sorts the rest by start time', () => {
      const map = groupEventsByDate(
        [
          event({ id: 1, start_date: '2026-09-01T17:00:00.0000000' }),
          event({ id: 2, start_date: '2026-09-01T09:00:00.0000000' })
        ],
        'UTC'
      )

      // 2 is the earlier one.
      expect(map.get('2026-09-01')!.map(e => e.id)).toEqual([2, 1])
    })
  })
})
