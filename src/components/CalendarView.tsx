import React, { useState, useEffect } from 'react'
import { Calendar, Badge, Modal, Button, message, Descriptions, Tag } from 'antd'
import { SyncOutlined, EyeOutlined } from '@ant-design/icons'
import type { CalendarProps } from 'antd'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { Event } from '../types'

const CalendarView: React.FC = () => {
  const [events, setEvents] = useState<Event[]>([])
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadEvents()
  }, [])

  const loadEvents = async () => {
    try {
      setLoading(true)
      if (window.electronAPI) {
        const eventsData = await window.electronAPI.getEvents()
        setEvents(eventsData)
      }
    } catch (error) {
      message.error('Failed to load events')
      console.error('Error loading events:', error)
    } finally {
      setLoading(false)
    }
  }

  const getEventsForDate = (date: Dayjs) => {
    const dateStr = date.format('YYYY-MM-DD')
    return events.filter(event => {
      const eventDate = dayjs(event.start_date).format('YYYY-MM-DD')
      return eventDate === dateStr
    })
  }

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

  const cellRender: CalendarProps<Dayjs>['cellRender'] = (current, info) => {
    if (info.type !== 'date') return info.originNode;
    
    const dayEvents = getEventsForDate(current)
    return (
      <div className="events">
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {dayEvents.slice(0, 3).map(event => (
            <li key={event.id}>
              <Badge 
                status={getEventColor(event.show_as)} 
                text={
                  <span 
                    className="event-item"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedEvent(event)
                      setIsModalVisible(true)
                    }}
                    title={`${event.title} - ${getShowAsDisplay(event.show_as)}`}
                  >
                    {event.title}
                  </span>
                }
              />
            </li>
          ))}
          {dayEvents.length > 3 && (
            <li>
              <Badge 
                status="default" 
                text={
                  <span 
                    className="event-item"
                    onClick={(e) => {
                      e.stopPropagation()
                      // Show first event as example, could show a list of all events
                      setSelectedEvent(dayEvents[0])
                      setIsModalVisible(true)
                    }}
                  >
                    +{dayEvents.length - 3} more
                  </span>
                }
              />
            </li>
          )}
        </ul>
      </div>
    )
  }

  const formatEventDateTime = (startDate: string, endDate?: string, isAllDay?: boolean) => {
    const start = dayjs(startDate)
    const end = endDate ? dayjs(endDate) : start
    
    if (isAllDay) {
      if (start.isSame(end, 'day')) {
        return start.format('MMMM D, YYYY')
      } else {
        return `${start.format('MMMM D')} - ${end.format('MMMM D, YYYY')}`
      }
    } else {
      if (start.isSame(end, 'day')) {
        return `${start.format('MMMM D, YYYY')} ${start.format('h:mm A')} - ${end.format('h:mm A')}`
      } else {
        return `${start.format('MMMM D, YYYY h:mm A')} - ${end.format('MMMM D, YYYY h:mm A')}`
      }
    }
  }

  return (
    <div className="calendar-container-responsive">
      <div style={{ 
        marginBottom: 16, 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        flexShrink: 0
      }}>
        <h2 style={{ margin: 0 }}>Calendar View</h2>
        <Button 
          icon={<SyncOutlined />} 
          onClick={loadEvents}
          loading={loading}
        >
          Refresh
        </Button>
      </div>
      
      <div style={{ 
        flex: 1, 
        display: 'flex',
        flexDirection: 'column'
      }}>
        <Calendar
          cellRender={cellRender}
        />
      </div>

      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <EyeOutlined />
            Event Details
          </div>
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
            
            {selectedEvent.categories && (
              <Descriptions.Item label="Categories">
                {selectedEvent.categories.split(',').map(cat => cat.trim()).map(category => (
                  <Tag key={category} style={{ marginBottom: 4 }}>
                    {category}
                  </Tag>
                ))}
              </Descriptions.Item>
            )}
            
            {selectedEvent.description && (
              <Descriptions.Item label="Description">
                <div dangerouslySetInnerHTML={{ __html: selectedEvent.description }} />
              </Descriptions.Item>
            )}
            
            {selectedEvent.synced_at && (
              <Descriptions.Item label="Last Synced">
                {dayjs(selectedEvent.synced_at).format('MMMM D, YYYY h:mm A')}
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>
    </div>
  )
}

export default CalendarView