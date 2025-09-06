import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
dayjs.extend(timezone)

export const formatEventTime = (startDate: string, isAllDay?: boolean, userTimezone?: string): string => {
  if (isAllDay) return ''
  
  const tz = userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const start = dayjs.utc(startDate).tz(tz)
  
  return start.format('h:mmA')
}

export const getEventBackgroundColor = (showAs: string): string => {
  switch (showAs) {
    case 'busy': return '#1890ff'
    case 'tentative': return '#faad14'
    case 'oof': return '#ff4d4f'
    case 'free': return '#52c41a'
    case 'workingElsewhere': return '#722ed1'
    default: return '#8c8c8c'
  }
}


export const calculateEventDuration = (startDate: string, endDate?: string, isAllDay?: boolean, userTimezone?: string): string => {
  if (!endDate) {
    return '-'
  }

  if (isAllDay) {
    // For all-day events, calculate days between start and end
    const start = dayjs(startDate)
    const end = dayjs(endDate).subtract(1, 'day') // Microsoft Graph adds 1 day to end date for all-day events
    const days = end.diff(start, 'day') + 1 // +1 to include both start and end days
    return days === 1 ? '1 day' : `${days} days`
  } else {
    // For timed events, calculate hours and minutes
    const timezone = userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone
    const start = dayjs.utc(startDate).tz(timezone)
    const end = dayjs.utc(endDate).tz(timezone)
    
    const durationMinutes = end.diff(start, 'minute')
    const hours = Math.floor(durationMinutes / 60)
    const minutes = durationMinutes % 60
    
    if (hours > 0) {
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
    } else {
      return `${minutes}m`
    }
  }
}

export const getEventItemStyles = {
  base: {
    fontSize: '10px',
    padding: '1px 3px',
    borderRadius: '2px',
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
  } as React.CSSProperties,
  moreEvents: {
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
  } as React.CSSProperties
}

