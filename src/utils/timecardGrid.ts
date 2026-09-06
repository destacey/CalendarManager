/**
 * The shape of a timecard week grid: which days each week covers, and what
 * the entries add up to per (project, activity) row.
 *
 * Plain date arithmetic rather than dayjs, for the same two reasons as
 * `allDayHours.ts`: every date here is a calendar day with no timezone
 * question to answer, and `src/test/setup.ts` replaces dayjs globally with a
 * mock returning fixed values, which would make all of this untestable.
 */

import { TimecardEntry } from '../api/timecards'

/** Weeks run Sunday to Saturday, which is how the grid is read. */
const WEEK_START = 0

export interface GridDay {
  /** "YYYY-MM-DD". */
  date: string
  /** 0 = Sunday .. 6 = Saturday. */
  weekday: number
  /**
   * False for the days a week borrows from the month either side. They are
   * shown — a week that started on Tuesday should still look like a week —
   * but they take no input, because they belong to another timecard.
   */
  inPeriod: boolean
}

export interface GridWeek {
  /** 1-based, as the selector labels it. */
  number: number
  days: GridDay[]
  /** The first and last day of the week that are inside the period. */
  firstInPeriod: string
  lastInPeriod: string
}

export interface GridCell {
  hours: number
  /** How many entries add up to this cell — what the badge counts. */
  entries: number
  /** True once anything in the cell is the user's rather than generated. */
  owned: boolean
}

export interface GridRow {
  /** Stable across renders: `${project_id}:${activity_id}`. */
  key: string
  project_id: number | null
  activity_id: number | null
  /** Keyed by date; missing dates are empty cells. */
  cells: Record<string, GridCell>
  total: number
}

function toUtcDay(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
}

function toIsoDate(day: Date): string {
  return day.toISOString().slice(0, 10)
}

function addDays(day: Date, n: number): Date {
  const next = new Date(day.getTime())
  next.setUTCDate(next.getUTCDate() + n)
  return next
}

export function rowKey(projectId: number | null, activityId: number | null): string {
  return `${projectId ?? 'none'}:${activityId ?? 'none'}`
}

/**
 * Every week the period touches, each a full Sunday-to-Saturday row.
 *
 * A period starting on a Tuesday still produces a seven-day first week; the
 * Sunday and Monday belong to the month before and are marked as such.
 */
export function weeksOf(startDate: string, endDate: string): GridWeek[] {
  const start = toUtcDay(startDate)
  const end = toUtcDay(endDate)
  if (end < start) return []

  const weeks: GridWeek[] = []
  let cursor = addDays(start, -((start.getUTCDay() - WEEK_START + 7) % 7))

  while (cursor <= end) {
    const days: GridDay[] = []
    for (let i = 0; i < 7; i++) {
      const day = addDays(cursor, i)
      days.push({
        date: toIsoDate(day),
        weekday: day.getUTCDay(),
        inPeriod: day >= start && day <= end
      })
    }
    const inside = days.filter(d => d.inPeriod)
    weeks.push({
      number: weeks.length + 1,
      days,
      firstInPeriod: inside[0]!.date,
      lastInPeriod: inside[inside.length - 1]!.date
    })
    cursor = addDays(cursor, 7)
  }

  return weeks
}

/** The week holding a date, or the first week when the date is outside. */
export function weekOf(weeks: GridWeek[], date: string): GridWeek | undefined {
  return weeks.find(w => w.days.some(d => d.date === date && d.inPeriod)) ?? weeks[0]
}

/** An entry the user owns: typed over a cell, added by hand, or edited. */
export function isOwned(entry: TimecardEntry): boolean {
  return entry.source !== 'event'
}

/**
 * Folds entries into one row per (project, activity), summing each day.
 *
 * Every pair on the timecard gets a row, whether or not it has time in THIS
 * week: a row that appears in one week and vanishes in the next hides what
 * the finished timecard will say. `dates` fixes the columns, so only this
 * week's hours are summed into them. Rows arrive unsorted: only the caller
 * knows project codes and activity names to sort by.
 */
export function buildRows(entries: TimecardEntry[], dates: string[]): GridRow[] {
  const wanted = new Set(dates)
  const rows = new Map<string, GridRow>()

  for (const entry of entries) {
    const key = rowKey(entry.project_id ?? null, entry.activity_id ?? null)
    let row = rows.get(key)
    if (!row) {
      row = {
        key,
        project_id: entry.project_id ?? null,
        activity_id: entry.activity_id ?? null,
        cells: {},
        total: 0
      }
      rows.set(key, row)
    }

    if (!wanted.has(entry.date)) continue

    const cell = row.cells[entry.date] ?? { hours: 0, entries: 0, owned: false }
    cell.hours += entry.hours
    cell.entries += 1
    cell.owned = cell.owned || isOwned(entry)
    row.cells[entry.date] = cell
    row.total += entry.hours
  }

  return Array.from(rows.values())
}

/** The column totals, plus the week's own total. */
export function columnTotals(rows: GridRow[], dates: string[]): {
  byDate: Record<string, number>
  total: number
} {
  const byDate: Record<string, number> = {}
  let total = 0

  for (const date of dates) {
    const sum = rows.reduce((acc, row) => acc + (row.cells[date]?.hours ?? 0), 0)
    byDate[date] = sum
    total += sum
  }

  return { byDate, total }
}

export interface SummaryRow {
  key: string
  project_id: number | null
  activity_id: number | null
  /** One total per week, in the order `weeks` was given. */
  byWeek: number[]
  total: number
}

/** Every (project, activity) in the period, totalled per week and overall. */
export function summarise(entries: TimecardEntry[], weeks: GridWeek[]): SummaryRow[] {
  const weekOfDate = new Map<string, number>()
  weeks.forEach((week, index) => {
    for (const day of week.days) {
      // A borrowed day belongs to the neighbouring month, not to this total.
      if (day.inPeriod) weekOfDate.set(day.date, index)
    }
  })

  const rows = new Map<string, SummaryRow>()

  for (const entry of entries) {
    const index = weekOfDate.get(entry.date)
    if (index === undefined) continue

    const key = rowKey(entry.project_id ?? null, entry.activity_id ?? null)
    let row = rows.get(key)
    if (!row) {
      row = {
        key,
        project_id: entry.project_id ?? null,
        activity_id: entry.activity_id ?? null,
        byWeek: weeks.map(() => 0),
        total: 0
      }
      rows.set(key, row)
    }

    row.byWeek[index] += entry.hours
    row.total += entry.hours
  }

  return Array.from(rows.values())
}
