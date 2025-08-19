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
  const [userTimezone, setUserTimezone] = useState<string>(Intl.DateTimeFormat().resolvedOptions().timeZone)
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
    loadEvents()
  }, [])

  // Memoized event date map for fast lookups
  const eventsByDate = useMemo(() => {
    const dateMap = new Map<string, Event[]>()
    
    if (events.length === 0) return dateMap
    
    events.forEach(event => {
      try {
        let startDate: dayjs.Dayjs
        let endDate: dayjs.Dayjs
        
        if (event.is_all_day) {
          // For all-day events, treat as calendar dates without timezone conversion
          startDate = dayjs(event.start_date)
          // For all-day events, Microsoft Graph sets end date to the day after, so subtract 1 day for proper display
          endDate = event.end_date ? dayjs(event.end_date).subtract(1, 'day') : startDate
        } else {
          // For timed events, apply timezone conversion
          startDate = dayjs.utc(event.start_date).tz(userTimezone)
          endDate = event.end_date ? dayjs.utc(event.end_date).tz(userTimezone) : startDate
        }
        
        // For multi-day events, add to every date they span
        let currentDate = startDate.startOf('day')
        const finalDate = endDate.startOf('day')
        
        while (currentDate.isSame(finalDate, 'day') || currentDate.isBefore(finalDate, 'day')) {
          const dateStr = currentDate.format('YYYY-MM-DD')
          if (!dateMap.has(dateStr)) {
            dateMap.set(dateStr, [])
          }
          dateMap.get(dateStr)!.push(event)
          currentDate = currentDate.add(1, 'day')
        }
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
          // Handle timezone conversion differently for all-day vs timed events
          const aStartDate = a.is_all_day ? dayjs(a.start_date) : dayjs.utc(a.start_date).tz(userTimezone)
          const bStartDate = b.is_all_day ? dayjs(b.start_date) : dayjs.utc(b.start_date).tz(userTimezone)
          return aStartDate.isBefore(bStartDate) ? -1 : 1
        } catch (error) {
          return 0
        }
      })
    })
    
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
    getShowAsDisplay,
    userTimezone
  }
}