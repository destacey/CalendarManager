import React, { memo } from 'react'
import { Flex, Space, Badge, theme } from 'antd'
import type { Dayjs } from 'dayjs'
import { Event } from '../../types'
import { 
  formatEventTime, 
  getEventBackgroundColor, 
  getEventItemStyles 
} from '../../utils/eventUtils'

interface CalendarEventCellProps {
  current: Dayjs
  dayEvents: Event[]
  isLargeScreen: boolean
  userTimezone: string
  onEventClick: (event: Event) => void
  getShowAsDisplay: (showAs: string) => string
}

const CalendarEventCell: React.FC<CalendarEventCellProps> = memo(({
  current,
  dayEvents,
  isLargeScreen,
  userTimezone,
  onEventClick,
  getShowAsDisplay
}) => {
  const { token } = theme.useToken()
  
  if (dayEvents.length === 0) return null

  // For small screens, show only event count
  if (!isLargeScreen) {
    return (
      <Flex justify="center" align="center" style={{ height: '100%' }}>
        <div
          onClick={(e) => {
            e.stopPropagation()
            onEventClick(dayEvents[0])
          }}
          style={{ cursor: 'pointer' }}
          title={`${dayEvents.length} event${dayEvents.length > 1 ? 's' : ''} on this day`}
        >
          <Badge 
            count={dayEvents.length} 
            showZero={false}
            color={token.colorTextPlaceholder}
          />
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
        const eventTime = formatEventTime(event.start_date, event.is_all_day, userTimezone)
        const displayText = eventTime ? `${eventTime} ${event.title}` : event.title
        
        return (
          <div
            key={`${event.id}-${index}`}
            onClick={(e) => {
              e.stopPropagation()
              onEventClick(event)
            }}
            title={`${event.title} - ${getShowAsDisplay(event.show_as)}`}
            style={{
              ...getEventItemStyles.base,
              backgroundColor: getEventBackgroundColor(event.show_as)
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
            onEventClick(dayEvents[0])
          }}
          style={getEventItemStyles.moreEvents}
        >
          +{dayEvents.length - 3} more
        </div>
      )}
    </Space>
  )
})

CalendarEventCell.displayName = 'CalendarEventCell'

export default CalendarEventCell