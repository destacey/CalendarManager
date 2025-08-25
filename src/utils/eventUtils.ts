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

