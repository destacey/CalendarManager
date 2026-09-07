import { describe, it, expect } from 'vitest'
import { viewRange, rangeBounds } from './viewRange'

describe('viewRange', () => {
  it('gives a day view exactly its day', () => {
    expect(viewRange('2026-09-16', 'day')).toEqual({ start: '2026-09-16', end: '2026-09-16' })
  })

  it('gives a week view its Sunday to Saturday', () => {
    // The 16th is a Wednesday.
    expect(viewRange('2026-09-16', 'week')).toEqual({
      start: '2026-09-13',
      end: '2026-09-19'
    })
  })

  it('leaves a Sunday as the start of its own week', () => {
    expect(viewRange('2026-09-13', 'week').start).toBe('2026-09-13')
  })

  /* The month grid fills its first and last rows with the days either side.
     Without them those cells would be empty, which reads as missing data
     rather than as another month. */
  it('pads a month view out to whole weeks', () => {
    // September 2026 starts on a Tuesday and ends on a Wednesday.
    expect(viewRange('2026-09-16', 'month')).toEqual({
      start: '2026-08-30',
      end: '2026-10-03'
    })
  })

  it('pads nothing when the month already starts and ends on week boundaries', () => {
    // November 2026: Sunday the 1st through Monday the 30th.
    const range = viewRange('2026-11-15', 'month')

    expect(range.start).toBe('2026-11-01')
    expect(range.end).toBe('2026-12-05')
  })

  /* The table lists a month, and has no grid to fill. */
  it('gives the table view the calendar month alone', () => {
    expect(viewRange('2026-09-16', 'table')).toEqual({
      start: '2026-09-01',
      end: '2026-09-30'
    })
  })

  it('handles February in a leap year', () => {
    expect(viewRange('2028-02-10', 'table')).toEqual({
      start: '2028-02-01',
      end: '2028-02-29'
    })
  })

  it('crosses a year end', () => {
    expect(viewRange('2026-12-31', 'month').end.startsWith('2027-01')).toBe(true)
  })

  it('reads a full datetime as the day it falls on', () => {
    expect(viewRange('2026-09-16T14:30:00', 'day').start).toBe('2026-09-16')
  })
})

describe('rangeBounds', () => {
  /* The query compares against stored datetimes, so the last day has to run
     to its end or everything after midnight on it is missed. */
  it('covers the whole of the last day', () => {
    expect(rangeBounds({ start: '2026-09-01', end: '2026-09-30' })).toEqual({
      start: '2026-09-01T00:00:00',
      end: '2026-09-30T23:59:59'
    })
  })
})
