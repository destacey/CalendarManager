import React, { useState, useEffect } from 'react'
import { Card, Select, Typography, Space, Alert, Button } from 'antd'
import { ClockCircleOutlined, CheckOutlined } from '@ant-design/icons'
import { storageService } from '../services/storage'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
dayjs.extend(timezone)

const { Title, Text } = Typography

const TimezoneSettings: React.FC = () => {
  const [selectedTimezone, setSelectedTimezone] = useState<string>('')
  const [currentTime, setCurrentTime] = useState<string>('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const timezone = storageService.getTimezone()
    setSelectedTimezone(timezone)
    updateCurrentTime(timezone)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      updateCurrentTime(selectedTimezone)
    }, 1000)

    return () => clearInterval(interval)
  }, [selectedTimezone])

  const updateCurrentTime = (tz: string) => {
    try {
      const time = dayjs().tz(tz).format('MMM D, YYYY h:mm:ss A')
      setCurrentTime(time)
    } catch (error) {
      setCurrentTime('Invalid timezone')
    }
  }

  const handleTimezoneChange = (value: string) => {
    setSelectedTimezone(value)
    setSaved(false)
  }

  const handleSave = () => {
    storageService.setTimezone(selectedTimezone)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const getTimezoneOptions = () => {
    const timezones = [
      // North America
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Anchorage',
      'Pacific/Honolulu',
      'America/Toronto',
      'America/Vancouver',
      'America/Mexico_City',
      
      // Europe
      'Europe/London',
      'Europe/Paris',
      'Europe/Berlin',
      'Europe/Rome',
      'Europe/Madrid',
      'Europe/Amsterdam',
      'Europe/Brussels',
      'Europe/Vienna',
      'Europe/Zurich',
      'Europe/Stockholm',
      'Europe/Oslo',
      'Europe/Helsinki',
      'Europe/Copenhagen',
      'Europe/Warsaw',
      'Europe/Prague',
      'Europe/Budapest',
      'Europe/Bucharest',
      'Europe/Sofia',
      'Europe/Athens',
      'Europe/Istanbul',
      'Europe/Moscow',
      
      // Asia Pacific
      'Asia/Tokyo',
      'Asia/Seoul',
      'Asia/Shanghai',
      'Asia/Hong_Kong',
      'Asia/Singapore',
      'Asia/Bangkok',
      'Asia/Jakarta',
      'Asia/Manila',
      'Asia/Kuala_Lumpur',
      'Asia/Taipei',
      'Asia/Kolkata',
      'Asia/Dubai',
      'Asia/Karachi',
      'Asia/Dhaka',
      'Asia/Yangon',
      'Asia/Ho_Chi_Minh',
      'Asia/Phnom_Penh',
      'Asia/Vientiane',
      'Asia/Brunei',
      'Asia/Macau',
      
      // Australia & New Zealand
      'Australia/Sydney',
      'Australia/Melbourne',
      'Australia/Brisbane',
      'Australia/Perth',
      'Australia/Adelaide',
      'Australia/Darwin',
      'Pacific/Auckland',
      
      // Africa
      'Africa/Cairo',
      'Africa/Lagos',
      'Africa/Johannesburg',
      'Africa/Nairobi',
      'Africa/Casablanca',
      'Africa/Tunis',
      'Africa/Algiers',
      
      // South America
      'America/Sao_Paulo',
      'America/Buenos_Aires',
      'America/Santiago',
      'America/Lima',
      'America/Bogota',
      'America/Caracas',
      
      // Other
      'UTC'
    ]

    return timezones.map(tz => {
      try {
        const now = dayjs().tz(tz)
        const offset = now.format('Z')
        const city = tz.split('/').pop()?.replace(/_/g, ' ')
        return {
          label: `${city} (${offset}) - ${tz}`,
          value: tz,
          search: `${city} ${tz} ${offset}`.toLowerCase()
        }
      } catch (error) {
        return {
          label: tz,
          value: tz,
          search: tz.toLowerCase()
        }
      }
    }).sort((a, b) => a.label.localeCompare(b.label))
  }

  const hasUnsavedChanges = selectedTimezone !== storageService.getTimezone()

  return (
    <div>
      <Title level={3}>
        <ClockCircleOutlined style={{ marginRight: 8 }} />
        Timezone Settings
      </Title>
      
      <Card>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div>
            <Text strong>Select your timezone:</Text>
            <Select
              value={selectedTimezone}
              onChange={handleTimezoneChange}
              style={{ width: '100%', marginTop: 8 }}
              showSearch
              placeholder="Search for your timezone..."
              optionFilterProp="children"
              filterOption={(input, option) =>
                option?.search?.includes(input.toLowerCase()) ?? false
              }
              options={getTimezoneOptions()}
            />
          </div>

          {selectedTimezone && (
            <Alert
              message="Current time in selected timezone:"
              description={
                <Text strong style={{ fontSize: '16px' }}>
                  {currentTime}
                </Text>
              }
              type="info"
              showIcon
            />
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text type="secondary">
              This timezone will be used for displaying all calendar events and analytics.
            </Text>
            
            {hasUnsavedChanges && (
              <Button
                type="primary"
                icon={saved ? <CheckOutlined /> : undefined}
                onClick={handleSave}
                disabled={saved}
              >
                {saved ? 'Saved!' : 'Save Changes'}
              </Button>
            )}
          </div>

          {saved && (
            <Alert
              message="Timezone updated successfully!"
              type="success"
              showIcon
              closable
            />
          )}
        </Space>
      </Card>
    </div>
  )
}

export default TimezoneSettings