import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Typography, Space, Segmented, Flex } from 'antd'
import { useMessage } from '../../contexts/MessageContext'
import {
  Timecard,
  getTimecards,
  createTimecard,
  deleteTimecard,
  getTimecardEntriesInRange,
  generateTimecardEntries
} from '../../api/timecards'
import { storageService } from '../../services/storage'
import { weekBoundsOf } from '../../utils/timecardGrid'
import { useReloadOnShow } from '../../contexts/ScreenVisibilityContext'
import TimecardList from './TimecardList'
import TimecardWeek from './TimecardWeek'
import TimecardReport from './TimecardReport'

const { Title } = Typography

type Tab = 'Timecards' | 'Report'

/**
 * The Timecards screen: the weeks, one open week, or the report.
 *
 * A timecard is a WEEK and only a week. Anything longer is a question about
 * totals rather than a bigger timecard, which is what the report answers —
 * keeping the thing that gets submitted the same size as the thing that gets
 * filled in.
 */
const Timecards: React.FC = () => {
  const messageApi = useMessage()
  const [timecards, setTimecards] = useState<Timecard[]>([])
  const [hoursById, setHoursById] = useState<Record<number, number>>({})
  const [openId, setOpenId] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('Timecards')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const cards = await getTimecards()
      setTimecards(cards)

      if (cards.length === 0) {
        setHoursById({})
        return
      }

      // One read across everything the timecards cover, totalled per card.
      const start = cards.reduce(
        (min, c) => (c.start_date < min ? c.start_date : min),
        cards[0].start_date
      )
      const end = cards.reduce((max, c) => (c.end_date > max ? c.end_date : max), cards[0].end_date)
      const entries = await getTimecardEntriesInRange(start, end)

      const totals: Record<number, number> = {}
      for (const entry of entries) {
        totals[entry.timecard_id] = (totals[entry.timecard_id] ?? 0) + entry.hours
      }
      setHoursById(totals)
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

  // Screens stay mounted, so the effect above runs once. This is what
  // picks up work done elsewhere while this one was hidden.
  useReloadOnShow(() => load())

  // Held by id rather than by value, so an edit inside the week is reflected
  // here without the two copies drifting apart.
  const open = useMemo(
    () => timecards.find(t => t.id === openId) ?? null,
    [timecards, openId]
  )

  const handleCreate = async (date: string) => {
    const week = weekBoundsOf(date)
    const existing = timecards.find(c => c.start_date === week.start)
    if (existing) {
      messageApi.info('That week already has a timecard')
      setOpenId(existing.id ?? null)
      return
    }

    let created: Timecard
    try {
      created = await createTimecard({
        name: week.name,
        start_date: week.start,
        end_date: week.end
      })
    } catch (error) {
      // An overlapping timecard is the failure worth reading out: the
      // backend's message names what is in the way.
      console.error('Error creating a week:', error)
      messageApi.error(error instanceof Error ? error.message : String(error))
      return
    }

    // Pulling is what anyone would do next, so a new week arrives filled.
    try {
      const workingDays = await storageService.getWorkingDays()
      const result = await generateTimecardEntries(created.id!, workingDays)
      messageApi.success(
        `Week created from ${result.eventsRead} event${result.eventsRead === 1 ? '' : 's'}`
      )
    } catch (error) {
      console.error('Error pulling events into the new week:', error)
      messageApi.warning('Week created, but pulling from events failed')
    }

    await load()
    setOpenId(created.id ?? null)
  }

  const handleDelete = async (timecard: Timecard) => {
    try {
      await deleteTimecard(timecard.id!)
      messageApi.success('Week deleted')
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
          <TimecardWeek
            timecard={open}
            onBack={() => setOpenId(null)}
            onChanged={updated =>
              setTimecards(cards => cards.map(c => (c.id === updated.id ? updated : c)))
            }
          />
        ) : (
          <>
            {/* The screen keeps its name whichever tab is on, so the title
                does not appear to change what page you are on. */}
            <Flex align="center" justify="space-between" gap={16} wrap>
              <Title level={2} style={{ marginBottom: 0 }}>
                Timecards
              </Title>
              <Segmented
                value={tab}
                onChange={value => setTab(value as Tab)}
                options={['Timecards', 'Report']}
              />
            </Flex>

            {tab === 'Timecards' ? (
              <TimecardList
                timecards={timecards}
                hoursById={hoursById}
                loading={loading}
                onOpen={timecard => setOpenId(timecard.id ?? null)}
                onCreate={handleCreate}
                onDelete={handleDelete}
              />
            ) : (
              <TimecardReport />
            )}
          </>
        )}
      </Space>
    </div>
  )
}

export default Timecards
