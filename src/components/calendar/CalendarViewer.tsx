import React, { useState, useCallback } from 'react'
import { Calendar, Flex, Space, Grid, Spin, Button, Card, Select, Radio, Typography } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { Event } from '../../types'
import { useCalendarEvents } from '../../hooks/useCalendarEvents'
import WeekView from './WeekView'
import EventModal from './EventModal'

dayjs.extend(utc)
dayjs.extend(timezone)

const { useBreakpoint } = Grid

const CalendarViewer: React.FC = () => {
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month')
  const [calendarType, setCalendarType] = useState<'month' | 'year'>('month')
  const [currentWeek, setCurrentWeek] = useState(dayjs())
  const screens = useBreakpoint()
  
  const isLargeScreen = screens.xl // xl breakpoint is 1200px

  const {
    events,
    loading,
    getEventsForDate,
    getEventColor,
    getShowAsDisplay,
    userTimezone
  } = useCalendarEvents()


  const formatEventTime = (startDate: string, endDate?: string, isAllDay?: boolean) => {
    if (isAllDay) return ''
    
    const timezone = userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    const start = dayjs.utc(startDate).tz(timezone)
    
    return start.format('h:mmA')
  }

  const getEventBackgroundColor = (showAs: string) => {
    switch (showAs) {
      case 'busy': return '#1890ff'
      case 'tentative': return '#faad14'
      case 'oof': return '#ff4d4f'
      case 'free': return '#52c41a'
      case 'workingElsewhere': return '#722ed1'
      default: return '#8c8c8c'
    }
  }

  const cellRender = useCallback((current: Dayjs, info: any) => {
    const dayEvents = getEventsForDate(current)
    
    if (dayEvents.length === 0) return null

    // For small screens, show only event count
    if (!isLargeScreen) {
      return (
        <Flex justify="center" align="center" style={{ height: '100%' }}>
          <div
            onClick={(e) => {
              e.stopPropagation()
              setSelectedEvent(dayEvents[0])
              setIsModalVisible(true)
            }}
            style={{
              width: '20px',
              height: '20px',
              borderRadius: '50%',
              backgroundColor: 'rgba(140, 140, 140, 0.9)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              fontWeight: '600',
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(0,0,0,0.15)'
            }}
            title={`${dayEvents.length} event${dayEvents.length > 1 ? 's' : ''} on this day`}
          >
            {dayEvents.length}
          </div>
        </Flex>
      )
    }

    // For large screens, show simplified event list
    const eventsToShow = dayEvents.length <= 4 ? dayEvents.length : 3
    const hasMoreEvents = dayEvents.length > 4

    return (
      <Space direction="vertical" size={1} style={{ width: '100%' }}>
        {dayEvents.slice(0, eventsToShow).map((event, index) => {
          const eventTime = formatEventTime(event.start_date, event.end_date, event.is_all_day)
          const displayText = eventTime ? `${eventTime} ${event.title}` : event.title
          
          return (
            <div
              key={`${event.id}-${index}`}
              onClick={(e) => {
                e.stopPropagation()
                setSelectedEvent(event)
                setIsModalVisible(true)
              }}
              title={`${event.title} - ${getShowAsDisplay(event.show_as)}`}
              style={{
                fontSize: '10px',
                padding: '1px 3px',
                borderRadius: '2px',
                backgroundColor: getEventBackgroundColor(event.show_as),
                color: '#fff',
                cursor: 'pointer',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                lineHeight: '1.3',
                minHeight: '14px',
                boxShadow: '0 1px 1px rgba(0,0,0,0.15)',
                fontWeight: '500',
                border: '1px solid rgba(255,255,255,0.2)',
                width: '100%'
              }}
            >
              {displayText}
            </div>
          )
        })}
        {hasMoreEvents && (
          <div
            onClick={(e) => {
              e.stopPropagation()
              setSelectedEvent(dayEvents[0])
              setIsModalVisible(true)
            }}
            style={{
              fontSize: '9px',
              padding: '1px 3px',
              borderRadius: '2px',
              backgroundColor: 'rgba(140, 140, 140, 0.9)',
              color: '#fff',
              cursor: 'pointer',
              textAlign: 'center',
              lineHeight: '1.3',
              minHeight: '12px',
              fontWeight: '500',
              width: '100%'
            }}
          >
            +{dayEvents.length - 3} more
          </div>
        )}
      </Space>
    )
  }, [getEventsForDate, isLargeScreen, formatEventTime, getShowAsDisplay, getEventBackgroundColor])

  const monthCellRender = useCallback((value: Dayjs) => {
    const startOfMonth = value.startOf('month')
    const endOfMonth = value.endOf('month')
    
    // Count events in this month
    let eventCount = 0
    let currentDate = startOfMonth
    while (currentDate.isSame(endOfMonth, 'day') || currentDate.isBefore(endOfMonth, 'day')) {
      const dayEvents = getEventsForDate(currentDate)
      eventCount += dayEvents.length
      currentDate = currentDate.add(1, 'day')
    }
    
    if (eventCount === 0) return null
    
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        width: '100%'
      }}>
        <div style={{
          backgroundColor: '#1890ff',
          color: 'white',
          borderRadius: '50%',
          width: '24px',
          height: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          fontWeight: 'bold'
        }}>
          {eventCount}
        </div>
      </div>
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
        <div style={{ color: '#666', fontSize: '16px' }}>Loading events...</div>
      </Flex>
    )
  }

  return (
    <Flex vertical className="calendar-container-responsive" style={{ width: '100%' }}>
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Calendar View</h2>
      </Flex>
      
      <Flex flex={1} style={{ overflow: 'hidden', width: '100%' }}>
        {viewMode === 'month' ? (
          <Calendar
            cellRender={(current, info) => {
              if (calendarType === 'month') {
                return cellRender(current, info)
              } else if (calendarType === 'year' && info.type === 'month') {
                return monthCellRender(current)
              }
              return null
            }}
            style={{ width: '100%' }}
            fullscreen={true}
            headerRender={({ value, type, onChange, onTypeChange }) => {
              const start = 0
              const end = 12
              const monthOptions = []
              
              const current = value.clone()
              const localeData = value.localeData()
              const months = []
              for (let i = 0; i < 12; i++) {
                current.month(i)
                months.push(localeData.monthsShort(current))
              }
              
              for (let i = start; i < end; i++) {
                monthOptions.push(
                  <Button key={i} 
                    size="small"
                    onClick={() => {
                      const newValue = value.clone().month(i)
                      onChange(newValue)
                    }}
                    type={value.month() === i ? 'primary' : 'default'}
                  >
                    {months[i]}
                  </Button>
                )
              }
              
              const year = value.year()
              const yearOptions = []
              for (let i = year - 10; i < year + 10; i += 1) {
                yearOptions.push(
                  <Button key={i}
                    size="small"
                    onClick={() => {
                      const newValue = value.clone().year(i)
                      onChange(newValue)
                    }}
                    type={value.year() === i ? 'primary' : 'default'}
                  >
                    {i}
                  </Button>
                )
              }
              
              return (
                <div className="ant-picker-calendar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 12px' }}>
                  <div className="ant-picker-calendar-header-value">
                    <Space>
                      <LeftOutlined 
                        onClick={() => onChange(value.clone().subtract(1, type === 'month' ? 'month' : 'year'))}
                      />
                      {type === 'month' ? (
                        <Space>
                          <Select
                            value={value.month()}
                            onChange={(month) => onChange(value.clone().month(month))}
                            size="middle"
                          >
                            {Array.from({ length: 12 }, (_, i) => (
                              <Select.Option key={i} value={i}>
                                {dayjs().month(i).format('MMM')}
                              </Select.Option>
                            ))}
                          </Select>
                          <Select
                            value={value.year()}
                            onChange={(year) => onChange(value.clone().year(year))}
                            size="middle"
                          >
                            {Array.from({ length: 20 }, (_, i) => value.year() - 10 + i).map((year) => (
                              <Select.Option key={year} value={year}>
                                {year}
                              </Select.Option>
                            ))}
                          </Select>
                        </Space>
                      ) : (
                        <Select
                          value={value.year()}
                          onChange={(year) => onChange(value.clone().year(year))}
                          size="middle"
                        >
                          {Array.from({ length: 20 }, (_, i) => value.year() - 10 + i).map((year) => (
                            <Select.Option key={year} value={year}>
                              {year}
                            </Select.Option>
                          ))}
                        </Select>
                      )}
                      <RightOutlined 
                        onClick={() => onChange(value.clone().add(1, type === 'month' ? 'month' : 'year'))}
                      />
                    </Space>
                  </div>
                  <div className="ant-picker-calendar-header-view">
                    <Radio.Group 
                      block 
                      buttonStyle="solid"
                      onChange={(e) => {
                        const selectedValue = e.target.value
                        if (selectedValue === 'Week') {
                          setViewMode('week')
                        } else if (selectedValue === 'Month') {
                          setViewMode('month')
                          setCalendarType('month')
                          onTypeChange('month')
                        } else if (selectedValue === 'Year') {
                          setViewMode('month')
                          setCalendarType('year')
                          onTypeChange('year')
                        }
                      }}
                      options={[
                        { label: 'Week', value: 'Week' },
                        { label: 'Month', value: 'Month' },
                        { label: 'Year', value: 'Year' }
                      ]} 
                      defaultValue="Month" 
                      optionType="button"
                    />
                  </div>
                </div>
              )
            }}
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
            userTimezone={userTimezone}
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

export default CalendarViewer