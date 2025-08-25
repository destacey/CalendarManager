import React, { useState, useEffect } from 'react'
import { Card, Select, Typography, Space, Alert, Button } from 'antd'
import { ClockCircleOutlined, CheckOutlined } from '@ant-design/icons'
import { storageService } from '../../services/storage'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
dayjs.extend(timezone)

const { Title, Text, Paragraph } = Typography

// Static timezone list - defined outside component to avoid recreation on each render
const TIMEZONES = [
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

interface TimezoneSettingsProps {
  searchTerm?: string
}

const TimezoneSettings: React.FC<TimezoneSettingsProps> = ({ searchTerm = '' }) => {
  const [selectedTimezone, setSelectedTimezone] = useState<string>('')
  const [currentTime, setCurrentTime] = useState<string>('')
  const [saved, setSaved] = useState(false)
  const [storedTimezone, setStoredTimezone] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadTimezone = async () => {
      try {
        setLoading(true)
        const timezone = await storageService.getTimezone()
        setSelectedTimezone(timezone)
        setStoredTimezone(timezone)
        updateCurrentTime(timezone)
      } catch (error) {
        console.error('Error loading timezone:', error)
        // Fall back to browser timezone
        const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone
        setSelectedTimezone(fallback)
        setStoredTimezone(fallback)
        updateCurrentTime(fallback)
      } finally {
        setLoading(false)
      }
    }
    loadTimezone()
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

  const handleSave = async () => {
    try {
      await storageService.setTimezone(selectedTimezone)
      setStoredTimezone(selectedTimezone)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (error) {
      console.error('Error saving timezone:', error)
    }
  }

  const getTimezoneOptions = () => {
    return TIMEZONES.map(tz => {
      try {
        const now = dayjs().tz(tz)
        const offset = now.format('Z')
        const offsetMinutes = now.utcOffset() // Get offset in minutes for sorting
        const city = tz.split('/').pop()?.replace(/_/g, ' ')
        return {
          label: `${city} (${offset}) - ${tz}`,
          value: tz,
          search: `${city} ${tz} ${offset}`.toLowerCase(),
          offsetMinutes
        }
      } catch (error) {
        return {
          label: tz,
          value: tz,
          search: tz.toLowerCase(),
          offsetMinutes: 0
        }
      }
    }).sort((a, b) => b.offsetMinutes - a.offsetMinutes)
  }

  const hasUnsavedChanges = selectedTimezone !== storedTimezone

  // Filter based on search term
  const isVisible = !searchTerm || 
    'timezone time zone clock display events'.toLowerCase().includes(searchTerm.toLowerCase()) ||
    selectedTimezone.toLowerCase().includes(searchTerm.toLowerCase())

  if (!isVisible) return null

  return (
    <div style={{ marginBottom: '32px' }}>
      <Title level={4} style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
        <ClockCircleOutlined style={{ marginRight: '8px' }} />
        Timezone
      </Title>
      
      <Card size="small">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Text strong>Display Timezone</Text>
            <Paragraph type="secondary" style={{ marginBottom: '8px', marginTop: '4px' }}>
              This timezone will be used for displaying all calendar events and analytics throughout the application.
            </Paragraph>
            <Select
              value={selectedTimezone}
              onChange={handleTimezoneChange}
              style={{ width: '100%' }}
              showSearch
              placeholder="Search for your timezone..."
              optionFilterProp="children"
              filterOption={(input, option) =>
                option?.search?.includes(input.toLowerCase()) ?? false
              }
              options={getTimezoneOptions()}
              disabled={loading}
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

          {hasUnsavedChanges && (
            <Button
              type="primary"
              icon={saved ? <CheckOutlined /> : undefined}
              onClick={handleSave}
              disabled={saved}
              size="small"
              style={{ alignSelf: 'flex-end' }}
            >
              {saved ? 'Saved!' : 'Save Changes'}
            </Button>
          )}

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