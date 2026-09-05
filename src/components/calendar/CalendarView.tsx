import React, { useState, useCallback, useEffect } from 'react'
import { Calendar, Flex, Grid, Spin, Typography, Button, Card } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { Event, EventType, Project, Activity } from '../../types'
import { useCalendarEvents } from '../../hooks/useCalendarEvents'
// import { useCalendarViewEvents } from '../../hooks/useCalendarViewEvents' // Disabled temporarily
import { useCalendarState } from '../../hooks/useCalendarState'
import WeekView from './WeekView'
import DayView from './DayView'
import EventTable from './EventTable'
import EventModal from './EventModal'
import CalendarEventCell from './CalendarEventCell'
import MonthEventCell from './MonthEventCell'
import CalendarHeader from './CalendarHeader'
import { getEventBackgroundColor } from '../../utils/eventUtils'
import { useMessage } from '../../contexts/MessageContext'
import { getEventTypes } from '../../api/eventTypes'
import { getProjects } from '../../api/projects'
import { getActivities } from '../../api/activities'
import { useRefreshOnShow } from '../../hooks/useRefreshOnShow'

dayjs.extend(utc)
dayjs.extend(timezone)

const { useBreakpoint } = Grid
const { Title, Text } = Typography

interface CalendarViewProps {
  /** True while this is the visible screen. */
  isActive?: boolean
  /** Something changed events elsewhere; reload when next shown. */
  needsRefresh?: boolean
  onRefreshed?: () => void
}

const CalendarView: React.FC<CalendarViewProps> = ({
  isActive = true,
  needsRefresh = false,
  onRefreshed
}) => {
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [eventTypes, setEventTypes] = useState<EventType[]>([])
  /* Loaded here and passed down for the same reason event types are: the table
     and the modal hold ids, and every row would otherwise resolve names on its
     own. Both lists are small and change rarely. */
  const [projects, setProjects] = useState<Project[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [exportFunction, setExportFunction] = useState<(() => void) | null>(null)
  
  const handleExportReady = useCallback((exportFn: () => void) => {
    setExportFunction(() => exportFn)
  }, [])
  const screens = useBreakpoint()
  const messageApi = useMessage()

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
    loadMappingLookups()
  }, [])

  /* Reload lazily when this screen is next shown - see the hook for why this
     is not a remount. */
  useRefreshOnShow(isActive, needsRefresh, () => {
    refreshEvents?.()
    loadEventTypes()
    loadMappingLookups()
    onRefreshed?.()
  })

  // Show error messages when they occur
  useEffect(() => {
    if (error) {
      messageApi.error(error)
    }
  }, [error, messageApi])

  const loadEventTypes = async () => {
    try {
      const types = await getEventTypes()
      setEventTypes(types)
    } catch (error) {
      console.error('Error loading event types:', error)
    }
  }

  const loadMappingLookups = async () => {
    try {
      const [p, a] = await Promise.all([getProjects(), getActivities()])
      setProjects(p)
      setActivities(a)
    } catch (error) {
      console.error('Error loading projects and activities:', error)
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
      messageApi.success('Calendar data refreshed')
    } catch (error) {
      console.error('Error refreshing calendar:', error)
      messageApi.error('Failed to refresh calendar data')
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
      
      <Card style={{ flex: 1, overflow: 'hidden', width: '100%' }} styles={{ body: { padding: 0, height: '100%' } }}>
        <Flex flex={1} style={{ overflow: 'hidden', width: '100%', height: '100%' }}>
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
        ) : viewMode === 'week' ? (
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
            eventTypes={eventTypes}
          />
        ) : viewMode === 'day' ? (
          <DayView
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
            eventTypes={eventTypes}
          />
        ) : (
          <Flex vertical style={{ width: '100%', height: '100%' }}>
            <CalendarHeader
              value={currentDate}
              type="month"
              viewMode={viewMode}
              calendarType={calendarType}
              onChange={setCurrentDate}
              onTypeChange={() => {}} // Not used for table view
              onCurrentDateChange={setCurrentDate}
              onCurrentWeekChange={setCurrentWeek}
              onViewModeChange={setViewMode}
              onCalendarTypeChange={setCalendarType}
              exportFunction={exportFunction}
            />
            <EventTable
              currentDate={currentDate}
              getEventsForDate={getEventsForDate}
              getEventBackgroundColor={getEventBackgroundColor}
              getEventDisplayColor={getEventDisplayColor}
              setSelectedEvent={setSelectedEvent}
              setIsModalVisible={setIsModalVisible}
              userTimezone={userTimezone || ''}
              eventTypes={eventTypes}
              projects={projects}
              activities={activities}
              onMappingChanged={() => refreshEvents?.()}
              onExportReady={handleExportReady}
            />
          </Flex>
        )}
        </Flex>
      </Card>

      <EventModal
        isVisible={isModalVisible}
        onClose={() => setIsModalVisible(false)}
        event={selectedEvent}
        getEventColor={getEventColor}
        getShowAsDisplay={getShowAsDisplay}
        userTimezone={userTimezone}
        projects={projects}
        activities={activities}
        onEventUpdated={() => {
          refreshEvents?.()
          loadEventTypes()
        }}
      />
    </Flex>
  )
}

export default CalendarView