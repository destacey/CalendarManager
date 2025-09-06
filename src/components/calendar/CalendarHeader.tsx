import React from 'react'
import { Flex, Button } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
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
  onViewModeChange: (mode: 'week' | 'month' | 'table') => void
  onCalendarTypeChange: (type: 'month' | 'year') => void
  exportFunction?: (() => void) | null
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
  onCalendarTypeChange,
  exportFunction
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
      <Flex align="center" gap="small">
        {viewMode === 'table' && exportFunction && (
          <Button 
            type="primary" 
            icon={<DownloadOutlined />}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              exportFunction()
            }}
            size="small"
          />
        )}
        <ViewModeToggle
          viewMode={viewMode}
          calendarType={calendarType}
          onViewModeChange={onViewModeChange}
          onCalendarTypeChange={onCalendarTypeChange}
          onTypeChange={onTypeChange}
        />
      </Flex>
    </Flex>
  )
}

export default CalendarHeader