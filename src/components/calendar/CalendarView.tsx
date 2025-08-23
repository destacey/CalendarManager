import React, { useState, useCallback } from 'react'
import { Calendar, Flex, Grid, Spin, Typography } from 'antd'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { Event } from '../../types'
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
  const screens = useBreakpoint()

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
    getEventsForDate,
    getEventColor,
    getShowAsDisplay,
    userTimezone
  } = useCalendarEvents()


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
      />
    )
  }, [getEventsForDate, isLargeScreen, userTimezone, getShowAsDisplay, handleEventClick])

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
      />
    </Flex>
  )
}

export default CalendarView