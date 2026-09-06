import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Typography, Space } from 'antd'
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
import { monthBounds, weekBoundsForMonth } from '../../utils/timecardGrid'
import TimecardList, { PeriodSummary } from './TimecardList'
import TimecardPeriod from './TimecardPeriod'
import { useReloadOnShow } from '../../contexts/ScreenVisibilityContext'

const { Title } = Typography

/** Every month a timecard touches. A week spanning two gives both. */
function monthsTouched(timecard: Timecard): string[] {
  const first = timecard.start_date.slice(0, 7)
  const last = timecard.end_date.slice(0, 7)
  return first === last ? [first] : [first, last]
}

/**
 * The Timecards screen: the months, or one month's weeks.
 *
 * The timecard itself is a WEEK — that is what gets pulled, edited and
 * submitted. A month is a view over the weeks it touches, which is why the
 * hours here are read by date rather than summed per timecard: a week
 * spanning two months belongs to both, and gives each of them its own days.
 */
const Timecards: React.FC = () => {
  const messageApi = useMessage()
  const [timecards, setTimecards] = useState<Timecard[]>([])
  const [hoursByMonth, setHoursByMonth] = useState<Record<string, number>>({})
  const [openMonth, setOpenMonth] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const cards = await getTimecards()
      setTimecards(cards)

      if (cards.length === 0) {
        setHoursByMonth({})
        return
      }

      // One read across everything the timecards cover, bucketed by the date
      // on each entry — so a week spanning two months lands in both correctly.
      const start = cards.reduce(
        (min, c) => (c.start_date < min ? c.start_date : min),
        cards[0].start_date
      )
      const end = cards.reduce((max, c) => (c.end_date > max ? c.end_date : max), cards[0].end_date)
      const entries = await getTimecardEntriesInRange(start, end)

      const totals: Record<string, number> = {}
      for (const entry of entries) {
        const month = entry.date.slice(0, 7)
        totals[month] = (totals[month] ?? 0) + entry.hours
      }
      setHoursByMonth(totals)
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

  const periods = useMemo<PeriodSummary[]>(() => {
    const byMonth = new Map<string, Timecard[]>()
    for (const card of timecards) {
      for (const month of monthsTouched(card)) {
        byMonth.set(month, [...(byMonth.get(month) ?? []), card])
      }
    }

    return Array.from(byMonth.entries())
      .map(([month, weeks]) => ({
        month,
        name: monthBounds(month)?.name ?? month,
        weeks: weeks.length,
        submitted: weeks.filter(w => w.status === 'submitted').length,
        hours: hoursByMonth[month] ?? 0
      }))
      .sort((a, b) => b.month.localeCompare(a.month))
  }, [timecards, hoursByMonth])

  /** The weeks of the open month, in date order. */
  const openWeeks = useMemo(() => {
    if (openMonth === null) return []
    return timecards
      .filter(c => monthsTouched(c).includes(openMonth))
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
  }, [timecards, openMonth])

  const handleCreate = async (month: string) => {
    const weeks = weekBoundsForMonth(month)
    const existing = new Set(timecards.map(c => c.start_date))
    const wanted = weeks.filter(w => !existing.has(w.start))

    if (wanted.length === 0) {
      messageApi.info('Every week of that month already has a timecard')
      setOpenMonth(month)
      return
    }

    const created: Timecard[] = []
    for (const week of wanted) {
      try {
        created.push(
          await createTimecard({ name: week.name, start_date: week.start, end_date: week.end })
        )
      } catch (error) {
        // An overlapping timecard is the failure worth reading out: the
        // backend's message names what is in the way.
        console.error('Error creating a week:', error)
        messageApi.error(error instanceof Error ? error.message : String(error))
        await load()
        return
      }
    }

    // Pulling is what anyone would do next, so a new month arrives filled.
    try {
      const workingDays = await storageService.getWorkingDays()
      for (const week of created) {
        await generateTimecardEntries(week.id!, workingDays)
      }
      messageApi.success(
        `Created ${created.length} week${created.length === 1 ? '' : 's'} and pulled from events`
      )
    } catch (error) {
      console.error('Error pulling events into the new weeks:', error)
      messageApi.warning('Weeks created, but pulling from events failed')
    }

    await load()
    setOpenMonth(month)
  }

  const handleDelete = async (month: string) => {
    const weeks = timecards.filter(c => monthsTouched(c).includes(month))
    try {
      for (const week of weeks) {
        await deleteTimecard(week.id!)
      }
      messageApi.success(`Deleted ${weeks.length} week${weeks.length === 1 ? '' : 's'}`)
      if (openMonth === month) setOpenMonth(null)
      await load()
    } catch (error) {
      console.error('Error deleting timecards:', error)
      messageApi.error('Failed to delete the timecards')
    }
  }

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <Space orientation="vertical" size="large" style={{ width: '100%' }}>
        {openMonth !== null && openWeeks.length > 0 ? (
          <TimecardPeriod
            month={openMonth}
            weeks={openWeeks}
            onBack={() => setOpenMonth(null)}
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
              periods={periods}
              loading={loading}
              onOpen={setOpenMonth}
              onCreate={handleCreate}
              onDelete={handleDelete}
            />
          </>
        )}
      </Space>
    </div>
  )
}

export { monthsTouched }
export default Timecards
