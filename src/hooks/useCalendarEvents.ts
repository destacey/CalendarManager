import { useState, useEffect, useMemo, useCallback } from 'react'
import { Dayjs } from 'dayjs'
import { Event } from '../types'
import { onSyncComplete } from '../api/sync'
import { storageService } from '../services/storage'
import { getEventsInRange } from '../api/events'
import { groupEventsByDate } from '../utils/eventsByDate'
import { rangeBounds, ViewRange } from '../utils/viewRange'

/**
 * The events a calendar view needs, and the day each one falls on.
 *
 * Reads only the range on screen. It used to read every event in the database
 * and filter in memory — a design that came from a 2025 fix for week
 * navigation taking 15 seconds, where the real cost turned out to be the
 * per-event timezone conversion rather than the query. With that conversion
 * 51x cheaper (see `eventsByDate.ts`), reading a range is simply better:
 * 3,694 rows in 93ms became 76 rows in 0.19ms on a real database.
 */
export const useCalendarEvents = (range: ViewRange) => {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userTimezone, setUserTimezone] = useState<string>(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  )

  const { start, end } = rangeBounds(range)

  const loadEvents = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setEvents(await getEventsInRange(start, end))
    } catch (error) {
      setError('Failed to load events')
      console.error('Error loading events:', error)
    } finally {
      setLoading(false)
    }
  }, [start, end])

  // Load user timezone
  useEffect(() => {
    const loadTimezone = async () => {
      try {
        const timezone = await storageService.getTimezone()
        setUserTimezone(timezone)
      } catch (error) {
        console.error('Error loading timezone:', error)
      }
    }
    loadTimezone()
  }, [])

  // Set up sync completion callback to refresh calendar
  useEffect(() => {
    const handleSyncComplete = async (result: any) => {
      if (result.success) {
        await loadEvents()
      }
    }

    // onSyncComplete resolves asynchronously, so an unmount before it settles
    // would otherwise leak a listener that nothing ever removes.
    let cancelled = false
    let unlisten: (() => void) | undefined

    onSyncComplete(handleSyncComplete).then((off) => {
      if (cancelled) off()
      else unlisten = off
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [loadEvents])

  /* Whenever the range changes, which is what moving between months, weeks
     or views does. The old guard against re-running existed because a load
     meant every event in the database. */
  useEffect(() => {
    loadEvents()
  }, [loadEvents])

  /* A plain memo: this measured 13ms for 3,694 events, so there is nothing
     left worth deferring behind a timeout and a transition. */
  const eventsByDate = useMemo(
    () => groupEventsByDate(events, userTimezone),
    [events, userTimezone]
  )

  const getEventsForDate = useCallback((date: Dayjs) => {
    const dateStr = date.format('YYYY-MM-DD')
    return eventsByDate.get(dateStr) || []
  }, [eventsByDate])

  const getEventColor = (showAs: string) => {
    switch (showAs) {
      case 'busy': return 'processing'
      case 'tentative': return 'warning'
      case 'oof': return 'error'
      case 'free': return 'success'
      case 'workingElsewhere': return 'default'
      default: return 'default'
    }
  }

  const getShowAsDisplay = (showAs: string) => {
    switch (showAs) {
      case 'busy': return 'Busy'
      case 'tentative': return 'Tentative'
      case 'oof': return 'Out of Office'
      case 'free': return 'Free'
      case 'workingElsewhere': return 'Working Elsewhere'
      default: return showAs
    }
  }

  return {
    events,
    loading,
    error,
    loadEvents,
    refreshEvents: loadEvents,
    getEventsForDate,
    getEventColor,
    getShowAsDisplay,
    userTimezone
  }
}