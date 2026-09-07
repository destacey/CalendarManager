import React, { useState, useEffect } from 'react'
import { Modal, Descriptions, Tag, Space, Select, Button, Typography, theme } from 'antd'
import { LockOutlined, EditOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { Activity, Event, EventType, Project } from '../../types'
import { useMessage } from '../../contexts/MessageContext'
import { calculateEventDuration } from '../../utils/eventUtils'
import { getEventTypes, setEventTypeManually, resetEventTypeToAuto } from '../../api/eventTypes'
import { mapEvents, unmapEvents } from '../../api/mapping'

dayjs.extend(utc)
dayjs.extend(timezone)

const { Text } = Typography

interface EventModalProps {
  isVisible: boolean
  onClose: () => void
  event: Event | null
  getEventColor: (showAs: string) => string
  getShowAsDisplay: (showAs: string) => string
  userTimezone: string
  projects: Project[]
  activities: Activity[]
  onEventUpdated?: () => void
}

const EventModal: React.FC<EventModalProps> = ({
  isVisible,
  onClose,
  projects,
  activities,
  event,
  getEventColor,
  getShowAsDisplay,
  userTimezone,
  onEventUpdated
}) => {
  const { token } = theme.useToken()
  const messageApi = useMessage()
  const [eventTypes, setEventTypes] = useState<EventType[]>([])
  const [selectedTypeId, setSelectedTypeId] = useState<number | undefined>()
  const [isEditingType, setIsEditingType] = useState(false)
  const [isEditingMapping, setIsEditingMapping] = useState(false)
  const [draftProjectId, setDraftProjectId] = useState<number | null>(null)
  const [draftActivityId, setDraftActivityId] = useState<number | null>(null)
  const [savingMapping, setSavingMapping] = useState(false)

  useEffect(() => {
    if (isVisible && event) {
      loadEventTypes()
      setSelectedTypeId(event.type_id)
      setDraftProjectId(event.project_id ?? null)
      setDraftActivityId(event.activity_id ?? null)
      setIsEditingMapping(false)
      setIsEditingType(false)
    }
  }, [isVisible, event])

  const loadEventTypes = async () => {
    try {
      const types = await getEventTypes()
      setEventTypes(types)
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
      const success = await setEventTypeManually(event.id, selectedTypeId)
      if (success) {
        messageApi.success('Event type updated')
        setIsEditingType(false)
        onEventUpdated?.()
      } else {
        messageApi.error('Failed to update event type')
      }
    } catch (error) {
      console.error('Error updating event type:', error)
      messageApi.error('Failed to update event type')
    }
  }

  const handleSaveMapping = async () => {
    if (!event?.id) return
    setSavingMapping(true)
    try {
      if (draftProjectId == null) {
        // No project means no mapping at all, and it hands the event back to
        // the rules rather than pinning it as a hand-made blank.
        await unmapEvents([event.id])
      } else {
        await mapEvents([event.id], draftProjectId, draftActivityId)
      }
      setIsEditingMapping(false)
      onEventUpdated?.()
    } catch (error) {
      console.error('Error saving mapping:', error)
      messageApi.error('Failed to save the mapping')
    } finally {
      setSavingMapping(false)
    }
  }

  const handleResetToAutoAssign = async () => {
    if (!event || !event.id) return

    try {
      const autoTypeId = await resetEventTypeToAuto(event.id)
      // `reset_event_type_to_auto` returns `null` when the reset itself
      // succeeded but no rule matched and there's no default type to fall
      // back to — the write still happened (type_id cleared, the manual
      // flag reset), so this is not a failure. Only a thrown error is.
      // Treating `null` as failure silently dropped the success message and
      // never called `onEventUpdated`, resurrecting the "button does
      // nothing" impression this command exists to cure.
      setSelectedTypeId(autoTypeId ?? undefined)
      if (autoTypeId) {
        messageApi.success('Event type reset to auto-assignment')
      } else {
        messageApi.info('Event type reset, but no rule matched — no type assigned')
      }
      onEventUpdated?.()
    } catch (error) {
      console.error('Error resetting event type:', error)
      messageApi.error('Failed to reset event type')
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

          <Descriptions.Item label="Duration">
            {calculateEventDuration(
              event.start_date,
              event.end_date,
              event.is_all_day,
              userTimezone
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
                    options={eventTypes.map(type => ({
                      key: type.id,
                      value: type.id,
                      label: (
                        <Space>
                          <div
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: 4,
                              backgroundColor: type.color,
                              border: `1px solid ${token.colorBorder}`
                            }}
                          />
                          {type.name}
                        </Space>
                      )
                    }))}
                  />
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
                      style={{ color: token.colorTextTertiary, fontSize: 12 }} 
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
          
          <Descriptions.Item label="Mapping">
            <Space wrap>
              {isEditingMapping ? (
                <>
                  <Select
                    size="small"
                    style={{ minWidth: 200 }}
                    value={draftProjectId ?? -1}
                    aria-label="Project"
                    showSearch
                    optionFilterProp="label"
                    onChange={value => {
                      const next = value === -1 ? null : value
                      setDraftProjectId(next)
                      // A different project makes the old activity a claim
                      // about work that is no longer there.
                      setDraftActivityId(null)
                    }}
                    options={[
                      { value: -1, label: 'Unmapped' },
                      ...projects
                        .filter(p => p.is_active || p.id === event.project_id)
                        .map(p => ({ value: p.id!, label: `${p.code} — ${p.name}` }))
                    ]}
                  />
                  <Select
                    size="small"
                    style={{ minWidth: 180 }}
                    value={draftActivityId ?? -1}
                    aria-label="Activity"
                    showSearch
                    optionFilterProp="label"
                    disabled={draftProjectId == null}
                    onChange={value => setDraftActivityId(value === -1 ? null : value)}
                    options={[
                      { value: -1, label: 'No activity' },
                      ...activities
                        .filter(a => a.is_active || a.id === event.activity_id)
                        .map(a => ({ value: a.id!, label: a.name }))
                    ]}
                  />
                  <Button
                    type="primary"
                    size="small"
                    loading={savingMapping}
                    onClick={handleSaveMapping}
                  >
                    Save
                  </Button>
                  <Button size="small" onClick={() => setIsEditingMapping(false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  {(() => {
                    const project = projects.find(p => p.id === event.project_id)
                    const activity = activities.find(a => a.id === event.activity_id)
                    if (!project) {
                      return <Tag color="default">Unmapped</Tag>
                    }
                    return (
                      <Space size={6} wrap>
                        <Text code>{project.code}</Text>
                        <Text>{project.name}</Text>
                        {project.program && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {project.program}
                          </Text>
                        )}
                        {activity ? (
                          <Tag color={activity.color} style={{ margin: 0 }}>
                            {activity.name}
                          </Tag>
                        ) : (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            no activity
                          </Text>
                        )}
                      </Space>
                    )
                  })()}
                  {event.mapping_manually_set && (
                    <LockOutlined
                      style={{ color: token.colorTextTertiary, fontSize: 12 }}
                      title="Mapped by hand (rules won't change it)"
                    />
                  )}
                  <Button
                    type="link"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => setIsEditingMapping(true)}
                  >
                    Edit
                  </Button>
                </>
              )}
            </Space>
          </Descriptions.Item>

          {event.location && (
            <Descriptions.Item label="Location">
              {event.location}
            </Descriptions.Item>
          )}

          {event.is_meeting && event.organizer && (
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

          {event.is_meeting && event.attendees && (
            <Descriptions.Item label="Attendees">
              {(() => {
                try {
                  const attendees = JSON.parse(event.attendees)
                  return (
                    <Space orientation="vertical" size="small">
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