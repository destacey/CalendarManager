import React, { useState, useEffect } from 'react'
import { Modal, Descriptions, Tag, Space, Select, Button, message } from 'antd'
import { LockOutlined, EditOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { Event, EventType } from '../../types'

dayjs.extend(utc)
dayjs.extend(timezone)

interface EventModalProps {
  isVisible: boolean
  onClose: () => void
  event: Event | null
  getEventColor: (showAs: string) => string
  getShowAsDisplay: (showAs: string) => string
  userTimezone: string
  onEventUpdated?: () => void
}

const EventModal: React.FC<EventModalProps> = ({
  isVisible,
  onClose,
  event,
  getEventColor,
  getShowAsDisplay,
  userTimezone,
  onEventUpdated
}) => {
  const [eventTypes, setEventTypes] = useState<EventType[]>([])
  const [selectedTypeId, setSelectedTypeId] = useState<number | undefined>()
  const [isEditingType, setIsEditingType] = useState(false)

  useEffect(() => {
    if (isVisible && event) {
      loadEventTypes()
      setSelectedTypeId(event.type_id)
      setIsEditingType(false)
    }
  }, [isVisible, event])

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

  const handleTypeChange = (typeId: number) => {
    setSelectedTypeId(typeId)
  }

  const handleSaveType = async () => {
    if (!event || !event.id || !selectedTypeId) return
    
    try {
      if (window.electronAPI?.setEventTypeManually) {
        const success = await window.electronAPI.setEventTypeManually(event.id, selectedTypeId)
        if (success) {
          message.success('Event type updated')
          setIsEditingType(false)
          onEventUpdated?.()
        } else {
          message.error('Failed to update event type')
        }
      }
    } catch (error) {
      console.error('Error updating event type:', error)
      message.error('Failed to update event type')
    }
  }

  const handleResetToAutoAssign = async () => {
    if (!event || !event.id) return
    
    try {
      if (window.electronAPI?.evaluateEventType && window.electronAPI?.setEventTypeManually) {
        const autoTypeId = await window.electronAPI.evaluateEventType(event)
        if (autoTypeId) {
          // Reset to auto-assigned type
          await window.electronAPI.updateEvent(event.id, { 
            ...event, 
            type_id: autoTypeId, 
            type_manually_set: false 
          })
          setSelectedTypeId(autoTypeId)
          message.success('Event type reset to auto-assignment')
          onEventUpdated?.()
        }
      }
    } catch (error) {
      console.error('Error resetting event type:', error)
      message.error('Failed to reset event type')
    }
  }
  const formatEventDateTime = (startDate: string, endDate?: string, isAllDay?: boolean) => {
    let start: dayjs.Dayjs
    let end: dayjs.Dayjs
    
    if (isAllDay) {
      // For all-day events, treat as calendar dates without timezone conversion
      start = dayjs(startDate)
      // For all-day events, Microsoft Graph sets end date to the day after, so subtract 1 day for proper display
      end = endDate ? dayjs(endDate).subtract(1, 'day') : start
      
      if (start.isSame(end, 'day')) {
        return start.format('MMMM D, YYYY')
      } else {
        return `${start.format('MMMM D')} - ${end.format('MMMM D, YYYY')}`
      }
    } else {
      // For timed events, apply timezone conversion
      const timezone = userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone
      start = dayjs.utc(startDate).tz(timezone)
      end = endDate ? dayjs.utc(endDate).tz(timezone) : start
      
      if (start.isSame(end, 'day')) {
        return `${start.format('MMMM D, YYYY')} ${start.format('h:mm A')} - ${end.format('h:mm A')} (${userTimezone})`
      } else {
        return `${start.format('MMMM D, YYYY h:mm A')} - ${end.format('MMMM D, YYYY h:mm A')} (${userTimezone})`
      }
    }
  }

  return (
    <Modal
      title="Event Details"
      open={isVisible}
      onCancel={onClose}
      footer={null}
    >
      {event && (
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="Title">
            {event.title}
          </Descriptions.Item>
          
          <Descriptions.Item label="Date & Time">
            {formatEventDateTime(
              event.start_date, 
              event.end_date, 
              event.is_all_day
            )}
          </Descriptions.Item>
          
          <Descriptions.Item label="Status">
            <Tag color={getEventColor(event.show_as) === 'processing' ? 'blue' : 
                       getEventColor(event.show_as) === 'warning' ? 'orange' :
                       getEventColor(event.show_as) === 'error' ? 'red' : 'green'}>
              {getShowAsDisplay(event.show_as)}
            </Tag>
          </Descriptions.Item>

          <Descriptions.Item label="Type">
            <Space>
              {isEditingType ? (
                <>
                  <Select
                    value={selectedTypeId}
                    onChange={handleTypeChange}
                    style={{ minWidth: 120 }}
                    placeholder="Select type"
                  >
                    {eventTypes.map(type => (
                      <Select.Option key={type.id} value={type.id}>
                        <Space>
                          <div 
                            style={{ 
                              width: 16, 
                              height: 16, 
                              borderRadius: 4, 
                              backgroundColor: type.color,
                              border: '1px solid #d9d9d9'
                            }} 
                          />
                          {type.name}
                        </Space>
                      </Select.Option>
                    ))}
                  </Select>
                  <Button type="primary" size="small" onClick={handleSaveType}>
                    Save
                  </Button>
                  <Button size="small" onClick={() => setIsEditingType(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  {(() => {
                    const eventType = eventTypes.find(t => t.id === event.type_id)
                    return eventType ? (
                      <Tag color={eventType.color} style={{ marginRight: 8 }}>
                        {eventType.name}
                      </Tag>
                    ) : (
                      <Tag color="default">No type</Tag>
                    )
                  })()}
                  {event.type_manually_set && (
                    <LockOutlined 
                      style={{ color: '#999', fontSize: 12 }} 
                      title="Manually set (won't change on sync)" 
                    />
                  )}
                  <Button 
                    type="link" 
                    size="small" 
                    icon={<EditOutlined />}
                    onClick={() => setIsEditingType(true)}
                  >
                    Edit
                  </Button>
                  {event.type_manually_set && (
                    <Button 
                      type="link" 
                      size="small"
                      onClick={handleResetToAutoAssign}
                    >
                      Reset to Auto
                    </Button>
                  )}
                </>
              )}
            </Space>
          </Descriptions.Item>
          
          {event.location && (
            <Descriptions.Item label="Location">
              {event.location}
            </Descriptions.Item>
          )}

          {event.organizer && (
            <Descriptions.Item label="Organizer">
              {(() => {
                try {
                  const organizer = JSON.parse(event.organizer)
                  return `${organizer.name} (${organizer.email})`
                } catch {
                  return event.organizer
                }
              })()}
            </Descriptions.Item>
          )}

          {event.attendees && (
            <Descriptions.Item label="Attendees">
              {(() => {
                try {
                  const attendees = JSON.parse(event.attendees)
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
                  return event.attendees
                }
              })()}
            </Descriptions.Item>
          )}
          
          {event.categories && event.categories.trim() && (
            <Descriptions.Item label="Categories">
              <Space size="small" wrap>
                {event.categories.split(',').map(cat => cat.trim()).filter(cat => cat).map(category => (
                  <Tag key={category}>
                    {category}
                  </Tag>
                ))}
              </Space>
            </Descriptions.Item>
          )}
          
          {event.synced_at && (
            <Descriptions.Item label="Last Synced">
              {dayjs(event.synced_at).tz(userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone).format('MMMM D, YYYY h:mm A')}
            </Descriptions.Item>
          )}
        </Descriptions>
      )}
    </Modal>
  )
}

export default EventModal