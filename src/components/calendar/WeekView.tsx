import React, { useMemo, useTransition, useEffect, useRef, memo } from 'react'
import { Typography, theme, Radio, Space, Spin, Button, DatePicker, Tooltip } from 'antd'
import { LeftOutlined, RightOutlined, ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import minMax from 'dayjs/plugin/minMax'
import { Event, EventType } from '../../types'
import { useCurrentTime } from '../../hooks/useCurrentTime'
import { useZoom } from '../../hooks/useZoom'
import { HOURS, SCROLL_TO_HOUR, formatHour, layoutEvents } from '../../utils/calendarLayout'

dayjs.extend(minMax)

const { Text } = Typography

interface WeekViewProps {
  currentWeek: Dayjs
  setCurrentWeek: (week: Dayjs) => void
  setViewMode: (mode: 'month' | 'week' | 'day' | 'table') => void
  setCalendarType: (type: 'month' | 'year') => void
  getEventsForDate: (date: Dayjs) => Event[]
  getEventBackgroundColor: (showAs: string) => string
  getEventDisplayColor?: (event: Event) => string
  setSelectedEvent: (event: Event) => void
  setIsModalVisible: (visible: boolean) => void
  userTimezone: string
  eventTypes: EventType[]
}

const WeekView: React.FC<WeekViewProps> = memo(({
  currentWeek,
  setCurrentWeek,
  setViewMode,
  setCalendarType,
  getEventsForDate,
  getEventBackgroundColor,
  getEventDisplayColor,
  setSelectedEvent,
  setIsModalVisible,
  userTimezone,
  eventTypes
}) => {
  const { token } = theme.useToken()
  const [isPending, startTransition] = useTransition()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const hasScrolled = useRef(false)
  const { now, getTimePosition } = useCurrentTime()
  const { hourHeight, zoomIn, zoomOut, canZoomIn, canZoomOut } = useZoom(scrollContainerRef)

  const tz = userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone

  // Scroll to 7 AM on initial render and when week changes
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || hasScrolled.current) return

    const targetTop = SCROLL_TO_HOUR * hourHeight
    const tryScroll = () => {
      if (container.scrollHeight > container.clientHeight) {
        hasScrolled.current = true
        container.scrollTop = targetTop
      }
    }

    // Try immediately, then observe for when container gets its dimensions
    tryScroll()
    if (!hasScrolled.current) {
      const observer = new ResizeObserver(() => {
        tryScroll()
        if (hasScrolled.current) observer.disconnect()
      })
      observer.observe(container)
      return () => observer.disconnect()
    }
  }, [hourHeight])

  // Reset scroll flag when week changes
  useEffect(() => {
    hasScrolled.current = false
  }, [currentWeek])

  const days = useMemo(() => {
    const startOfWeek = currentWeek.startOf('week')
    return Array.from({ length: 7 }, (_, i) => startOfWeek.add(i, 'day'))
  }, [currentWeek])

  // Pre-process all events for the week
  const weekData = useMemo(() => {
    const result = new Map<string, {
      allDay: Array<Event & { startDay: Dayjs; endDay: Dayjs }>
      positioned: ReturnType<typeof layoutEvents>
    }>()

    const allDayEventsMap = new Map<string, Event & { startDay: Dayjs; endDay: Dayjs }>()

    days.forEach(day => {
      const dayKey = day.format('YYYY-MM-DD')
      const dayEvents = getEventsForDate(day)

      const allDayEvents = dayEvents.filter(e => e.is_all_day)
      const timedEvents = dayEvents.filter(e => !e.is_all_day)

      allDayEvents.forEach(event => {
        if (!allDayEventsMap.has(event.id)) {
          const eventStart = dayjs(event.start_date)
          const eventEnd = event.end_date ? dayjs(event.end_date).subtract(1, 'day') : eventStart
          allDayEventsMap.set(event.id, {
            ...event,
            startDay: eventStart.startOf('day'),
            endDay: eventEnd.startOf('day')
          })
        }
      })

      const processedEvents = timedEvents.map(event => {
        const localStart = dayjs.utc(event.start_date).tz(tz)
        const localEnd = event.end_date
          ? dayjs.utc(event.end_date).tz(tz)
          : localStart.add(1, 'hour')
        return { event, localStart, localEnd }
      }).filter(({ localStart, localEnd }) => {
        const dayStart = day.startOf('day')
        const dayEnd = day.endOf('day')
        return localStart.isBefore(dayEnd) && localEnd.isAfter(dayStart)
      })

      const positioned = layoutEvents(processedEvents, day, hourHeight)

      result.set(dayKey, {
        allDay: [],
        positioned
      })
    })

    const allDayEventsList = Array.from(allDayEventsMap.values())
    days.forEach(day => {
      const dayKey = day.format('YYYY-MM-DD')
      const dayData = result.get(dayKey)!
      dayData.allDay = allDayEventsList.filter(e =>
        (e.startDay.isSame(day, 'day') || e.startDay.isBefore(day, 'day')) &&
        (e.endDay.isSame(day, 'day') || e.endDay.isAfter(day, 'day'))
      )
    })

    return result
  }, [days, getEventsForDate, tz, hourHeight])

  // Layout all-day event rows for spanning
  const allDayRows = useMemo(() => {
    type EventWithDays = Event & { startDay: Dayjs; endDay: Dayjs }
    const uniqueEvents = new Map<string, EventWithDays>()

    days.forEach(day => {
      const dayKey = day.format('YYYY-MM-DD')
      const dayData = weekData.get(dayKey)
      dayData?.allDay.forEach(event => {
        if (!uniqueEvents.has(event.id)) {
          uniqueEvents.set(event.id, event)
        }
      })
    })

    const eventRows: EventWithDays[][] = []
    uniqueEvents.forEach(event => {
      let placed = false
      for (const row of eventRows) {
        const hasConflict = row.some(existing =>
          event.startDay.isBefore(existing.endDay.add(1, 'day')) &&
          event.endDay.add(1, 'day').isAfter(existing.startDay)
        )
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

    return eventRows
  }, [weekData, days])

  // Calculate billable hours
  const dailyBillableHours = useMemo(() => {
    const hoursMap = new Map<string, { hours: number; minutes: number; totalMinutes: number }>()

    days.forEach(day => {
      hoursMap.set(day.format('YYYY-MM-DD'), { hours: 0, minutes: 0, totalMinutes: 0 })
    })

    const allWeekEvents = new Set<Event>()
    days.forEach(day => {
      getEventsForDate(day).forEach(event => allWeekEvents.add(event))
    })

    allWeekEvents.forEach((event: Event) => {
      if (!event.type_id) return
      const eventType = eventTypes.find(t => t.id === event.type_id)
      if (!eventType?.is_billable || !event.end_date) return

      if (event.is_all_day) {
        const eventStart = dayjs(event.start_date)
        const eventEnd = dayjs(event.end_date).subtract(1, 'day')

        days.forEach(day => {
          const dayKey = day.format('YYYY-MM-DD')
          if ((day.isSame(eventStart, 'day') || day.isAfter(eventStart, 'day')) &&
              (day.isSame(eventEnd, 'day') || day.isBefore(eventEnd, 'day'))) {
            const current = hoursMap.get(dayKey)!
            const newTotal = current.totalMinutes + 1440
            hoursMap.set(dayKey, {
              hours: Math.floor(newTotal / 60),
              minutes: newTotal % 60,
              totalMinutes: newTotal
            })
          }
        })
      } else {
        const eventStart = dayjs.utc(event.start_date).tz(tz)
        const eventEnd = dayjs.utc(event.end_date).tz(tz)

        days.forEach(day => {
          const dayKey = day.format('YYYY-MM-DD')
          const dayStart = day.startOf('day')
          const dayEnd = day.endOf('day')

          const intersectionStart = dayjs.max(eventStart, dayStart)
          const intersectionEnd = dayjs.min(eventEnd, dayEnd)

          if (intersectionStart.isBefore(intersectionEnd)) {
            const mins = intersectionEnd.diff(intersectionStart, 'minute')
            const current = hoursMap.get(dayKey)!
            const newTotal = current.totalMinutes + mins
            hoursMap.set(dayKey, {
              hours: Math.floor(newTotal / 60),
              minutes: newTotal % 60,
              totalMinutes: newTotal
            })
          }
        })
      }
    })

    return hoursMap
  }, [days, getEventsForDate, eventTypes, tz])

  const today = dayjs()
  const currentTimeTop = getTimePosition(hourHeight)

  const getColor = (event: Event) =>
    getEventDisplayColor ? getEventDisplayColor(event) : getEventBackgroundColor(event.show_as)

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Loading overlay */}
      {isPending && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: token.colorBgMask,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000
        }}>
          <Spin size="large" />
        </div>
      )}

      {/* Week Header */}
      <div className="ant-picker-calendar-header" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px',
        backgroundColor: token.colorBgContainer,
        borderBottom: `1px solid ${token.colorBorder}`
      }}>
        <Space>
          <Button
            loading={isPending}
            onClick={() => startTransition(() => setCurrentWeek(dayjs()))}
            title="Go to today"
          >
            Today
          </Button>
          <Button
            icon={<LeftOutlined />}
            loading={isPending}
            onClick={() => startTransition(() => setCurrentWeek(currentWeek.subtract(1, 'week')))}
            title="Previous week"
          />
          <DatePicker
            value={currentWeek}
            onChange={(date) => {
              if (date) startTransition(() => setCurrentWeek(date))
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
            onClick={() => startTransition(() => setCurrentWeek(currentWeek.add(1, 'week')))}
            title="Next week"
          />
          <Tooltip title="Zoom out (Ctrl+Scroll down)">
            <Button
              icon={<ZoomOutOutlined />}
              onClick={zoomOut}
              disabled={!canZoomOut}
              size="small"
            />
          </Tooltip>
          <Tooltip title="Zoom in (Ctrl+Scroll up)">
            <Button
              icon={<ZoomInOutlined />}
              onClick={zoomIn}
              disabled={!canZoomIn}
              size="small"
            />
          </Tooltip>
        </Space>
        <Radio.Group
          value="Week"
          block
          buttonStyle="solid"
          onChange={(e) => {
            const v = e.target.value
            if (v === 'Week') setViewMode('week')
            else if (v === 'Day') setViewMode('day')
            else if (v === 'Table') setViewMode('table')
            else if (v === 'Month') { setViewMode('month'); setCalendarType('month') }
            else if (v === 'Year') { setViewMode('month'); setCalendarType('year') }
          }}
          options={[
            { label: 'Day', value: 'Day' },
            { label: 'Week', value: 'Week' },
            { label: 'Month', value: 'Month' },
            { label: 'Year', value: 'Year' },
            { label: 'Table', value: 'Table' }
          ]}
          optionType="button"
        />
      </div>

      {/* Scrollable content area */}
      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          backgroundColor: token.colorBgContainer,
          position: 'relative'
        }}
      >
        {/* Day column headers (sticky) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '80px repeat(7, 1fr)',
          position: 'sticky',
          top: 0,
          zIndex: 20,
          backgroundColor: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorder}`
        }}>
          {/* Time column header */}
          <div style={{
            padding: '8px',
            borderRight: `1px solid ${token.colorBorder}`,
            backgroundColor: token.colorFillAlter,
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Text strong style={{ fontSize: '12px' }}>Time</Text>
          </div>
          {/* Day headers */}
          {days.map(day => {
            const isToday = day.isSame(today, 'day')
            return (
              <div
                key={`header-${day.format('YYYY-MM-DD')}`}
                style={{
                  padding: '8px',
                  borderRight: `1px solid ${token.colorBorder}`,
                  backgroundColor: isToday ? token.colorPrimaryBg : token.colorFillAlter,
                  textAlign: 'center',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  startTransition(() => {
                    setCurrentWeek(day)
                    setViewMode('day')
                  })
                }}
                title="Click to view this day"
              >
                <Text strong style={{ fontSize: '12px' }}>{day.format('ddd')}</Text>
                <div style={{ marginTop: '2px' }}>
                  <Text style={{ fontSize: '14px' }}>{day.format('M/D')}</Text>
                </div>
              </div>
            )
          })}

          {/* All-day event rows */}
          {allDayRows.length > 0 && (
            <>
              {allDayRows.map((row, rowIndex) => (
                <React.Fragment key={`all-day-row-${rowIndex}`}>
                  <div style={{
                    padding: '4px 8px',
                    borderRight: `1px solid ${token.colorBorder}`,
                    borderBottom: rowIndex === allDayRows.length - 1 ? `1px solid ${token.colorBorder}` : 'none',
                    backgroundColor: token.colorFillAlter,
                    textAlign: 'right',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end'
                  }}>
                    {rowIndex === 0 && (
                      <Text type="secondary" style={{ fontSize: '10px' }}>All Day</Text>
                    )}
                  </div>
                  {days.map((day, dayIndex) => {
                    const weekStart = days[0]
                    const weekEnd = days[6]

                    const eventsToRender = row.filter(event => {
                      const eventOverlapsWeek =
                        (event.startDay.isSame(weekEnd, 'day') || event.startDay.isBefore(weekEnd, 'day')) &&
                        (event.endDay.isSame(weekStart, 'day') || event.endDay.isAfter(weekStart, 'day'))
                      if (!eventOverlapsWeek) return false

                      const eventStartInWeek = event.startDay.isBefore(weekStart) ? weekStart : event.startDay
                      const startDayIndex = days.findIndex(d => d.isSame(eventStartInWeek, 'day'))
                      return startDayIndex === dayIndex
                    })

                    return (
                      <div
                        key={`${day.format('YYYY-MM-DD')}-allday-${rowIndex}`}
                        style={{
                          height: '30px',
                          padding: '2px',
                          borderRight: `1px solid ${token.colorBorder}`,
                          borderBottom: rowIndex === allDayRows.length - 1 ? `1px solid ${token.colorBorder}` : 'none',
                          backgroundColor: token.colorBgContainer,
                          position: 'relative'
                        }}
                      >
                        {eventsToRender.map(event => {
                          const eventStartInWeek = event.startDay.isBefore(weekStart) ? weekStart : event.startDay
                          const eventEndInWeek = event.endDay.isAfter(weekEnd) ? weekEnd : event.endDay
                          const startIdx = days.findIndex(d => d.isSame(eventStartInWeek, 'day'))
                          const endIdx = days.findIndex(d => d.isSame(eventEndInWeek, 'day'))
                          const spanDays = endIdx - startIdx + 1

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
                                width: spanDays > 1 ? `calc(${spanDays * 100}% + ${spanDays - 1}px)` : 'calc(100% - 4px)',
                                height: '24px',
                                fontSize: '11px',
                                padding: '4px 6px',
                                borderRadius: '3px',
                                backgroundColor: getColor(event),
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
                      </div>
                    )
                  })}
                </React.Fragment>
              ))}
            </>
          )}
        </div>

        {/* Time grid body */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '80px repeat(7, 1fr)',
          position: 'relative'
        }}>
          {/* Time gutter */}
          <div style={{ position: 'relative' }}>
            {HOURS.map(hour => (
              <div
                key={`time-${hour}`}
                style={{
                  height: `${hourHeight}px`,
                  padding: '2px 8px',
                  borderRight: `1px solid ${token.colorBorder}`,
                  borderBottom: `1px solid ${token.colorBorder}`,
                  backgroundColor: token.colorFillAlter,
                  textAlign: 'right',
                  boxSizing: 'border-box'
                }}
              >
                <Text type="secondary" style={{ fontSize: '10px' }}>
                  {formatHour(hour)}
                </Text>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map(day => {
            const dayKey = day.format('YYYY-MM-DD')
            const isToday = day.isSame(today, 'day')
            const dayData = weekData.get(dayKey)
            const positioned = dayData?.positioned || []

            return (
              <div
                key={`col-${dayKey}`}
                style={{
                  position: 'relative',
                  height: `${24 * hourHeight}px`,
                  borderRight: `1px solid ${token.colorBorder}`
                }}
              >
                {/* Hour grid lines with quarter-hour subdivisions */}
                {HOURS.map(hour => (
                  <div
                    key={`grid-${hour}`}
                    style={{
                      position: 'absolute',
                      top: `${hour * hourHeight}px`,
                      left: 0,
                      right: 0,
                      height: `${hourHeight}px`,
                      borderBottom: `1px solid ${token.colorBorder}`,
                      boxSizing: 'border-box'
                    }}
                  >
                    <div style={{
                      position: 'absolute', top: '25%', left: 0, right: 0,
                      borderBottom: `1px dotted ${token.colorBorderSecondary}`
                    }} />
                    <div style={{
                      position: 'absolute', top: '50%', left: 0, right: 0,
                      borderBottom: `1px dashed ${token.colorBorderSecondary}`
                    }} />
                    <div style={{
                      position: 'absolute', top: '75%', left: 0, right: 0,
                      borderBottom: `1px dotted ${token.colorBorderSecondary}`
                    }} />
                  </div>
                ))}

                {/* Current time indicator */}
                {isToday && (
                  <div style={{
                    position: 'absolute',
                    top: `${currentTimeTop}px`,
                    left: 0, right: 0,
                    zIndex: 15,
                    pointerEvents: 'none'
                  }}>
                    <div style={{
                      position: 'absolute', left: -4, top: -4,
                      width: 8, height: 8,
                      borderRadius: '50%',
                      backgroundColor: '#f5222d'
                    }} />
                    <div style={{
                      height: '2px',
                      backgroundColor: '#f5222d',
                      width: '100%'
                    }} />
                  </div>
                )}

                {/* Events */}
                {positioned.map((event) => {
                  const colWidth = 100 / event.totalColumns
                  const left = event.column * colWidth
                  const width = colWidth
                  const zIndex = 5 + event.column

                  const startTime = event.localStart.format('h:mm A')
                  const endTime = event.localEnd.format('h:mm A')

                  return (
                    <div
                      key={event.id}
                      onClick={() => {
                        setSelectedEvent(event)
                        setIsModalVisible(true)
                      }}
                      style={{
                        position: 'absolute',
                        top: `${event.top}px`,
                        left: `${left}%`,
                        width: `${width}%`,
                        height: `${Math.max(event.height - 2, 14)}px`,
                        fontSize: '10px',
                        padding: '2px 4px',
                        borderRadius: '4px',
                        backgroundColor: getColor(event),
                        color: '#fff',
                        cursor: 'pointer',
                        overflow: 'hidden',
                        zIndex,
                        border: '1px solid rgba(255,255,255,0.2)',
                        boxSizing: 'border-box'
                      }}
                      title={`${event.title} (${startTime} - ${endTime})`}
                    >
                      <Text style={{ fontWeight: 'bold', fontSize: '9px', color: '#fff' }}>
                        {startTime}
                      </Text>
                      {event.height > 30 && (
                        <Text style={{ display: 'block', fontSize: '10px', color: '#fff' }}>
                          {event.title}
                        </Text>
                      )}
                      {event.height <= 30 && (
                        <Text style={{ marginLeft: '4px', fontSize: '10px', color: '#fff' }}>
                          {event.title}
                        </Text>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* Billable Hours Footer (sticky) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '80px repeat(7, 1fr)',
        borderTop: `1px solid ${token.colorBorder}`,
        backgroundColor: token.colorBgContainer,
        flexShrink: 0
      }}>
        <div style={{
          padding: '8px',
          borderRight: `1px solid ${token.colorBorder}`,
          backgroundColor: token.colorFillAlter,
          textAlign: 'center',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <Text strong style={{ fontSize: '12px' }}>Billable</Text>
        </div>
        {days.map((day, index) => {
          const dayKey = day.format('YYYY-MM-DD')
          const billableTime = dailyBillableHours.get(dayKey) || { hours: 0, minutes: 0, totalMinutes: 0 }
          const isToday = day.isSame(today, 'day')

          let runningTotalMinutes = 0
          for (let i = 0; i <= index; i++) {
            const k = days[i].format('YYYY-MM-DD')
            runningTotalMinutes += (dailyBillableHours.get(k) || { totalMinutes: 0 }).totalMinutes
          }
          const runningHours = Math.floor(runningTotalMinutes / 60)
          const runningMinutes = runningTotalMinutes % 60

          return (
            <div
              key={`footer-${dayKey}`}
              style={{
                padding: '8px',
                borderRight: `1px solid ${token.colorBorder}`,
                backgroundColor: isToday ? token.colorPrimaryBg : token.colorFillAlter,
                textAlign: 'center'
              }}
            >
              <div>
                <Text strong style={{ fontSize: '12px' }}>
                  {billableTime.hours > 0 || billableTime.minutes > 0
                    ? `${billableTime.hours}h ${billableTime.minutes}m`
                    : '-'}
                </Text>
              </div>
              <div style={{ marginTop: '4px' }}>
                <Text type="secondary" style={{ fontSize: '10px' }}>
                  {runningTotalMinutes > 0 ? `${runningHours}h ${runningMinutes}m` : ''}
                </Text>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})

WeekView.displayName = 'WeekView'

export default WeekView
