import type { Dayjs } from 'dayjs'
import { Event } from '../types'

export const DEFAULT_HOUR_HEIGHT = 120 // px per hour
export const HOURS = Array.from({ length: 24 }, (_, i) => i)
export const SCROLL_TO_HOUR = 7

export interface PositionedEvent extends Event {
  top: number
  height: number
  column: number
  totalColumns: number
  localStart: Dayjs
  localEnd: Dayjs
}

export const formatHour = (hour: number): string => {
  if (hour === 0) return '12 AM'
  if (hour < 12) return `${hour} AM`
  if (hour === 12) return '12 PM'
  return `${hour - 12} PM`
}

// Lay out events into equal-width columns (like Google Calendar / Outlook)
export function layoutEvents(
  events: Array<{ event: Event; localStart: Dayjs; localEnd: Dayjs }>,
  dayStart: Dayjs,
  hourHeight: number = DEFAULT_HOUR_HEIGHT
): PositionedEvent[] {
  if (events.length === 0) return []

  // Sort by start time, then by duration (longer first for better packing)
  const sorted = [...events].sort((a, b) => {
    const diff = a.localStart.valueOf() - b.localStart.valueOf()
    if (diff !== 0) return diff
    return b.localEnd.valueOf() - a.localEnd.valueOf()
  })

  // Compute top/height for each event
  const pixelsPerMinute = hourHeight / 60

  const items = sorted.map(({ event, localStart, localEnd }) => {
    const dayStartTime = dayStart.startOf('day')
    const effectiveStart = localStart.isBefore(dayStartTime) ? dayStartTime : localStart
    const dayEndTime = dayStart.endOf('day')
    const effectiveEnd = localEnd.isAfter(dayEndTime) ? dayEndTime : localEnd

    // Snap to 5-minute increments
    const startMinutes = effectiveStart.hour() * 60 + effectiveStart.minute()
    const endMinutes = effectiveEnd.hour() * 60 + effectiveEnd.minute() + (effectiveEnd.second() > 0 ? 1 : 0)
    const snappedStart = Math.floor(startMinutes / 5) * 5
    const snappedEnd = Math.max(snappedStart + 5, Math.ceil(endMinutes / 5) * 5)
    const durationMinutes = snappedEnd - snappedStart

    return {
      event,
      top: snappedStart * pixelsPerMinute,
      height: durationMinutes * pixelsPerMinute,
      localStart: effectiveStart,
      localEnd: effectiveEnd
    }
  })

  // Greedy column assignment: place each event in the first column where it fits
  const columnEnds: number[][] = []

  const positioned: PositionedEvent[] = items.map(item => {
    let column = 0
    let placed = false
    for (let c = 0; c < columnEnds.length; c++) {
      if (columnEnds[c].every(end => item.top >= end - 1)) {
        column = c
        columnEnds[c].push(item.top + item.height)
        placed = true
        break
      }
    }
    if (!placed) {
      column = columnEnds.length
      columnEnds.push([item.top + item.height])
    }

    return {
      ...item.event,
      top: item.top,
      height: item.height,
      column,
      totalColumns: 0,
      localStart: item.localStart,
      localEnd: item.localEnd
    }
  })

  // Group overlapping events and assign totalColumns per group
  const sorted2 = [...positioned].sort((a, b) => a.top - b.top)
  const groups: PositionedEvent[][] = []
  let currentGroup: PositionedEvent[] = [sorted2[0]]
  let groupEnd = sorted2[0].top + sorted2[0].height

  for (let i = 1; i < sorted2.length; i++) {
    const ev = sorted2[i]
    if (ev.top < groupEnd - 1) {
      currentGroup.push(ev)
      groupEnd = Math.max(groupEnd, ev.top + ev.height)
    } else {
      groups.push(currentGroup)
      currentGroup = [ev]
      groupEnd = ev.top + ev.height
    }
  }
  groups.push(currentGroup)

  for (const group of groups) {
    const maxCol = Math.max(...group.map(e => e.column)) + 1
    for (const ev of group) {
      ev.totalColumns = maxCol
    }
  }

  return positioned
}
