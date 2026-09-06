import React, { useState, useEffect, useCallback } from 'react'
import { Typography, Space } from 'antd'
import { useMessage } from '../../contexts/MessageContext'
import {
  Timecard,
  getTimecards,
  createTimecard,
  deleteTimecard,
  generateTimecardEntries
} from '../../api/timecards'
import { storageService } from '../../services/storage'
import TimecardList from './TimecardList'
import TimecardDetail from './TimecardDetail'

const { Title } = Typography

/**
 * The Timecards screen: a list, or one open timecard.
 *
 * Selection is local state rather than a route because this app has no
 * router — every screen is toggled by `App.tsx` with `display: none`.
 */
const Timecards: React.FC = () => {
  const messageApi = useMessage()
  const [timecards, setTimecards] = useState<Timecard[]>([])
  const [openId, setOpenId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setTimecards(await getTimecards())
    } catch (error) {
      console.error('Error loading timecards:', error)
      messageApi.error('Failed to load timecards')
    } finally {
      setLoading(false)
    }
  }, [messageApi])

  useEffect(() => {
    load()
  }, [load])

  // Held by id rather than by value, so an edit inside the detail view is
  // reflected here without the two copies drifting apart.
  const open = timecards.find(t => t.id === openId) ?? null

  const handleCreate = async (name: string, startDate: string, endDate: string) => {
    let created: Timecard
    try {
      created = await createTimecard({ name, start_date: startDate, end_date: endDate })
    } catch (error) {
      console.error('Error creating timecard:', error)
      messageApi.error('Failed to create the timecard')
      return
    }

    // Pull straight away: a new timecard that opens empty looks broken, and
    // pulling is what someone would do first anyway. A failure here is not
    // fatal — the card exists, and Pull from events is right there.
    try {
      const workingDays = await storageService.getWorkingDays()
      const result = await generateTimecardEntries(created.id!, workingDays)
      messageApi.success(
        `Timecard created from ${result.eventsRead} event${result.eventsRead === 1 ? '' : 's'}`
      )
    } catch (error) {
      console.error('Error pulling events into the new timecard:', error)
      messageApi.warning('Timecard created, but pulling from events failed')
    }

    await load()
    setOpenId(created.id ?? null)
  }

  const handleDelete = async (timecard: Timecard) => {
    try {
      await deleteTimecard(timecard.id!)
      messageApi.success('Timecard deleted')
      if (openId === timecard.id) setOpenId(null)
      await load()
    } catch (error) {
      console.error('Error deleting timecard:', error)
      messageApi.error('Failed to delete the timecard')
    }
  }

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <Space orientation="vertical" size="large" style={{ width: '100%' }}>
        {open ? (
          <TimecardDetail
            timecard={open}
            onBack={() => setOpenId(null)}
            onChanged={updated =>
              setTimecards(cards => cards.map(c => (c.id === updated.id ? updated : c)))
            }
          />
        ) : (
          <>
            <Title level={2} style={{ marginBottom: 0 }}>
              Timecards
            </Title>
            <TimecardList
              timecards={timecards}
              loading={loading}
              onOpen={timecard => setOpenId(timecard.id ?? null)}
              onCreate={handleCreate}
              onDelete={handleDelete}
            />
          </>
        )}
      </Space>
    </div>
  )
}

export default Timecards
