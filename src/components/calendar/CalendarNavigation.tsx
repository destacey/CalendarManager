import React from 'react'
import { Button, Space, DatePicker } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'

interface CalendarNavigationProps {
  value: Dayjs
  type: 'month' | 'year'
  viewMode: string
  onChange: (date: Dayjs) => void
  onCurrentDateChange: (date: Dayjs) => void
  onCurrentWeekChange?: (date: Dayjs) => void
}

const CalendarNavigation: React.FC<CalendarNavigationProps> = ({
  value,
  type,
  viewMode,
  onChange,
  onCurrentDateChange,
  onCurrentWeekChange
}) => {
  const handleTodayClick = () => {
    const today = dayjs()
    onChange(today)
    onCurrentDateChange(today)
    if (viewMode === 'week' && onCurrentWeekChange) {
      onCurrentWeekChange(today)
    }
  }

  const handlePreviousClick = () => {
    const newValue = value.clone().subtract(1, type === 'month' ? 'month' : 'year')
    onChange(newValue)
    onCurrentDateChange(newValue)
  }

  const handleNextClick = () => {
    const newValue = value.clone().add(1, type === 'month' ? 'month' : 'year')
    onChange(newValue)
    onCurrentDateChange(newValue)
  }

  const handleDateChange = (date: Dayjs | null) => {
    if (date) {
      onChange(date)
      onCurrentDateChange(date)
    }
  }

  return (
    <div className="ant-picker-calendar-header-value">
      <Space>
        <Button onClick={handleTodayClick} title="Go to today">
          Today
        </Button>
        <LeftOutlined onClick={handlePreviousClick} />
        {type === 'month' ? (
          <Space>
            <DatePicker 
              value={value}
              onChange={handleDateChange}
              picker="month"
              allowClear={false}
              format="MMM YYYY"
            />
          </Space>
        ) : (
          <DatePicker 
            value={value}
            onChange={handleDateChange}
            picker="year"
            allowClear={false}
            format="YYYY"
          />
        )}
        <RightOutlined onClick={handleNextClick} />
      </Space>
    </div>
  )
}

export default CalendarNavigation