import React, { useMemo, useTransition, memo, useState } from 'react'
import { Typography, theme, Radio, Space, Spin, Button, DatePicker } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { Event } from '../../types'

// Extended event type with pre-processed timezone data
interface ProcessedEvent extends Event {
  processedStart?: Dayjs
  processedEnd?: Dayjs
  startHour?: number
  startMinute?: number
}

// Generate time slots more efficiently without dayjs in module scope
const TIME_SLOTS = (() => {
  const slots = []
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 5) {
      const timeStr = `${hour}:${minute.toString().padStart(2, '0')}`
      const display24 = hour === 0 ? '12' : hour > 12 ? (hour - 12).toString() : hour.toString()
      const ampm = hour < 12 ? 'AM' : 'PM'
      const displayMinute = minute === 0 ? '00' : minute.toString()
      
      slots.push({
        time: timeStr,
        display: `${display24}:${displayMinute} ${ampm}`,
        showLabel: minute % 15 === 0
      })
    }
  }
  return slots
})()

// Pre-calculate the 7:00 AM index for scrolling  
const SEVEN_AM_INDEX = TIME_SLOTS.findIndex(slot => slot.time === '7:00')

const { Text } = Typography

interface WeekViewProps {
  currentWeek: Dayjs
  setCurrentWeek: (week: Dayjs) => void
  setViewMode: (mode: 'month' | 'week') => void
  setCalendarType: (type: 'month' | 'year') => void
  getEventsForDate: (date: Dayjs) => Event[]
  getEventBackgroundColor: (showAs: string) => string
  setSelectedEvent: (event: Event) => void
  setIsModalVisible: (visible: boolean) => void
  userTimezone: string
}

const WeekView: React.FC<WeekViewProps> = memo(({
  currentWeek,
  setCurrentWeek,
  setViewMode,
  setCalendarType,
  getEventsForDate,
  getEventBackgroundColor,
  setSelectedEvent,
  setIsModalVisible,
  userTimezone
}) => {
  const { token } = theme.useToken()
  const [isPending, startTransition] = useTransition()

  // Memoize days array to prevent unnecessary recalculations
  const days = useMemo(() => {
    const startOfWeek = currentWeek.startOf('week')
    return Array.from({ length: 7 }, (_, i) => startOfWeek.add(i, 'day'))
  }, [currentWeek])

  // Pre-process events for the week with memoization
  const weekEvents = useMemo(() => {
    const events = new Map()
    const timeSlotMap = new Map()
    
    days.forEach(day => {
      const dayKey = day.format('YYYY-MM-DD')
      const dayEvents = getEventsForDate(day)
      
      // Separate all-day and timed events
      const allDayEvents = dayEvents.filter(event => event.is_all_day)
      const timedEvents = dayEvents.filter(event => !event.is_all_day)
      
      // Pre-convert all timed events to user timezone once
      const processedTimedEvents = timedEvents.map(event => {
        const eventStart = dayjs.utc(event.start_date).tz(userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
        const eventEnd = event.end_date ? dayjs.utc(event.end_date).tz(userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone) : eventStart.add(1, 'hour')
        
        return {
          ...event,
          processedStart: eventStart,
          processedEnd: eventEnd,
          startHour: eventStart.hour(),
          startMinute: Math.floor(eventStart.minute() / 5) * 5 // Round to 5-minute intervals
        }
      })
      
      events.set(dayKey, {
        allDay: allDayEvents,
        timed: processedTimedEvents
      })
      
      // Create time slot lookup for fast access
      const slotLookup = new Map()
      processedTimedEvents.forEach(event => {
        const slotKey = `${event.startHour}:${event.startMinute.toString().padStart(2, '0')}`
        if (!slotLookup.has(slotKey)) {
          slotLookup.set(slotKey, [])
        }
        slotLookup.get(slotKey).push(event)
      })
      
      timeSlotMap.set(dayKey, slotLookup)
    })
    
    return { events, timeSlotMap }
  }, [days, getEventsForDate, userTimezone])

  // Simple overlap map without complex calculations - just assign each event to its own group
  const dayOverlapMap = useMemo(() => {
    const map = new Map()
    
    days.forEach(day => {
      const dayKey = day.format('YYYY-MM-DD')
      const dayEvents = weekEvents.events.get(dayKey)?.timed || []
      
      // Simple grouping - each event in its own group for now (no overlap calculation)
      const eventsMap = new Map()
      dayEvents.forEach((event: ProcessedEvent) => {
        eventsMap.set(event.id, [event])
      })
      
      map.set(dayKey, eventsMap)
    })
    
    return map
  }, [days, weekEvents])

  // Remove the useState and useEffect for calculating overlap
  const [isCalculating] = useState(false)


  return (
    <div style={{ 
      backgroundColor: token.colorBgContainer,
      position: 'relative'
    }}>
      {/* Show loading overlay while calculating events */}
      {(isPending || isCalculating) && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: token.colorBgMask,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <Spin size="large" />
        </div>
      )}
      {/* Week Header */}
      <div className="ant-picker-calendar-header" style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        padding: '8px 12px',
        backgroundColor: token.colorBgContainer,
        borderBottom: `1px solid ${token.colorBorder}`
      }}>
        <div className="ant-picker-calendar-header-value">
          <Space>
            <Button
              loading={isPending}
              onClick={() => {
                startTransition(() => {
                  setCurrentWeek(dayjs())
                })
              }}
              title="Go to today"
            >
              Today
            </Button>
            <Button
              icon={<LeftOutlined />}
              loading={isPending}
              onClick={() => {
                startTransition(() => {
                  setCurrentWeek(currentWeek.subtract(1, 'week'))
                })
              }}
              title="Previous week"
            />
            <DatePicker 
              value={currentWeek}
              onChange={(date) => {
                if (date) {
                  startTransition(() => {
                    setCurrentWeek(date)
                  })
                }
              }}
              picker="week"
              allowClear={false}
              format={(value) => {
                const start = value.startOf('week')
                const end = value.endOf('week')
                return `${start.format('MMM D')} - ${end.format('MMM D, YYYY')}`
              }}
            />
            <Button
              icon={<RightOutlined />}
              loading={isPending}
              onClick={() => {
                startTransition(() => {
                  setCurrentWeek(currentWeek.add(1, 'week'))
                })
              }}
              title="Next week"
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
      
      {/* Week Grid */}
      <div style={{ 
        flex: 1,
        height: 'calc(100vh - 200px)',
        overflowY: 'auto',
        overflowX: 'hidden',
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
            tableLayout: 'fixed',
            borderBottom: `1px solid ${token.colorBorder}`
          }}
          ref={(el) => {
            if (el && SEVEN_AM_INDEX > 0) {
              // Scroll to 7 AM, accounting for sticky header (5-minute rows at 13.33px each)
              const scrollTop = (SEVEN_AM_INDEX * 13.33)
              el.parentElement?.scrollTo({ top: scrollTop, behavior: 'smooth' })
            }
          }}
        >
          <thead style={{ position: 'sticky', top: -1, zIndex: 10, backgroundColor: token.colorBgContainer }}>
            {/* Day Headers */}
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
              // Get all all-day events for the week from pre-processed data
              const allDayEvents: Array<Event & { startDay: Dayjs; endDay: Dayjs }> = []
              days.forEach(day => {
                const dayKey = day.format('YYYY-MM-DD')
                const dayEvents = weekEvents.events.get(dayKey)?.allDay || []
                dayEvents.forEach((event: Event) => {
                  // For all-day events, treat as calendar dates without timezone conversion
                  const eventStart = dayjs(event.start_date)
                  // For all-day events, Microsoft Graph sets end date to the day after, so subtract 1 day for proper display
                  const eventEnd = event.end_date ? dayjs(event.end_date).subtract(1, 'day') : eventStart
                  
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
              type EventWithDays = Event & { startDay: Dayjs; endDay: Dayjs }
              const eventRows: EventWithDays[][] = []
              allDayEvents.forEach((event: EventWithDays) => {
                let placed = false
                for (let rowIndex = 0; rowIndex < eventRows.length; rowIndex++) {
                  const row = eventRows[rowIndex]
                  const hasConflict = row.some((existingEvent: EventWithDays) => {
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
                    const eventsToRender = row.filter((event: EventWithDays) => {
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
                        {eventsToRender.map((event: EventWithDays) => {
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
          
          {/* Time Grid */}
          <tbody>
            {TIME_SLOTS.map((timeSlot) => (
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
                  const dayKey = day.format('YYYY-MM-DD')
                  // Use pre-processed time slot lookup for much faster access
                  const timeSlotLookup = weekEvents.timeSlotMap.get(dayKey) || new Map()
                  const timeSlotEvents = timeSlotLookup.get(timeSlot.time) || []
                  
                  // Get pre-calculated overlapping groups for this day
                  const overlappingGroups = dayOverlapMap.get(dayKey) || new Map()
                  
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
                      {timeSlotEvents.map((event: ProcessedEvent, index: number) => {
                        // Use pre-processed timezone-converted dates
                        const eventStart = event.processedStart
                        const eventEnd = event.processedEnd
                        
                        if (!eventStart || !eventEnd) return null
                        
                        // Calculate duration in 5-minute slots
                        const durationMinutes = eventEnd.diff(eventStart, 'minute')
                        const slots = Math.max(1, Math.ceil(durationMinutes / 5))
                        const height = (slots * 13.33) - 2 // 13.33px per slot minus border/padding
                        
                        // Find this event's overlapping group (already sorted)
                        let eventGroup: ProcessedEvent[] = []
                        let eventIndex = 0
                        for (const [, group] of overlappingGroups) {
                          if (group.find((e: ProcessedEvent) => e.id === event.id)) {
                            eventGroup = group
                            eventIndex = eventGroup.findIndex((e: ProcessedEvent) => e.id === event.id)
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
                            <Text style={{ fontWeight: 'bold', fontSize: '9px' }}>
                              {eventStart.format('h:mm A')}
                            </Text>
                            <Text style={{ marginTop: '2px', display: 'block' }}>
                              {event.title}
                            </Text>
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
})

WeekView.displayName = 'WeekView'

export default WeekView