import { describe, it, expect } from 'vitest'
import {
  allDayCalendarDays,
  allDayWorkingDays,
  expandAllDayEvent,
  allDayEventHours,
  DEFAULT_ALL_DAY_SETTINGS,
  type AllDaySettings
} from './allDayHours'

/* October 2026: the 5th is a Monday, so the 10th is a Saturday and the 11th a
   Sunday. Every fixture below leans on that. */
const MON = '2026-10-05T00:00:00'
const SAT = '2026-10-10T00:00:00'
const SUN = '2026-10-11T00:00:00'

const settings = (overrides: Partial<AllDaySettings> = {}): AllDaySettings => ({
  ...DEFAULT_ALL_DAY_SETTINGS,
  ...overrides
})

describe('allDayCalendarDays', () => {
  /* Graph gives an all-day event an EXCLUSIVE end, so one Monday off is
     Monday -> Tuesday. Counting that as two days is the classic mistake. */
  it('treats a single day as one day, not two', () => {
    expect(allDayCalendarDays(MON, '2026-10-06T00:00:00')).toEqual(['2026-10-05'])
  })

  it('covers every day of a working week', () => {
    expect(allDayCalendarDays(MON, '2026-10-10T00:00:00')).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09'
    ])
  })

  it('includes the weekend when the span crosses it', () => {
    expect(allDayCalendarDays(MON, '2026-10-12T00:00:00')).toHaveLength(7)
  })

  /* A malformed row should cost its own hours, not the whole month's. */
  it('falls back to a single day when the end is missing or unusable', () => {
    expect(allDayCalendarDays(MON, null)).toEqual(['2026-10-05'])
    expect(allDayCalendarDays(MON, 'not-a-date')).toEqual(['2026-10-05'])
  })

  it('returns nothing for an unparseable start', () => {
    expect(allDayCalendarDays('rubbish', null)).toEqual([])
  })
})

describe('allDayWorkingDays', () => {
  it('drops the weekend from a Monday-to-Sunday block', () => {
    const days = allDayWorkingDays(MON, '2026-10-12T00:00:00', settings())

    expect(days).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09'
    ])
  })

  /* Booking one Saturday off is deliberate. Filtering it away would make the
     event vanish from a timesheet it belongs in. */
  it('never filters a single-day event, even on a non-working day', () => {
    expect(allDayWorkingDays(SAT, '2026-10-11T00:00:00', settings())).toEqual(['2026-10-10'])
  })

  /* The boundary we agreed: a span with no working days at all is as
     deliberate as a single Saturday, so it keeps every day rather than
     silently disappearing. */
  it('keeps every day when a multi-day span has no working days', () => {
    expect(allDayWorkingDays(SAT, '2026-10-12T00:00:00', settings())).toEqual([
      '2026-10-10',
      '2026-10-11'
    ])
  })

  it('honours a different working week', () => {
    // Sunday to Thursday.
    const days = allDayWorkingDays(SUN, '2026-10-17T00:00:00', settings({ workingDays: [0, 1, 2, 3, 4] }))

    expect(days).toEqual([
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15'
    ])
  })

  it('honours a four-day week', () => {
    const days = allDayWorkingDays(MON, '2026-10-10T00:00:00', settings({ workingDays: [1, 2, 3, 4] }))

    expect(days).toHaveLength(4)
    expect(days).not.toContain('2026-10-09')
  })
})

describe('expandAllDayEvent', () => {
  it('gives each working day the type-s hours', () => {
    const entries = expandAllDayEvent(MON, '2026-10-12T00:00:00', 8, settings())

    expect(entries).toHaveLength(5)
    expect(entries.every(e => e.hours === 8)).toBe(true)
  })

  it('starts each day at the configured workday start', () => {
    const [first] = expandAllDayEvent(MON, '2026-10-06T00:00:00', 8, settings())

    expect(first.start).toBe('2026-10-05T08:00:00')
    expect(first.end).toBe('2026-10-05T16:00:00')
  })

  it('honours a different workday start', () => {
    const [first] = expandAllDayEvent(MON, '2026-10-06T00:00:00', 7.5, settings({ workdayStart: '09:30' }))

    expect(first.start).toBe('2026-10-05T09:30:00')
    expect(first.end).toBe('2026-10-05T17:00:00')
  })

  /* Zero is meaningful - it is how a Birthday or Holiday type opts out - so
     the entries still exist and simply carry no time. The event stays visible
     wherever it is listed. */
  it('still produces days for a type worth zero hours', () => {
    const entries = expandAllDayEvent(MON, '2026-10-12T00:00:00', 0, settings())

    expect(entries).toHaveLength(5)
    expect(entries.every(e => e.hours === 0)).toBe(true)
  })

  /* An end past midnight would read as earlier than its start. */
  it('clamps a day that would run past midnight', () => {
    const [first] = expandAllDayEvent(MON, '2026-10-06T00:00:00', 20, settings())

    expect(first.end).toBe('2026-10-05T23:59:00')
  })
})

describe('allDayEventHours', () => {
  /* The bug this whole thing exists to fix: the billable footer valued an
     all-day day at 1440 minutes, so this block counted as 120 hours. */
  it('values a working week at 40 hours, not 120', () => {
    expect(allDayEventHours(MON, '2026-10-10T00:00:00', 8, settings())).toBe(40)
  })

  it('values a Monday-to-Sunday block at 40 hours too', () => {
    expect(allDayEventHours(MON, '2026-10-12T00:00:00', 8, settings())).toBe(40)
  })

  it('values one day off at the type-s hours', () => {
    expect(allDayEventHours(MON, '2026-10-06T00:00:00', 8, settings())).toBe(8)
  })

  it('values a weekend-only block by its own days', () => {
    expect(allDayEventHours(SAT, '2026-10-12T00:00:00', 8, settings())).toBe(16)
  })

  it('values a type worth zero hours at nothing', () => {
    expect(allDayEventHours(MON, '2026-10-12T00:00:00', 0, settings())).toBe(0)
  })
})
