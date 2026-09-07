import { describe, it, expect } from 'vitest'
import {
  totalsByProjectActivity,
  weeksOf,
  weekOf,
  monthBounds,
  weekBoundsOf,
  isInMonth,
  buildRows,
  columnTotals,
  rowKey,
  isOwned
} from './timecardGrid'
import { TimecardEntry } from '../api/timecards'

const entry = (over: Partial<TimecardEntry>): TimecardEntry => ({
  id: 1,
  timecard_id: 1,
  event_id: null,
  date: '2026-10-05',
  hours: 1,
  project_id: 1,
  activity_id: null,
  source: 'event',
  note: null,
  ...over
})

describe('weeksOf', () => {
  /* The case that prompted the design: September 2026 starts on a Tuesday. */
  it('pads the first week back to Sunday with days from the month before', () => {
    const weeks = weeksOf('2026-09-01', '2026-09-30')

    expect(weeks[0].days.map(d => d.date)).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05'
    ])
    expect(weeks[0].days[0].inPeriod).toBe(false)
    expect(weeks[0].days[1].inPeriod).toBe(false)
    expect(weeks[0].days[2].inPeriod).toBe(true)
  })

  it('pads the last week forward into the month after', () => {
    const weeks = weeksOf('2026-09-01', '2026-09-30')
    const last = weeks[weeks.length - 1]

    expect(last.days.map(d => d.date)).toEqual([
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03'
    ])
    expect(last.days.filter(d => d.inPeriod)).toHaveLength(4)
  })

  it('covers the month in whole weeks, numbered from one', () => {
    const weeks = weeksOf('2026-09-01', '2026-09-30')

    expect(weeks).toHaveLength(5)
    expect(weeks.map(w => w.number)).toEqual([1, 2, 3, 4, 5])
    expect(weeks.every(w => w.days.length === 7)).toBe(true)
  })

  /* A period already starting on a Sunday must not gain a phantom week. */
  it('borrows nothing when the period starts on a Sunday', () => {
    const weeks = weeksOf('2026-11-01', '2026-11-30')

    expect(weeks[0].days[0].date).toBe('2026-11-01')
    expect(weeks[0].days.every(d => d.inPeriod)).toBe(true)
  })

  it('reports the first and last day of each week that count', () => {
    const [first] = weeksOf('2026-09-01', '2026-09-30')

    expect(first.firstInPeriod).toBe('2026-09-01')
    expect(first.lastInPeriod).toBe('2026-09-05')
  })

  it('handles a period shorter than a week', () => {
    const weeks = weeksOf('2026-09-02', '2026-09-03')

    expect(weeks).toHaveLength(1)
    expect(weeks[0].days.filter(d => d.inPeriod).map(d => d.date)).toEqual([
      '2026-09-02',
      '2026-09-03'
    ])
  })

  it('returns nothing for a period that ends before it starts', () => {
    expect(weeksOf('2026-09-10', '2026-09-01')).toEqual([])
  })

  it('crosses a year boundary', () => {
    const weeks = weeksOf('2026-12-01', '2026-12-31')

    expect(weeks[weeks.length - 1].days.some(d => d.date.startsWith('2027-01'))).toBe(true)
  })
})

describe('monthBounds', () => {
  it('gives the first and last day of a 31-day month', () => {
    expect(monthBounds('2026-10')).toEqual({
      start: '2026-10-01', end: '2026-10-31', name: 'October 2026'
    })
  })

  it('gives 30 days for a 30-day month', () => {
    expect(monthBounds('2026-11')?.end).toBe('2026-11-30')
  })

  /* Day 0 of the next month, rather than a table of month lengths - which is
     what makes February and leap years fall out for free. */
  it('handles February', () => {
    expect(monthBounds('2026-02')?.end).toBe('2026-02-28')
  })

  it('handles a leap February', () => {
    expect(monthBounds('2028-02')?.end).toBe('2028-02-29')
  })

  it('rejects anything that is not YYYY-MM', () => {
    expect(monthBounds('October')).toBeNull()
    expect(monthBounds('2026-13')).toBeNull()
    expect(monthBounds('')).toBeNull()
  })
})

describe('weekBoundsOf', () => {
  it('finds the Sunday-to-Saturday week holding a date', () => {
    expect(weekBoundsOf('2026-09-03')).toEqual({
      start: '2026-08-30',
      end: '2026-09-05',
      name: 'Week of 30 Aug 2026'
    })
  })

  it('leaves a Sunday where it is', () => {
    expect(weekBoundsOf('2026-08-30').start).toBe('2026-08-30')
  })
})

describe('isInMonth', () => {
  it('is what decides which month a day counts towards', () => {
    expect(isInMonth('2026-09-01', '2026-09')).toBe(true)
    expect(isInMonth('2026-08-31', '2026-09')).toBe(false)
  })
})

describe('weekOf', () => {
  const weeks = weeksOf('2026-09-01', '2026-09-30')

  it('finds the week holding a date', () => {
    expect(weekOf(weeks, '2026-09-16')?.number).toBe(3)
  })

  /* A borrowed day belongs to the neighbouring month, not to this week. */
  it('falls back to the first week for a date outside the period', () => {
    expect(weekOf(weeks, '2026-08-30')?.number).toBe(1)
    expect(weekOf(weeks, '2027-05-05')?.number).toBe(1)
  })
})

describe('buildRows', () => {
  const dates = ['2026-10-05', '2026-10-06', '2026-10-07']

  it('makes one row per project and activity pair', () => {
    const rows = buildRows(
      [
        entry({ id: 1, project_id: 1, activity_id: 7 }),
        entry({ id: 2, project_id: 1, activity_id: 8 }),
        entry({ id: 3, project_id: 2, activity_id: 7 })
      ],
      dates
    )

    expect(rows).toHaveLength(3)
    expect(rows.map(r => r.key).sort()).toEqual(['1:7', '1:8', '2:7'])
  })

  it('sums several entries into one cell and counts them', () => {
    const rows = buildRows(
      [
        entry({ id: 1, hours: 1.5 }),
        entry({ id: 2, hours: 0.5 }),
        entry({ id: 3, hours: 1, date: '2026-10-06' })
      ],
      dates
    )

    expect(rows[0].cells['2026-10-05']).toEqual({ hours: 2, entries: 2, owned: false })
    expect(rows[0].cells['2026-10-06'].hours).toBe(1)
    expect(rows[0].total).toBe(3)
  })

  it('marks a cell as the users once anything in it is theirs', () => {
    const rows = buildRows(
      [entry({ id: 1 }), entry({ id: 2, source: 'cell' })],
      dates
    )

    expect(rows[0].cells['2026-10-05'].owned).toBe(true)
  })

  /* The row is the timecard's, the cells are the week's: a row that vanished
     when you stepped a week would hide what the finished card will say. */
  it('keeps a row whose time is all in another week, with no cells', () => {
    const rows = buildRows([entry({ id: 1, date: '2026-10-20', hours: 4 })], dates)

    expect(rows).toHaveLength(1)
    expect(rows[0].cells).toEqual({})
    expect(rows[0].total).toBe(0)
  })

  it('counts only this week into a row that spans two', () => {
    const rows = buildRows(
      [entry({ id: 1, hours: 2 }), entry({ id: 2, date: '2026-10-20', hours: 4 })],
      dates
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].total).toBe(2)
  })

  it('keeps entries with no project as their own row', () => {
    const rows = buildRows([entry({ id: 1, project_id: null })], dates)

    expect(rows[0].key).toBe(rowKey(null, null))
    expect(rows[0].project_id).toBeNull()
  })
})

describe('columnTotals', () => {
  it('totals each day and the week', () => {
    const dates = ['2026-10-05', '2026-10-06']
    const rows = buildRows(
      [
        entry({ id: 1, hours: 2 }),
        entry({ id: 2, hours: 3, project_id: 2 }),
        entry({ id: 3, hours: 4, date: '2026-10-06' })
      ],
      dates
    )

    const totals = columnTotals(rows, dates)

    expect(totals.byDate).toEqual({ '2026-10-05': 5, '2026-10-06': 4 })
    expect(totals.total).toBe(9)
  })

  it('reports zero for a day nothing lands on', () => {
    const totals = columnTotals([], ['2026-10-05'])

    expect(totals.byDate['2026-10-05']).toBe(0)
    expect(totals.total).toBe(0)
  })
})

describe('isOwned', () => {
  it('is true for anything the user typed, added or edited', () => {
    expect(isOwned(entry({ source: 'cell' }))).toBe(true)
    expect(isOwned(entry({ source: 'manual' }))).toBe(true)
    expect(isOwned(entry({ source: 'event' }))).toBe(false)
  })
})

describe('totalsByProjectActivity', () => {
  it('adds up each project and activity pair', () => {
    const rows = totalsByProjectActivity([
      entry({ id: 1, project_id: 1, activity_id: 7, hours: 2 }),
      entry({ id: 2, project_id: 1, activity_id: 7, hours: 3 }),
      entry({ id: 3, project_id: 1, activity_id: 8, hours: 1 })
    ])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ project_id: 1, activity_id: 7, hours: 5 })
  })

  /* The biggest number is the one being checked. */
  it('puts the largest total first', () => {
    const rows = totalsByProjectActivity([
      entry({ id: 1, project_id: 1, hours: 1 }),
      entry({ id: 2, project_id: 2, hours: 9 })
    ])

    expect(rows[0].project_id).toBe(2)
  })

  /* A report over any range: dates are the timecard's business, not its. */
  it('ignores dates entirely', () => {
    const rows = totalsByProjectActivity([
      entry({ id: 1, date: '2026-01-05', hours: 2 }),
      entry({ id: 2, date: '2026-11-30', hours: 2 })
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].hours).toBe(4)
  })

  it('keeps unmapped time visible rather than folding it away', () => {
    const rows = totalsByProjectActivity([
      entry({ id: 1, project_id: null, activity_id: null, hours: 3 })
    ])

    expect(rows[0]).toMatchObject({ project_id: null, hours: 3 })
  })

  it('has nothing to say about nothing', () => {
    expect(totalsByProjectActivity([])).toEqual([])
  })
})
