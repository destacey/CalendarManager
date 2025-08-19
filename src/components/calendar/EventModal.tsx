import React from 'react'
import { Modal, Descriptions, Tag, Space } from 'antd'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { Event } from '../../types'

dayjs.extend(utc)
dayjs.extend(timezone)

interface EventModalProps {
  isVisible: boolean
  onClose: () => void
  event: Event | null
  getEventColor: (showAs: string) => string
  getShowAsDisplay: (showAs: string) => string
  userTimezone: string
}

const EventModal: React.FC<EventModalProps> = ({
  isVisible,
  onClose,
  event,
  getEventColor,
  getShowAsDisplay,
  userTimezone
}) => {
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