import React, { useState, useCallback, useMemo, useEffect, useTransition } from 'react'
import { Calendar, Modal, Descriptions, Tag, Flex, Space, Grid, Spin, Button, Card, Select, Radio, Typography, theme } from 'antd'
import { EyeOutlined, CalendarOutlined, UnorderedListOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { Event } from '../types'
import { useCalendarEvents } from '../hooks/useCalendarEvents'

dayjs.extend(utc)
dayjs.extend(timezone)

const { useBreakpoint } = Grid

const CalendarViewer: React.FC = () => {
  const { token } = theme.useToken()
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month')
  const [calendarType, setCalendarType] = useState<'month' | 'year'>('month')
  const [currentWeek, setCurrentWeek] = useState(dayjs())
  const [isPending, startTransition] = useTransition()
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

  // Memoize overlap calculations for performance
  const dayOverlapMap = useMemo(() => {
    const startOfWeek = currentWeek.startOf('week')
    const days = Array.from({ length: 7 }, (_, i) => startOfWeek.add(i, 'day'))
    const map = new Map()
    
    days.forEach(day => {
      const dayEvents = getEventsForDate(day).filter(event => !event.is_all_day)
      const overlappingGroups = new Map()
      
      dayEvents.forEach(event => {
        const eventStart = dayjs.utc(event.start_date).tz(userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
        const eventEnd = event.end_date ? dayjs.utc(event.end_date).tz(userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone) : eventStart.add(1, 'hour')
        
        // Find overlapping events
        const overlapping = dayEvents.filter(otherEvent => {
          if (otherEvent.id === event.id) return false
          const otherStart = dayjs.utc(otherEvent.start_date).tz(userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
          const otherEnd = otherEvent.end_date ? dayjs.utc(otherEvent.end_date).tz(userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone) : otherStart.add(1, 'hour')
          
          return (eventStart.isBefore(otherEnd) && eventEnd.isAfter(otherStart))
        })
        
        const groupKey = [event, ...overlapping].map(e => e.id).sort().join(',')
        if (!overlappingGroups.has(groupKey)) {
          overlappingGroups.set(groupKey, [event, ...overlapping].sort((a, b) => {
            const aStart = dayjs.utc(a.start_date).tz(userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
            const bStart = dayjs.utc(b.start_date).tz(userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
            return aStart.isBefore(bStart) ? -1 : 1
          }))
        }
      })
      
      map.set(day.format('YYYY-MM-DD'), overlappingGroups)
    })
    
    return map
  }, [currentWeek, getEventsForDate, userTimezone])


  const renderWeekView = () => {
    const startOfWeek = currentWeek.startOf('week')
    const days = Array.from({ length: 7 }, (_, i) => startOfWeek.add(i, 'day'))
    
    // Generate time slots in 5-minute increments for full 24 hours
    const timeSlots = []
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += 5) {
        const time = dayjs().hour(hour).minute(minute).second(0)
        timeSlots.push({
          time: time.format('H:mm'),
          display: time.format('h:mm A'),
          showLabel: minute % 15 === 0 // Only show time labels every 15 minutes
        })
      }
    }
    
    // Find the index for 7:00 AM to scroll to
    const sevenAmIndex = timeSlots.findIndex(slot => slot.time === '7:00')
    
    return (
      <div>
        <div className="ant-picker-calendar-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 12px', marginBottom: 16 }}>
          <div className="ant-picker-calendar-header-value">
            <Space>
              <LeftOutlined 
                onClick={() => {
                  startTransition(() => {
                    setCurrentWeek(currentWeek.subtract(1, 'week'))
                  })
                }}
              />
              <Typography.Text strong>
                {startOfWeek.format('MMM D')} - {startOfWeek.add(6, 'day').format('MMM D, YYYY')}
              </Typography.Text>
              <RightOutlined 
                onClick={() => {
                  startTransition(() => {
                    setCurrentWeek(currentWeek.add(1, 'week'))
                  })
                }}
              />
            </Space>
          </div>
          <div className="ant-picker-calendar-header-view">
            <Radio.Group 
              value="Week"
              block 
              buttonStyle="solid"
              onChange={(e) => {
                const selectedValue = e.target.value
                if (selectedValue === 'Week') {
                  setViewMode('week')
                } else if (selectedValue === 'Month') {
                  setViewMode('month')
                  setCalendarType('month')
                } else if (selectedValue === 'Year') {
                  setViewMode('month')
                  setCalendarType('year')
                }
              }}
              options={[
                { label: 'Week', value: 'Week' },
                { label: 'Month', value: 'Month' },
                { label: 'Year', value: 'Year' }
              ]} 
              defaultValue="Week" 
              optionType="button"
            />
          </div>
        </div>
        
        <div style={{ 
          flex: 1,
          height: 'calc(100vh - 200px)',
          overflow: 'auto',
          border: `1px solid ${token.colorBorder}`,
          backgroundColor: token.colorBgContainer,
          position: 'relative'
        }}>
          {isPending && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(255, 255, 255, 0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000
            }}>
              <Spin size="large" />
            </div>
          )}
          <table 
            style={{ 
              width: '100%',
              borderCollapse: 'separate',
              borderSpacing: '0',
              tableLayout: 'fixed'
            }}
            ref={(el) => {
              if (el && sevenAmIndex > 0) {
                // Scroll to 7 AM, accounting for sticky header (5-minute rows at 13.33px each)
                const scrollTop = (sevenAmIndex * 13.33)
                el.parentElement?.scrollTo({ top: scrollTop, behavior: 'smooth' })
              }
            }}
          >
            <thead style={{ position: 'sticky', top: -1, zIndex: 10, backgroundColor: token.colorBgContainer }}>
              <tr>
                <th style={{ 
                  width: '80px',
                  height: '60px',
                  padding: '8px', 
                  border: `1px solid ${token.colorBorder}`,
                  backgroundColor: token.colorFillAlter,
                  textAlign: 'center'
                }}>
                  <Typography.Text strong style={{ fontSize: '12px' }}>Time</Typography.Text>
                </th>
                {days.map(day => {
                  const isToday = day.isSame(dayjs(), 'day')
                  return (
                    <th 
                      key={`header-${day.format('YYYY-MM-DD')}`}
                      style={{ 
                        height: '60px',
                        padding: '8px', 
                        border: `1px solid ${token.colorBorder}`,
                        backgroundColor: isToday ? token.colorPrimaryBg : token.colorFillAlter,
                        textAlign: 'center'
                      }}
                    >
                      <Typography.Text strong style={{ fontSize: '12px' }}>{day.format('ddd')}</Typography.Text>
                      <div style={{ marginTop: '2px' }}>
                        <Typography.Text style={{ fontSize: '14px' }}>{day.format('M/D')}</Typography.Text>
                      </div>
                    </th>
                  )
                })}
              </tr>
              {/* All-day events in header */}
              {(() => {
                // Get all all-day events for the week
                const allDayEvents = []
                days.forEach(day => {
                  const dayEvents = getEventsForDate(day).filter(event => event.is_all_day)
                  dayEvents.forEach(event => {
                    const eventStart = dayjs.utc(event.start_date).tz(userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
                    const eventEnd = event.end_date ? dayjs.utc(event.end_date).tz(userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone) : eventStart
                    
                    // Check if this event is already in our list (to avoid duplicates for multi-day events)
                    if (!allDayEvents.find(e => e.id === event.id)) {
                      const eventWithDays = {
                        ...event,
                        startDay: eventStart.startOf('day'),
                        endDay: eventEnd.startOf('day')
                      }
                      allDayEvents.push(eventWithDays)
                    }
                  })
                })

                // Group overlapping all-day events into rows
                const eventRows = []
                allDayEvents.forEach(event => {
                  let placed = false
                  for (let rowIndex = 0; rowIndex < eventRows.length; rowIndex++) {
                    const row = eventRows[rowIndex]
                    const hasConflict = row.some(existingEvent => {
                      return (event.startDay.isBefore(existingEvent.endDay.add(1, 'day')) && 
                              event.endDay.add(1, 'day').isAfter(existingEvent.startDay))
                    })
                    
                    if (!hasConflict) {
                      row.push(event)
                      placed = true
                      break
                    }
                  }
                  
                  if (!placed) {
                    eventRows.push([event])
                  }
                })

                return eventRows.map((row, rowIndex) => (
                  <tr key={`all-day-row-${rowIndex}`} style={{ height: '30px' }}>
                    <th style={{
                      width: '80px',
                      height: '30px',
                      padding: '4px 8px',
                      borderTop: rowIndex === 0 ? `1px solid ${token.colorBorder}` : 'none',
                      borderBottom: rowIndex === eventRows.length - 1 ? `1px solid ${token.colorBorder}` : 'none',
                      borderLeft: `1px solid ${token.colorBorder}`,
                      borderRight: `1px solid ${token.colorBorder}`,
                      backgroundColor: token.colorFillAlter,
                      textAlign: 'right',
                      verticalAlign: 'middle'
                    }}>
                      {rowIndex === 0 && (
                        <Typography.Text type="secondary" style={{ fontSize: '10px' }}>
                          All Day
                        </Typography.Text>
                      )}
                    </th>
                    
                    {days.map((day, dayIndex) => {
                      // Find events that should render in this day column
                      const eventsToRender = row.filter(event => {
                        const weekStart = days[0]
                        const weekEnd = days[6]
                        
                        // Check if this event overlaps with the current week
                        const eventOverlapsWeek = (event.startDay.isSame(weekEnd, 'day') || event.startDay.isBefore(weekEnd, 'day')) && 
                                                 (event.endDay.isSame(weekStart, 'day') || event.endDay.isAfter(weekStart, 'day'))
                        
                        if (!eventOverlapsWeek) return false
                        
                        // For events that start before the week, render on Sunday (day 0)
                        // For events that start within the week, render on their start day
                        const eventStartInWeek = event.startDay.isBefore(weekStart) ? weekStart : event.startDay
                        const startDayIndex = days.findIndex(d => d.isSame(eventStartInWeek, 'day'))
                        
                        
                        // Only render on the first day of the event span within this week
                        return startDayIndex === dayIndex
                      })
                      
                      return (
                        <th
                          key={`${day.format('YYYY-MM-DD')}-all-day-${rowIndex}`}
                          style={{
                            height: '30px',
                            padding: '2px',
                            borderTop: rowIndex === 0 ? `1px solid ${token.colorBorder}` : 'none',
                            borderBottom: rowIndex === eventRows.length - 1 ? `1px solid ${token.colorBorder}` : 'none',
                            borderLeft: dayIndex === 0 ? `1px solid ${token.colorBorder}` : 'none',
                            borderRight: dayIndex === 6 ? `1px solid ${token.colorBorder}` : 'none',
                            backgroundColor: token.colorBgContainer,
                            verticalAlign: 'middle',
                            position: 'relative'
                          }}
                        >
                          {eventsToRender.map(event => {
                            // Calculate how many days this event spans within the current week
                            const weekStart = days[0]
                            const weekEnd = days[6]
                            const eventStartInWeek = event.startDay.isBefore(weekStart) ? weekStart : event.startDay
                            const eventEndInWeek = event.endDay.isAfter(weekEnd) ? weekEnd : event.endDay
                            
                            // Calculate position and width
                            const startDayIndex = days.findIndex(d => d.isSame(eventStartInWeek, 'day'))
                            const endDayIndex = days.findIndex(d => d.isSame(eventEndInWeek, 'day'))
                            const spanDays = endDayIndex - startDayIndex + 1
                            
                            
                            // Calculate width to span across multiple columns
                            const columnWidth = 100 // each column is 100% of its container
                            const totalWidth = `calc(${spanDays * columnWidth}% + ${(spanDays - 1)}px)` // Account for borders
                            
                            
                            return (
                              <div
                                key={event.id}
                                onClick={() => {
                                  setSelectedEvent(event)
                                  setIsModalVisible(true)
                                }}
                                style={{
                                  position: 'absolute',
                                  top: '3px',
                                  left: '2px',
                                  width: spanDays > 1 ? totalWidth : 'calc(100% - 4px)',
                                  height: '24px',
                                  fontSize: '11px',
                                  padding: '4px 6px',
                                  borderRadius: '3px',
                                  backgroundColor: getEventBackgroundColor(event.show_as),
                                  color: '#fff',
                                  cursor: 'pointer',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  zIndex: 5,
                                  border: '1px solid rgba(255,255,255,0.3)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  boxSizing: 'border-box'
                                }}
                                title={event.title}
                              >
                                {event.title}
                              </div>
                            )
                          })}
                        </th>
                      )
                    })}
                  </tr>
                ))
              })()}
            </thead>
            <tbody>
              {timeSlots.map((timeSlot, index) => (
                <tr key={timeSlot.time}>
                  {timeSlot.showLabel && (
                    <td 
                      rowSpan={3}
                      style={{ 
                        width: '80px',
                        height: '40px',
                        padding: '2px 8px',
                        border: `1px solid ${token.colorBorder}`,
                        backgroundColor: token.colorFillAlter,
                        textAlign: 'right',
                        verticalAlign: 'top'
                      }}
                    >
                      <Typography.Text type="secondary" style={{ fontSize: '10px' }}>
                        {timeSlot.display}
                      </Typography.Text>
                    </td>
                  )}
                  
                  {days.map(day => {
                    const dayEvents = getEventsForDate(day)
                    const timeSlotEvents = dayEvents.filter(event => {
                      if (event.is_all_day) return false
                      const eventStart = dayjs.utc(event.start_date).tz(userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
                      const slotTime = day.hour(parseInt(timeSlot.time.split(':')[0])).minute(parseInt(timeSlot.time.split(':')[1]))
                      return eventStart.hour() === slotTime.hour() && Math.floor(eventStart.minute() / 5) === Math.floor(slotTime.minute() / 5)
                    })
                    
                    // Get pre-calculated overlapping groups for this day
                    const overlappingGroups = dayOverlapMap.get(day.format('YYYY-MM-DD')) || new Map()
                    
                    return (
                      <td 
                        key={`${day.format('YYYY-MM-DD')}-${timeSlot.time}`}
                        style={{ 
                          height: '13.33px',
                          padding: '0', 
                          borderLeft: `1px solid ${token.colorBorder}`,
                          borderRight: `1px solid ${token.colorBorder}`,
                          borderTop: (parseInt(timeSlot.time.split(':')[1]) % 15 === 0) ? `1px solid ${token.colorBorder}` : '0',
                          borderBottom: '0',
                          backgroundColor: token.colorBgContainer,
                          verticalAlign: 'top',
                          position: 'relative'
                        }}
                      >
                        {timeSlotEvents.map((event, index) => {
                          const eventStart = dayjs.utc(event.start_date).tz(userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
                          const eventEnd = event.end_date ? dayjs.utc(event.end_date).tz(userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone) : eventStart.add(1, 'hour')
                          
                          // Calculate duration in 5-minute slots
                          const durationMinutes = eventEnd.diff(eventStart, 'minute')
                          const slots = Math.max(1, Math.ceil(durationMinutes / 5))
                          const height = (slots * 13.33) - 2 // 13.33px per slot minus border/padding
                          
                          // Find this event's overlapping group (already sorted)
                          let eventGroup = []
                          let eventIndex = 0
                          for (const [groupKey, group] of overlappingGroups) {
                            if (group.find(e => e.id === event.id)) {
                              eventGroup = group
                              eventIndex = eventGroup.findIndex(e => e.id === event.id)
                              break
                            }
                          }
                          
                          const totalOverlapping = eventGroup.length
                          const width = totalOverlapping > 1 ? `${100 / totalOverlapping}%` : 'calc(100% - 4px)'
                          const leftOffset = totalOverlapping > 1 ? `${(eventIndex * 100) / totalOverlapping}%` : '2px'
                          
                          return (
                            <div
                              key={`${event.id}-${index}`}
                              onClick={() => {
                                setSelectedEvent(event)
                                setIsModalVisible(true)
                              }}
                              style={{
                                position: 'absolute',
                                top: '1px',
                                left: leftOffset,
                                width: width,
                                height: `${height}px`,
                                fontSize: '10px',
                                padding: '2px 4px',
                                borderRadius: '2px',
                                backgroundColor: getEventBackgroundColor(event.show_as),
                                color: '#fff',
                                cursor: 'pointer',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                zIndex: 5,
                                border: '1px solid rgba(255,255,255,0.2)'
                              }}
                              title={`${event.title} (${eventStart.format('h:mm A')} - ${eventEnd.format('h:mm A')})`}
                            >
                              <div style={{ fontWeight: 'bold', fontSize: '9px' }}>
                                {eventStart.format('h:mm A')}
                              </div>
                              <div style={{ marginTop: '1px' }}>
                                {event.title}
                              </div>
                            </div>
                          )
                        })}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const formatEventDateTime = (startDate: string, endDate?: string, isAllDay?: boolean) => {
    // Use userTimezone from hook, fallback to browser timezone if not available
    const timezone = userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    // Assume the stored date is in UTC and convert to user timezone
    const start = dayjs.utc(startDate).tz(timezone)
    const end = endDate ? dayjs.utc(endDate).tz(timezone) : start
    
    if (isAllDay) {
      if (start.isSame(end, 'day')) {
        return start.format('MMMM D, YYYY')
      } else {
        return `${start.format('MMMM D')} - ${end.format('MMMM D, YYYY')}`
      }
    } else {
      if (start.isSame(end, 'day')) {
        return `${start.format('MMMM D, YYYY')} ${start.format('h:mm A')} - ${end.format('h:mm A')} (${userTimezone})`
      } else {
        return `${start.format('MMMM D, YYYY h:mm A')} - ${end.format('MMMM D, YYYY h:mm A')} (${userTimezone})`
      }
    }
  }

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
          renderWeekView()
        )}
      </Flex>

      <Modal
        title="Event Details"
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
      >
        {selectedEvent && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Title">
              {selectedEvent.title}
            </Descriptions.Item>
            
            <Descriptions.Item label="Date & Time">
              {formatEventDateTime(
                selectedEvent.start_date, 
                selectedEvent.end_date, 
                selectedEvent.is_all_day
              )}
            </Descriptions.Item>
            
            <Descriptions.Item label="Status">
              <Tag color={getEventColor(selectedEvent.show_as) === 'processing' ? 'blue' : 
                         getEventColor(selectedEvent.show_as) === 'warning' ? 'orange' :
                         getEventColor(selectedEvent.show_as) === 'error' ? 'red' : 'green'}>
                {getShowAsDisplay(selectedEvent.show_as)}
              </Tag>
            </Descriptions.Item>
            
            {selectedEvent.location && (
              <Descriptions.Item label="Location">
                {selectedEvent.location}
              </Descriptions.Item>
            )}

            {selectedEvent.organizer && (
              <Descriptions.Item label="Organizer">
                {(() => {
                  try {
                    const organizer = JSON.parse(selectedEvent.organizer)
                    return `${organizer.name} (${organizer.email})`
                  } catch {
                    return selectedEvent.organizer
                  }
                })()}
              </Descriptions.Item>
            )}

            {selectedEvent.attendees && (
              <Descriptions.Item label="Attendees">
                {(() => {
                  try {
                    const attendees = JSON.parse(selectedEvent.attendees)
                    return (
                      <Space direction="vertical" size="small">
                        {attendees.map((att: any, index: number) => (
                          <Tag 
                            key={index}
                            color={
                              att.response === 'accepted' ? 'green' :
                              att.response === 'declined' ? 'red' :
                              att.response === 'tentative' ? 'orange' : 'default'
                            }
                          >
                            {att.name} ({att.email}) - {att.response}
                          </Tag>
                        ))}
                      </Space>
                    )
                  } catch {
                    return selectedEvent.attendees
                  }
                })()}
              </Descriptions.Item>
            )}
            
            {selectedEvent.categories && selectedEvent.categories.trim() && (
              <Descriptions.Item label="Categories">
                <Space size="small" wrap>
                  {selectedEvent.categories.split(',').map(cat => cat.trim()).filter(cat => cat).map(category => (
                    <Tag key={category}>
                      {category}
                    </Tag>
                  ))}
                </Space>
              </Descriptions.Item>
            )}
            
            
            {selectedEvent.synced_at && (
              <Descriptions.Item label="Last Synced">
                {dayjs(selectedEvent.synced_at).tz(userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone).format('MMMM D, YYYY h:mm A')}
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>
    </Flex>
  )
}

export default CalendarViewer