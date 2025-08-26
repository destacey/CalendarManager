import { useState, useEffect, useMemo, useCallback, startTransition, useRef } from 'react'
import dayjs, { Dayjs } from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { Event } from '../types'
import { calendarService } from '../services/calendar'
import { storageService } from '../services/storage'

dayjs.extend(utc)
dayjs.extend(timezone)

export const useCalendarEvents = () => {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userTimezone, setUserTimezone] = useState<string>(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const hasInitiallyLoaded = useRef(false)

  const loadEvents = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const eventsData = await calendarService.getLocalEvents()
      setEvents(eventsData)
    } catch (error) {
      setError('Failed to load events')
      console.error('Error loading events:', error)
    } finally {
      setLoading(false)
    }
  }, [])

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

    calendarService.addSyncCallbacks(undefined, handleSyncComplete)
    return () => calendarService.removeSyncCallbacks(undefined, handleSyncComplete)
  }, [loadEvents])

  // Initial load
  useEffect(() => {
    if (!hasInitiallyLoaded.current) {
      hasInitiallyLoaded.current = true
      loadEvents()
    }
  }, [])

  // Optimized event date map with deferred computation to prevent blocking
  const [eventsByDate, setEventsByDate] = useState(new Map<string, Event[]>())

  useEffect(() => {
    // Use setTimeout to defer heavy computation and prevent UI blocking
    const timeoutId = setTimeout(() => {
      startTransition(() => {
        const dateMap = new Map<string, Event[]>()
        
        if (events.length === 0) {
          setEventsByDate(dateMap)
          return
        }
        
        // Process events more efficiently
        for (const event of events) {
          try {
            // Pre-compute and cache date objects to avoid repeated parsing
            const startDate = event.is_all_day 
              ? dayjs(event.start_date)
              : dayjs.utc(event.start_date).tz(userTimezone)
            
            const endDate = event.end_date
              ? (event.is_all_day 
                  ? dayjs(event.end_date).subtract(1, 'day')
                  : dayjs.utc(event.end_date).tz(userTimezone))
              : startDate
            
            // For single-day events (most common), optimize the path
            const startDateStr = startDate.format('YYYY-MM-DD')
            const endDateStr = endDate.format('YYYY-MM-DD')
            
            if (startDateStr === endDateStr) {
              // Single day event - most common case
              if (!dateMap.has(startDateStr)) {
                dateMap.set(startDateStr, [])
              }
              dateMap.get(startDateStr)!.push(event)
            } else {
              // Multi-day event - less common, handle separately
              let currentDate = startDate.startOf('day')
              const finalDate = endDate.startOf('day')
              
              while (currentDate.isSameOrBefore(finalDate, 'day')) {
                const dateStr = currentDate.format('YYYY-MM-DD')
                if (!dateMap.has(dateStr)) {
                  dateMap.set(dateStr, [])
                }
                dateMap.get(dateStr)!.push(event)
                currentDate = currentDate.add(1, 'day')
              }
            }
          } catch (error) {
            console.warn('Error processing event date:', event.start_date, error)
          }
        }
        
        // Sort events only once per date after all events are added
        for (const dayEvents of dateMap.values()) {
          dayEvents.sort((a, b) => {
            if (a.is_all_day && !b.is_all_day) return -1
            if (!a.is_all_day && b.is_all_day) return 1
            
            // Use cached start times for sorting to avoid repeated timezone conversion
            const aStart = a.is_all_day ? a.start_date : a.start_date
            const bStart = b.is_all_day ? b.start_date : b.start_date
            return aStart < bStart ? -1 : aStart > bStart ? 1 : 0
          })
        }
        
        setEventsByDate(dateMap)
      })
    }, 10) // Small delay to allow UI to render first

    return () => clearTimeout(timeoutId)
  }, [events, userTimezone])

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