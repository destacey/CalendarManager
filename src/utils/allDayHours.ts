/**
 * How much time an all-day event is worth, and which days it lands on.
 *
 * Microsoft Graph gives an all-day event a start date and an EXCLUSIVE end
 * date, so a single Monday off is Monday → Tuesday. Nothing in the event says
 * how many hours it represents; the app decides, per event type.
 *
 * Deliberately built on plain date arithmetic rather than dayjs. Every date
 * here is a calendar day, not an instant — there is no timezone question to
 * answer — and `src/test/setup.ts` replaces dayjs globally with a mock that
 * returns fixed values, which would make these results untestable.
 */

export interface AllDaySettings {
  /** 0 = Sunday .. 6 = Saturday. */
  workingDays: number[]
  /** "HH:mm" — when a synthesised working day starts. */
  workdayStart: string
}

export interface AllDayEntry {
  /** "YYYY-MM-DD". */
  date: string
  /** ISO local datetime, e.g. "2026-10-06T08:00:00". */
  start: string
  end: string
  hours: number
}

export const DEFAULT_ALL_DAY_SETTINGS: AllDaySettings = {
  workingDays: [1, 2, 3, 4, 5],
  workdayStart: '08:00'
}

/** Parses the date half of an ISO string into a UTC-anchored Date. */
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

/**
 * Every calendar day an all-day event covers, inclusive.
 *
 * Graph's end date is exclusive, so one day back. A missing or malformed end
 * is treated as a single day rather than throwing — a bad row should cost its
 * own hours, not the whole month's.
 */
export function allDayCalendarDays(startDate: string, endDate?: string | null): string[] {
  const start = toUtcDay(startDate)
  if (Number.isNaN(start.getTime())) return []

  let last = start
  if (endDate) {
    const exclusiveEnd = toUtcDay(endDate)
    if (!Number.isNaN(exclusiveEnd.getTime())) {
      const inclusive = addDays(exclusiveEnd, -1)
      if (inclusive.getTime() > start.getTime()) last = inclusive
    }
  }

  const days: string[] = []
  for (let day = start; day.getTime() <= last.getTime(); day = addDays(day, 1)) {
    days.push(toIsoDate(day))
  }
  return days
}

/**
 * Splits an all-day event into the days it should actually be counted on.
 *
 * The rules, in the order they matter:
 *
 * - A SINGLE-day event is never filtered. Booking one Saturday off is a
 *   deliberate act, and dropping it because Saturday is not a working day
 *   would make the event vanish from a timesheet it belongs in.
 * - A MULTI-day event drops its non-working days — that is the whole point,
 *   so a Monday-to-Sunday block reads as five days rather than seven.
 * - Unless dropping them would leave NOTHING. A Saturday-to-Sunday block is
 *   as deliberate as a single Saturday, so it keeps all its days rather than
 *   silently disappearing.
 */
export function allDayWorkingDays(
  startDate: string,
  endDate: string | null | undefined,
  settings: AllDaySettings
): string[] {
  const days = allDayCalendarDays(startDate, endDate)
  if (days.length <= 1) return days

  const working = days.filter(date =>
    settings.workingDays.includes(toUtcDay(date).getUTCDay())
  )
  return working.length > 0 ? working : days
}

/**
 * The per-day entries an all-day event contributes.
 *
 * `allDayHours` comes from the event's type. Zero is meaningful — it is how a
 * Birthday or Holiday type opts out — so the entries are still produced and
 * simply carry no time, keeping the event visible wherever it is listed.
 */
export function expandAllDayEvent(
  startDate: string,
  endDate: string | null | undefined,
  allDayHours: number,
  settings: AllDaySettings = DEFAULT_ALL_DAY_SETTINGS
): AllDayEntry[] {
  const hours = Number.isFinite(allDayHours) && allDayHours > 0 ? allDayHours : 0
  const [startHour, startMinute] = parseTime(settings.workdayStart)

  return allDayWorkingDays(startDate, endDate, settings).map(date => {
    const startMinutes = startHour * 60 + startMinute
    return {
      date,
      start: `${date}T${formatTime(startMinutes)}:00`,
      end: `${date}T${formatTime(startMinutes + Math.round(hours * 60))}:00`,
      hours
    }
  })
}

/** Total hours an all-day event is worth, across every day it counts on. */
export function allDayEventHours(
  startDate: string,
  endDate: string | null | undefined,
  allDayHours: number,
  settings: AllDaySettings = DEFAULT_ALL_DAY_SETTINGS
): number {
  return expandAllDayEvent(startDate, endDate, allDayHours, settings).reduce(
    (total, entry) => total + entry.hours,
    0
  )
}

function parseTime(value: string): [number, number] {
  const [h, m] = (value ?? '').split(':').map(Number)
  const hour = Number.isFinite(h) ? Math.min(Math.max(h, 0), 23) : 8
  const minute = Number.isFinite(m) ? Math.min(Math.max(m, 0), 59) : 0
  return [hour, minute]
}

/**
 * Minutes-from-midnight as "HH:mm", clamped to the same day. A 16-hour
 * all-day value from an 08:00 start would otherwise roll past midnight and
 * produce an end that reads as earlier than its start.
 */
function formatTime(totalMinutes: number): string {
  const clamped = Math.min(Math.max(totalMinutes, 0), 23 * 60 + 59)
  const h = Math.floor(clamped / 60)
  const m = clamped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
