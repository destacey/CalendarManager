import React from 'react'
import { Flex } from 'antd'
import type { Dayjs } from 'dayjs'
import CalendarNavigation from './CalendarNavigation'
import ViewModeToggle from './ViewModeToggle'

interface CalendarHeaderProps {
  value: Dayjs
  type: 'month' | 'year'
  viewMode: string
  calendarType: string
  onChange: (date: Dayjs) => void
  onTypeChange: (type: 'month' | 'year') => void
  onCurrentDateChange: (date: Dayjs) => void
  onCurrentWeekChange: (date: Dayjs) => void
  onViewModeChange: (mode: 'week' | 'month') => void
  onCalendarTypeChange: (type: 'month' | 'year') => void
}

const CalendarHeader: React.FC<CalendarHeaderProps> = ({
  value,
  type,
  viewMode,
  calendarType,
  onChange,
  onTypeChange,
  onCurrentDateChange,
  onCurrentWeekChange,
  onViewModeChange,
  onCalendarTypeChange
}) => {
  return (
    <Flex
      justify="space-between"
      align="center"
      style={{ padding: '12px' }}
    >
      <CalendarNavigation
        value={value}
        type={type}
        viewMode={viewMode}
        onChange={onChange}
        onCurrentDateChange={onCurrentDateChange}
        onCurrentWeekChange={onCurrentWeekChange}
      />
      <ViewModeToggle
        viewMode={viewMode}
        calendarType={calendarType}
        onViewModeChange={onViewModeChange}
        onCalendarTypeChange={onCalendarTypeChange}
        onTypeChange={onTypeChange}
      />
    </Flex>
  )
}

export default CalendarHeader