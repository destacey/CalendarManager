/**
 * Which calendar day each event belongs to, in the user's timezone.
 *
 * Deliberately free of dayjs. The calendar used to do two `dayjs.utc().tz()`
 * conversions and two `format()` calls per event, which measured 672ms for
 * 3,694 events against 13ms for the same work through a reused
 * `Intl.DateTimeFormat` — 51x, paid again on every load and every refresh.
 * That cost is what the "load everything once and cache it" design was built
 * around; it is cheap enough now that the design does not need to be.
 *
 * Being dayjs-free also makes this testable: `src/test/setup.ts` replaces
 * dayjs globally with a mock that answers every call with the same fixed
 * value, so anything built on it cannot be tested at all.
 */

import { Event } from '../types'

/* One formatter per timezone. Constructing one is the expensive part — far
   more so than formatting with it — and a calendar has exactly one timezone. */
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const existing = formatters.get(timeZone)
  if (existing) return existing

  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  formatters.set(timeZone, created)
  return created
}

/**
 * The date part, if it really is one. A value that is not a date must not
 * become a key that quietly groups unrelated events together.
 */
function calendarDate(stored: string): string | null {
  const date = stored.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

/**
 * The calendar day an instant falls on, as "YYYY-MM-DD".
 *
 * Stored datetimes are UTC and carry Microsoft Graph's seven fractional
 * digits, which not every engine parses; the fraction is dropped rather than
 * relied upon, since nothing here is finer-grained than a day. A value with
 * no time at all is already a date and is returned as one.
 */
export function dateKeyOf(stored: string, timeZone: string): string | null {
  if (!stored) return null
  if (!stored.includes('T')) return calendarDate(stored)

  const instant = new Date(`${stored.slice(0, 19)}Z`)
  if (Number.isNaN(instant.getTime())) return null

  const parts = formatterFor(timeZone).formatToParts(instant)
  const get = (type: string) => parts.find(p => p.type === type)?.value
  const year = get('year')
  const month = get('month')
  const day = get('day')
  if (!year || !month || !day) return null

  return `${year}-${month}-${day}`
}

/** The day after `date`, both "YYYY-MM-DD". */
function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return next.toISOString().slice(0, 10)
}

/** The day before `date`, both "YYYY-MM-DD". */
function previousDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const previous = new Date(Date.UTC(y, m - 1, d - 1))
  return previous.toISOString().slice(0, 10)
}

/**
 * Every event keyed by the day it lands on, with a multi-day event appearing
 * on each day it covers.
 *
 * An all-day event's dates are calendar days already — no timezone applies to
 * them — and Graph's end is exclusive, so the last day is the one before it.
 * Within a day, all-day events sort first and the rest by start time.
 */
export function groupEventsByDate(events: Event[], timeZone: string): Map<string, Event[]> {
  const byDate = new Map<string, Event[]>()

  const add = (date: string, event: Event) => {
    const existing = byDate.get(date)
    if (existing) existing.push(event)
    else byDate.set(date, [event])
  }

  for (const event of events) {
    // An all-day event's dates are calendar days, so they are read as written
    // — converting them by timezone would move someone's day off.
    const start = event.is_all_day
      ? calendarDate(event.start_date)
      : dateKeyOf(event.start_date, timeZone)
    if (!start) continue

    let end = start
    if (event.end_date) {
      const closing = event.is_all_day ? calendarDate(event.end_date) : null
      const raw = event.is_all_day
        ? closing && previousDay(closing)
        : dateKeyOf(event.end_date, timeZone)
      // An end before its start is nonsense; the event still belongs on the
      // day it starts rather than vanishing.
      if (raw && raw >= start) end = raw
    }

    if (start === end) {
      add(start, event)
      continue
    }

    for (let date = start; date <= end; date = nextDay(date)) {
      add(date, event)
    }
  }

  for (const day of byDate.values()) {
    day.sort((a, b) => {
      if (a.is_all_day !== b.is_all_day) return a.is_all_day ? -1 : 1
      return a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0
    })
  }

  return byDate
}
