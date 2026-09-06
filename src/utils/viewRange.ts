/**
 * The span of days a calendar view is actually showing.
 *
 * The calendar used to read every event in the database and filter in memory,
 * which was how a 2025 fix made week navigation instant — the real cost was
 * per-event timezone conversion, not the query. With that cost gone, a view
 * can read only what it displays: 3,694 rows in 93ms became 76 rows in 0.19ms
 * on a real database.
 *
 * Plain date arithmetic, no dayjs — see `eventsByDate.ts` for why that
 * matters here.
 */

export type CalendarViewMode = 'month' | 'week' | 'day' | 'table'

export interface ViewRange {
  /** "YYYY-MM-DD", inclusive. */
  start: string
  /** "YYYY-MM-DD", inclusive. */
  end: string
}

function toUtcDay(date: string): Date {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
}

function toIso(day: Date): string {
  return day.toISOString().slice(0, 10)
}

function addDays(day: Date, n: number): Date {
  const next = new Date(day.getTime())
  next.setUTCDate(next.getUTCDate() + n)
  return next
}

/** Sunday, matching dayjs's default week start, which the week view uses. */
function startOfWeek(day: Date): Date {
  return addDays(day, -day.getUTCDay())
}

/**
 * What to fetch for a view showing `date`.
 *
 * A month is padded out to whole weeks because its grid shows the days either
 * side to fill the first and last rows — without that padding those cells
 * would be silently empty, which looks exactly like missing data.
 */
export function viewRange(date: string, mode: CalendarViewMode): ViewRange {
  const day = toUtcDay(date)

  if (mode === 'day') {
    const iso = toIso(day)
    return { start: iso, end: iso }
  }

  if (mode === 'week') {
    const first = startOfWeek(day)
    return { start: toIso(first), end: toIso(addDays(first, 6)) }
  }

  // Month and table both work a calendar month; the month grid also shows the
  // days either side of it.
  const monthStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1))
  const monthEnd = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0))

  if (mode === 'table') {
    return { start: toIso(monthStart), end: toIso(monthEnd) }
  }

  const first = startOfWeek(monthStart)
  const last = addDays(startOfWeek(monthEnd), 6)
  return { start: toIso(first), end: toIso(last) }
}

/** The bounds as the events query wants them: whole days, not midnights. */
export function rangeBounds(range: ViewRange): { start: string; end: string } {
  return { start: `${range.start}T00:00:00`, end: `${range.end}T23:59:59` }
}
