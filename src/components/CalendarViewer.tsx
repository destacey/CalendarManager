import React, { useState, useEffect, useCallback } from 'react'
import { Calendar, Badge, Modal, Descriptions, Tag, Tooltip, Flex, Space, Grid, Spin } from 'antd'
import { EyeOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { Event } from '../types'
import { calendarService } from '../services/calendar'
import { storageService } from '../services/storage'
import { useCalendarEvents } from '../hooks/useCalendarEvents'

dayjs.extend(utc)
dayjs.extend(timezone)

const { useBreakpoint } = Grid

const CalendarViewer: React.FC = () => {
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
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
    
    // Use userTimezone from hook, fallback to browser timezone if not available
    const timezone = userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    // Assume the stored date is in UTC and convert to user timezone
    const start = dayjs.utc(startDate).tz(timezone)
    const end = endDate ? dayjs.utc(endDate).tz(timezone) : start
    
    if (start.isSame(end, 'day')) {
      return start.format('h:mmA')
    } else {
      return start.format('h:mmA')
    }
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

  // Using cellRender (modern 2025 API) - memoized for performance
  const cellRender = useCallback((current: Dayjs, info: any) => {
    const dayEvents = getEventsForDate(current) // Already sorted in the hook
    
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

    // For large screens, show events with time labels
    const eventsToShow = dayEvents.length <= 4 ? dayEvents.length : 3
    const hasMoreEvents = dayEvents.length > 4

    return (
      <Space direction="vertical" size={1} style={{ width: '100%' }}>
        {dayEvents.slice(0, eventsToShow).map((event) => {
          const eventTime = formatEventTime(event.start_date, event.end_date, event.is_all_day)
          const displayText = eventTime ? `${eventTime} ${event.title}` : event.title
          
          return (
            <div
              key={event.id}
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
    <Flex vertical className="calendar-container-responsive">
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <Space align="center" size="middle">
          <h2 style={{ margin: 0 }}>Calendar View</h2>
          {(() => {
            // TODO: Fix getSyncStatus to be async - for now just hide this
            return null
          })()}
        </Space>
      </Flex>
      
      <Flex flex={1} style={{ overflow: 'hidden' }}>
        <Calendar
          cellRender={cellRender}
          style={{ width: '100%' }}
          mode="month"
          fullscreen={true}
        />
      </Flex>

      <Modal
        title={
          <Space align="center" size="small">
            <EyeOutlined />
            Event Details
          </Space>
        }
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        footer={null}
        width={600}
      >
        {selectedEvent && (
          <Descriptions column={1} bordered>
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
            
            {selectedEvent.description && (
              <Descriptions.Item label="Description">
                <div dangerouslySetInnerHTML={{ __html: selectedEvent.description }} />
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