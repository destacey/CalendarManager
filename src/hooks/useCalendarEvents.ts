import { useState, useEffect, useMemo, useCallback } from 'react'
import { App } from 'antd'
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
  const { message } = App.useApp()

  const loadEvents = useCallback(async () => {
    try {
      setLoading(true)
      const eventsData = await calendarService.getLocalEvents()
      setEvents(eventsData)
    } catch (error) {
      message.error('Failed to load events')
      console.error('Error loading events:', error)
    } finally {
      setLoading(false)
    }
  }, [message])

  // Set up sync completion callback to refresh calendar
  useEffect(() => {
    const handleSyncComplete = async (result: any) => {
      if (result.success) {
        // Reload events after successful sync
        await loadEvents()
      }
    }

    // Add completion callback for calendar refresh
    calendarService.addSyncCallbacks(undefined, handleSyncComplete)

    return () => {
      calendarService.removeSyncCallbacks(undefined, handleSyncComplete)
    }
  }, [])

  // Initial load
  useEffect(() => {
    loadEvents()
  }, [])

  // Memoized event date map for fast lookups
  const eventsByDate = useMemo(() => {
    const userTimezone = storageService.getTimezone()
    const dateMap = new Map<string, Event[]>()
    
    // Only process events if we have them
    if (events.length === 0) return dateMap
    
    events.forEach(event => {
      try {
        // Assume stored date is in UTC and convert to user timezone
        const eventDate = dayjs.utc(event.start_date).tz(userTimezone).format('YYYY-MM-DD')
        if (!dateMap.has(eventDate)) {
          dateMap.set(eventDate, [])
        }
        dateMap.get(eventDate)!.push(event)
      } catch (error) {
        console.warn('Error processing event date:', event.start_date, error)
      }
    })
    
    // Sort events within each date by time
    dateMap.forEach((dayEvents) => {
      dayEvents.sort((a, b) => {
        if (a.is_all_day && !b.is_all_day) return -1
        if (!a.is_all_day && b.is_all_day) return 1
        try {
          return dayjs.utc(a.start_date).tz(userTimezone).isBefore(dayjs.utc(b.start_date).tz(userTimezone)) ? -1 : 1
        } catch (error) {
          return 0
        }
      })
    })
    
    return dateMap
  }, [events])

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
    loadEvents,
    getEventsForDate,
    getEventColor,
    getShowAsDisplay
  }
}