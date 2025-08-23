import React from 'react'
import { Radio } from 'antd'

interface ViewModeToggleProps {
  viewMode: string
  calendarType: string
  onViewModeChange: (mode: 'week' | 'month') => void
  onCalendarTypeChange: (type: 'month' | 'year') => void
  onTypeChange: (type: 'month' | 'year') => void
}

const ViewModeToggle: React.FC<ViewModeToggleProps> = ({
  viewMode,
  calendarType,
  onViewModeChange,
  onCalendarTypeChange,
  onTypeChange
}) => {
  // Determine current view for Radio button selection
  const currentRadioValue = (() => {
    if (viewMode === 'week') return 'Week'
    if (calendarType === 'month') return 'Month'
    return 'Year'
  })()

  const handleViewChange = (selectedValue: string) => {
    if (selectedValue === 'Week') {
      onViewModeChange('week')
    } else if (selectedValue === 'Month') {
      onViewModeChange('month')
      onCalendarTypeChange('month')
      onTypeChange('month')
    } else if (selectedValue === 'Year') {
      onViewModeChange('month')
      onCalendarTypeChange('year')
      onTypeChange('year')
    }
  }

  return (
    <Radio.Group 
      block 
      buttonStyle="solid"
      onChange={(e) => handleViewChange(e.target.value)}
      options={[
        { label: 'Week', value: 'Week' },
        { label: 'Month', value: 'Month' },
        { label: 'Year', value: 'Year' }
      ]} 
      value={currentRadioValue} 
      optionType="button"
    />
  )
}

export default ViewModeToggle