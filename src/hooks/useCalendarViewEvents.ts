import { useState, useEffect, useMemo, useCallback } from 'react'
import dayjs, { Dayjs } from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { Event } from '../types'
import { calendarService } from '../services/calendar'
import { storageService } from '../services/storage'
import { useMessage } from '../contexts/MessageContext'

dayjs.extend(utc)
dayjs.extend(timezone)

export const useCalendarViewEvents = (viewStart: Dayjs, viewEnd: Dayjs) => {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(false)
  const [userTimezone, setUserTimezone] = useState<string>(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const messageApi = useMessage()

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

  // Load events for the specific date range
  const loadEventsInRange = useCallback(async (startDate: string, endDate: string) => {
    try {
      console.log('Loading events in range:', startDate, 'to', endDate)
      setLoading(true)
      const eventsData = await calendarService.getLocalEventsInRange(startDate, endDate)
      console.log('Loaded', eventsData.length, 'events in range')
      setEvents(eventsData)
    } catch (error) {
      messageApi.error('Failed to load events')
      console.error('Error loading events in range:', error)
      setEvents([]) // Set empty array on error to prevent infinite loading
    } finally {
      setLoading(false)
    }
  }, [messageApi])

  // Reload events when view range changes
  useEffect(() => {
    // Validate dates before making the call
    if (!viewStart || !viewEnd || !viewStart.isValid() || !viewEnd.isValid()) {
      console.warn('Invalid date range:', viewStart, viewEnd)
      setEvents([])
      setLoading(false)
      return
    }

    const startDate = viewStart.format('YYYY-MM-DD')
    const endDate = viewEnd.format('YYYY-MM-DD')
    
    // Sanity check: ensure start is before or equal to end
    if (startDate > endDate) {
      console.warn('Invalid date range: start after end', startDate, endDate)
      setEvents([])
      setLoading(false)
      return
    }

    loadEventsInRange(startDate, endDate)
  }, [viewStart, viewEnd, loadEventsInRange])

  // Set up sync completion callback to refresh calendar
  useEffect(() => {
    const handleSyncComplete = async (result: any) => {
      if (result.success) {
        const startDate = viewStart.format('YYYY-MM-DD')
        const endDate = viewEnd.format('YYYY-MM-DD')
        await loadEventsInRange(startDate, endDate)
      }
    }

    calendarService.addSyncCallbacks(undefined, handleSyncComplete)
    return () => calendarService.removeSyncCallbacks(undefined, handleSyncComplete)
  }, [viewStart, viewEnd, loadEventsInRange])

  // Optimized event date map - only process events we actually loaded
  const eventsByDate = useMemo(() => {
    const dateMap = new Map<string, Event[]>()
    
    if (events.length === 0) return dateMap

    // Process only the events we loaded (much smaller dataset)
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
    
    return dateMap
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
      case 'workingElsewhere': return 'purple'
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
    getEventsForDate,
    getEventColor,
    getShowAsDisplay,
    userTimezone
  }
}