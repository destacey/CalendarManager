import React, { memo, useMemo } from 'react'
import type { Dayjs } from 'dayjs'
import { Event } from '../../types'
import { getMonthEventCountStyles } from '../../utils/eventUtils'

interface MonthEventCellProps {
  value: Dayjs
  getEventsForDate: (date: Dayjs) => Event[]
}

const MonthEventCell: React.FC<MonthEventCellProps> = memo(({ value, getEventsForDate }) => {
  const eventCount = useMemo(() => {
    const startOfMonth = value.startOf('month')
    const endOfMonth = value.endOf('month')
    
    let count = 0
    let currentDate = startOfMonth
    
    // Optimize: limit iterations and break early if needed
    while (currentDate.isSameOrBefore(endOfMonth, 'day')) {
      const dayEvents = getEventsForDate(currentDate)
      count += dayEvents.length
      currentDate = currentDate.add(1, 'day')
    }
    
    return count
  }, [value, getEventsForDate])
  
  if (eventCount === 0) return null
  
  return (
    <div style={getMonthEventCountStyles.container}>
      <div style={getMonthEventCountStyles.badge}>
        {eventCount}
      </div>
    </div>
  )
})

MonthEventCell.displayName = 'MonthEventCell'

export default MonthEventCell