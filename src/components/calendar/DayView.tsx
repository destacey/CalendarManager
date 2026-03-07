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

interface DayViewProps {
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

const DayView: React.FC<DayViewProps> = memo(({
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
  const day = currentWeek
  const today = dayjs()
  const isToday = day.isSame(today, 'day')

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

  useEffect(() => {
    hasScrolled.current = false
  }, [currentWeek])

  const dayData = useMemo(() => {
    const dayEvents = getEventsForDate(day)
    const allDayEvents = dayEvents.filter(e => e.is_all_day).map(event => {
      const eventStart = dayjs(event.start_date)
      const eventEnd = event.end_date ? dayjs(event.end_date).subtract(1, 'day') : eventStart
      return { ...event, startDay: eventStart.startOf('day'), endDay: eventEnd.startOf('day') }
    })

    const timedEvents = dayEvents.filter(e => !e.is_all_day).map(event => {
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

    return {
      allDay: allDayEvents,
      positioned: layoutEvents(timedEvents, day, hourHeight)
    }
  }, [day, getEventsForDate, tz, hourHeight])

  // Calculate billable hours
  const billableTime = useMemo(() => {
    const allEvents = getEventsForDate(day)
    let totalMinutes = 0

    allEvents.forEach(event => {
      if (!event.type_id || !event.end_date) return
      const eventType = eventTypes.find(t => t.id === event.type_id)
      if (!eventType?.is_billable) return

      if (event.is_all_day) {
        totalMinutes += 1440
      } else {
        const eventStart = dayjs.utc(event.start_date).tz(tz)
        const eventEnd = dayjs.utc(event.end_date).tz(tz)
        const dayStart = day.startOf('day')
        const dayEnd = day.endOf('day')
        const start = dayjs.max(eventStart, dayStart)
        const end = dayjs.min(eventEnd, dayEnd)
        if (start.isBefore(end)) {
          totalMinutes += end.diff(start, 'minute')
        }
      }
    })

    return {
      hours: Math.floor(totalMinutes / 60),
      minutes: totalMinutes % 60,
      totalMinutes
    }
  }, [day, getEventsForDate, eventTypes, tz])

  const currentTimeTop = getTimePosition(hourHeight)

  const getColor = (event: Event) =>
    getEventDisplayColor ? getEventDisplayColor(event) : getEventBackgroundColor(event.show_as)

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
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

      {/* Day Header */}
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
            onClick={() => startTransition(() => setCurrentWeek(currentWeek.subtract(1, 'day')))}
            title="Previous day"
          />
          <DatePicker
            value={currentWeek}
            onChange={(date) => {
              if (date) startTransition(() => setCurrentWeek(date))
            }}
            allowClear={false}
          />
          <Button
            icon={<RightOutlined />}
            loading={isPending}
            onClick={() => startTransition(() => setCurrentWeek(currentWeek.add(1, 'day')))}
            title="Next day"
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
          value="Day"
          block
          buttonStyle="solid"
          onChange={(e) => {
            const v = e.target.value
            if (v === 'Day') setViewMode('day')
            else if (v === 'Week') setViewMode('week')
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

      {/* Scrollable content */}
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
        {/* Day header with date (sticky) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '80px 1fr',
          position: 'sticky',
          top: 0,
          zIndex: 20,
          backgroundColor: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorder}`
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
            <Text strong style={{ fontSize: '12px' }}>Time</Text>
          </div>
          <div style={{
            padding: '8px',
            backgroundColor: isToday ? token.colorPrimaryBg : token.colorFillAlter,
            textAlign: 'center'
          }}>
            <Text strong style={{ fontSize: '14px' }}>{day.format('dddd, MMMM D, YYYY')}</Text>
          </div>

          {/* All-day events */}
          {dayData.allDay.length > 0 && (
            <>
              <div style={{
                padding: '4px 8px',
                borderRight: `1px solid ${token.colorBorder}`,
                borderBottom: `1px solid ${token.colorBorder}`,
                backgroundColor: token.colorFillAlter,
                textAlign: 'right',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end'
              }}>
                <Text type="secondary" style={{ fontSize: '10px' }}>All Day</Text>
              </div>
              <div style={{
                padding: '2px',
                borderBottom: `1px solid ${token.colorBorder}`,
                backgroundColor: token.colorBgContainer,
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
              }}>
                {dayData.allDay.map(event => (
                  <div
                    key={event.id}
                    onClick={() => {
                      setSelectedEvent(event)
                      setIsModalVisible(true)
                    }}
                    style={{
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
                      border: '1px solid rgba(255,255,255,0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      boxSizing: 'border-box'
                    }}
                    title={event.title}
                  >
                    {event.title}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Time grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '80px 1fr',
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

          {/* Day column */}
          <div style={{
            position: 'relative',
            height: `${24 * hourHeight}px`
          }}>
            {/* Hour grid lines */}
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
            {dayData.positioned.map(event => {
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
                    fontSize: '11px',
                    padding: '4px 6px',
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
                  <Text style={{ fontWeight: 'bold', fontSize: '10px', color: '#fff' }}>
                    {startTime} - {endTime}
                  </Text>
                  {event.height > 30 && (
                    <Text style={{ display: 'block', fontSize: '12px', color: '#fff', marginTop: '2px' }}>
                      {event.title}
                    </Text>
                  )}
                  {event.height <= 30 && (
                    <Text style={{ marginLeft: '6px', fontSize: '11px', color: '#fff' }}>
                      {event.title}
                    </Text>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Billable Hours Footer */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '80px 1fr',
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
        <div style={{
          padding: '8px',
          backgroundColor: isToday ? token.colorPrimaryBg : token.colorFillAlter,
          textAlign: 'center'
        }}>
          <Text strong style={{ fontSize: '12px' }}>
            {billableTime.hours > 0 || billableTime.minutes > 0
              ? `${billableTime.hours}h ${billableTime.minutes}m`
              : '-'}
          </Text>
        </div>
      </div>
    </div>
  )
})

DayView.displayName = 'DayView'

export default DayView
