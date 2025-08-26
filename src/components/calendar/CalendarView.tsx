import React, { useState, useCallback, useEffect } from 'react'
import { Calendar, Flex, Grid, Spin, Typography, App, Button } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { Event, EventType } from '../../types'
import { useCalendarEvents } from '../../hooks/useCalendarEvents'
// import { useCalendarViewEvents } from '../../hooks/useCalendarViewEvents' // Disabled temporarily
import { useCalendarState } from '../../hooks/useCalendarState'
import WeekView from './WeekView'
import EventModal from './EventModal'
import CalendarEventCell from './CalendarEventCell'
import MonthEventCell from './MonthEventCell'
import CalendarHeader from './CalendarHeader'
import { getEventBackgroundColor } from '../../utils/eventUtils'

dayjs.extend(utc)
dayjs.extend(timezone)

const { useBreakpoint } = Grid
const { Title, Text } = Typography

const CalendarView: React.FC = () => {
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [eventTypes, setEventTypes] = useState<EventType[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const screens = useBreakpoint()
  const { message } = App.useApp()

  // Use persistent calendar state
  const {
    viewMode,
    calendarType,
    currentWeek,
    currentDate,
    setViewMode,
    setCalendarType,
    setCurrentWeek,
    setCurrentDate
  } = useCalendarState()
  
  const isLargeScreen = screens.xl // xl breakpoint is 1200px

  // Always use the original hook for now to ensure initial loading works
  // TODO: Re-enable optimized hook after fixing initialization issues
  const {
    loading,
    error,
    getEventsForDate,
    getEventColor,
    getShowAsDisplay,
    userTimezone,
    refreshEvents
  } = useCalendarEvents()


  useEffect(() => {
    loadEventTypes()
  }, [])

  // Show error messages when they occur
  useEffect(() => {
    if (error) {
      message.error(error)
    }
  }, [error, message])

  const loadEventTypes = async () => {
    try {
      if (window.electronAPI?.getEventTypes) {
        const types = await window.electronAPI.getEventTypes()
        setEventTypes(types)
      }
    } catch (error) {
      console.error('Error loading event types:', error)
    }
  }

  const handleRefresh = async () => {
    try {
      setRefreshing(true)
      // Reload events and event types
      await Promise.all([
        refreshEvents?.(),
        loadEventTypes()
      ])
      message.success('Calendar data refreshed')
    } catch (error) {
      console.error('Error refreshing calendar:', error)
      message.error('Failed to refresh calendar data')
    } finally {
      setRefreshing(false)
    }
  }

  // Enhanced function that considers event type colors
  const getEventDisplayColor = useCallback((event: Event) => {
    // If event has a type, use the type color
    if (event.type_id) {
      const eventType = eventTypes.find(t => t.id === event.type_id)
      if (eventType) {
        return eventType.color
      }
    }
    // Fallback to show_as based color
    return getEventBackgroundColor(event.show_as)
  }, [eventTypes])


  const handleEventClick = useCallback((event: Event) => {
    setSelectedEvent(event)
    setIsModalVisible(true)
  }, [])

  const cellRender = useCallback((current: Dayjs) => {
    const dayEvents = getEventsForDate(current)
    
    return (
      <CalendarEventCell
        current={current}
        dayEvents={dayEvents}
        isLargeScreen={!!isLargeScreen}
        userTimezone={userTimezone || ''}
        onEventClick={handleEventClick}
        getShowAsDisplay={getShowAsDisplay}
        getEventDisplayColor={getEventDisplayColor}
      />
    )
  }, [getEventsForDate, isLargeScreen, userTimezone, getShowAsDisplay, getEventDisplayColor, handleEventClick])

  const monthCellRender = useCallback((value: Dayjs) => {
    return (
      <MonthEventCell
        value={value}
        getEventsForDate={getEventsForDate}
      />
    )
  }, [getEventsForDate])





  // Show loading spinner if events are still loading
  if (loading) {
    return (
      <Flex 
        vertical 
        className="calendar-container-responsive" 
        justify="center" 
        align="center" 
        style={{ height: '100%' }}
        gap="medium"
      >
        <Spin size="large" />
        <Text type="secondary" style={{ fontSize: '16px' }}>Loading events...</Text>
      </Flex>
    )
  }

  return (
    <Flex vertical className="calendar-container-responsive" style={{ width: '100%' }}>
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <Title level={2} style={{ margin: 0 }}>Calendar</Title>
        <Button
          icon={<ReloadOutlined />}
          loading={refreshing}
          onClick={handleRefresh}
        >
          Refresh
        </Button>
      </Flex>
      
      <Flex flex={1} style={{ overflow: 'hidden', width: '100%' }}>
        {viewMode === 'month' ? (
          <Calendar
            value={currentDate}
            mode={calendarType}
            onChange={(date) => setCurrentDate(date)}
            onPanelChange={(date, mode) => {
              setCurrentDate(date)
              if (mode === 'month' || mode === 'year') {
                setCalendarType(mode)
              }
            }}
            cellRender={(current, info) => {
              if (calendarType === 'month') {
                return cellRender(current)
              } else if (calendarType === 'year' && info.type === 'month') {
                return monthCellRender(current)
              }
              return null
            }}
            style={{ width: '100%' }}
            fullscreen={true}
            headerRender={({ value, type, onChange, onTypeChange }) => (
              <CalendarHeader
                value={value}
                type={type}
                viewMode={viewMode}
                calendarType={calendarType}
                onChange={onChange}
                onTypeChange={onTypeChange}
                onCurrentDateChange={setCurrentDate}
                onCurrentWeekChange={setCurrentWeek}
                onViewModeChange={setViewMode}
                onCalendarTypeChange={setCalendarType}
              />
            )}
          />
        ) : (
          <WeekView
            currentWeek={currentWeek}
            setCurrentWeek={setCurrentWeek}
            setViewMode={setViewMode}
            setCalendarType={setCalendarType}
            getEventsForDate={getEventsForDate}
            getEventBackgroundColor={getEventBackgroundColor}
            getEventDisplayColor={getEventDisplayColor}
            setSelectedEvent={setSelectedEvent}
            setIsModalVisible={setIsModalVisible}
            userTimezone={userTimezone || ''}
          />
        )}
      </Flex>

      <EventModal
        isVisible={isModalVisible}
        onClose={() => setIsModalVisible(false)}
        event={selectedEvent}
        getEventColor={getEventColor}
        getShowAsDisplay={getShowAsDisplay}
        userTimezone={userTimezone}
        onEventUpdated={() => {
          refreshEvents?.()
          loadEventTypes()
        }}
      />
    </Flex>
  )
}

export default CalendarView