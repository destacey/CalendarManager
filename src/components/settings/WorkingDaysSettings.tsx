import React, { useState, useEffect } from 'react'
import { Typography, Space, Checkbox, Select, Flex } from 'antd'
import { useMessage } from '../../contexts/MessageContext'
import { storageService } from '../../services/storage'

const { Text, Title } = Typography

interface WorkingDaysSettingsProps {
  searchTerm?: string
}

/* Plain "HH:mm" strings rather than antd's TimePicker, which needs a real
   dayjs — and `src/test/setup.ts` replaces dayjs globally with a mock that has
   no `.minute()`, so a picker here cannot render in any test. */
const START_TIMES = Array.from({ length: 96 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, '0')
  const m = String((i % 4) * 15).padStart(2, '0')
  return { value: `${h}:${m}`, label: `${h}:${m}` }
})

/* 0 = Sunday, matching getDay(), which is what utils/allDayHours.ts compares
   against. */
const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' }
]

/**
 * Which days a MULTI-DAY all-day event is spread across, and when one starts.
 *
 * Deliberately not a filter on what counts generally: a Saturday meeting still
 * counts, and a single all-day Saturday still counts. This only decides how a
 * week-long block is split, so a Monday-to-Sunday holiday reads as five days
 * rather than seven.
 */
const WorkingDaysSettings: React.FC<WorkingDaysSettingsProps> = ({ searchTerm = '' }) => {
  const messageApi = useMessage()
  const [workingDays, setWorkingDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [workdayStart, setWorkdayStart] = useState('08:00')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([storageService.getWorkingDays(), storageService.getWorkdayStart()])
      .then(([days, start]) => {
        setWorkingDays(days)
        setWorkdayStart(start)
      })
      .catch(error => console.error('Error loading working days:', error))
      .finally(() => setLoading(false))
  }, [])

  const saveDays = async (days: number[]) => {
    // An empty week would make every multi-day all-day event worth nothing,
    // which is never what someone means by unticking the last day.
    if (days.length === 0) {
      messageApi.warning('At least one working day is needed')
      return
    }
    setWorkingDays(days)
    await storageService.setWorkingDays(days)
  }

  const saveStart = async (value: string) => {
    setWorkdayStart(value)
    await storageService.setWorkdayStart(value)
  }

  const shouldShow =
    searchTerm === '' ||
    'working days'.includes(searchTerm.toLowerCase()) ||
    'all-day'.includes(searchTerm.toLowerCase()) ||
    'hours'.includes(searchTerm.toLowerCase())

  if (!shouldShow) return null

  return (
    <div style={{ marginBottom: 32 }}>
      <Title level={4} style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        Working days
      </Title>

      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Text type="secondary">
          Used when a single all-day event spans several days, so a Monday-to-Sunday block
          counts as five days rather than seven. Work on a non-working day still counts —
          this only splits multi-day all-day events.
        </Text>

        <Checkbox.Group
          value={workingDays}
          disabled={loading}
          onChange={values => saveDays(values as number[])}
        >
          <Flex gap={12} wrap>
            {DAYS.map(day => (
              <Checkbox key={day.value} value={day.value}>
                {day.label}
              </Checkbox>
            ))}
          </Flex>
        </Checkbox.Group>

        <Flex align="center" gap={10}>
          <Text>Working day starts at</Text>
          <Select
            showSearch
            disabled={loading}
            style={{ width: 120 }}
            value={workdayStart}
            options={START_TIMES}
            onChange={saveStart}
            aria-label="Working day start time"
          />
        </Flex>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Only used to give an expanded all-day event a start time; it does not change how
          many hours it is worth.
        </Text>
      </Space>
    </div>
  )
}

export default WorkingDaysSettings
