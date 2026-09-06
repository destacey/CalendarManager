import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Typography, Space, Button, Tag, Popconfirm, Flex, Alert, Segmented, Spin, Select } from 'antd'
import {
  ArrowLeftOutlined, SyncOutlined, LockOutlined, LeftOutlined, RightOutlined
} from '@ant-design/icons'
import { Project, Activity } from '../../types'
import { useMessage } from '../../contexts/MessageContext'
import {
  Timecard, TimecardEntry, EntryInput,
  getTimecardEntries, getTimecardEntriesInRange, generateTimecardEntries, addTimecardEntry,
  updateTimecardEntry, deleteTimecardEntry, setTimecardCell,
  submitTimecard, reopenTimecard, TimecardSubmittedError
} from '../../api/timecards'
import { getProjects } from '../../api/projects'
import { getActivities } from '../../api/activities'
import { storageService } from '../../services/storage'
import { weeksOf, monthBounds } from '../../utils/timecardGrid'
import TimecardWeekGrid from './TimecardWeekGrid'
import TimecardDayModal from './TimecardDayModal'
import TimecardSummary from './TimecardSummary'
import TimecardEntryTable from './TimecardEntryTable'

const { Text, Title } = Typography

interface TimecardPeriodProps {
  /** "YYYY-MM". */
  month: string
  /** The weekly timecards covering this month, in date order. */
  weeks: Timecard[]
  onBack: () => void
  onChanged: (timecard: Timecard) => void
}

type View = 'Week' | 'Summary' | 'Entries'

/**
 * A month, read as the weeks it touches.
 *
 * The timecard is the WEEK: it is what gets pulled, edited and submitted, and
 * it owns all seven of its days even where they reach into the month next
 * door. The month is a view - its totals are read by date across the weeks,
 * so a week spanning two months gives each of them its own days.
 */
const TimecardPeriod: React.FC<TimecardPeriodProps> = ({ month, weeks, onBack, onChanged }) => {
  const messageApi = useMessage()
  const [weekEntries, setWeekEntries] = useState<TimecardEntry[]>([])
  const [monthEntries, setMonthEntries] = useState<TimecardEntry[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<View>('Week')
  const [openWeekId, setOpenWeekId] = useState<number | null>(weeks[0]?.id ?? null)
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<{ unmapped: number } | null>(null)

  // Held by id rather than by value so a submission inside the week does not
  // leave this pointing at a stale copy.
  const week = weeks.find(w => w.id === openWeekId) ?? weeks[0] ?? null
  const submitted = week?.status === 'submitted'
  const bounds = useMemo(() => monthBounds(month), [month])

  const load = useCallback(async () => {
    if (!week || !bounds) return
    try {
      setLoading(true)
      const [ofWeek, ofMonth, p, a] = await Promise.all([
        getTimecardEntries(week.id!),
        getTimecardEntriesInRange(bounds.start, bounds.end),
        getProjects(),
        getActivities()
      ])
      setWeekEntries(ofWeek)
      setMonthEntries(ofMonth)
      setProjects(p)
      setActivities(a)
    } catch (error) {
      console.error('Error loading timecard:', error)
      messageApi.error('Failed to load the timecard')
    } finally {
      setLoading(false)
    }
  }, [week, bounds, messageApi])

  useEffect(() => {
    load()
  }, [load])

  /* One week of days. `weeksOf` over the card's own dates gives exactly seven,
     all of them the card's own — a weekly timecard has no borrowed days. */
  const gridWeek = useMemo(
    () => (week ? weeksOf(week.start_date, week.end_date)[0] : undefined),
    [week]
  )

  /* Rows come from the whole month so they hold still while stepping through
     the weeks; cells come from the week on screen. The card's own entries are
     included because its edge days belong to no other month's range. */
  const rowSource = useMemo(() => {
    const byId = new Map<number, TimecardEntry>()
    for (const entry of [...monthEntries, ...weekEntries]) byId.set(entry.id!, entry)
    return Array.from(byId.values())
  }, [monthEntries, weekEntries])

  const projectById = useMemo(() => new Map(projects.map(p => [p.id!, p])), [projects])

  /** Anything that writes goes through here, so a refusal reads the same. */
  const run = async (action: () => Promise<unknown>, failure: string) => {
    setBusy(true)
    try {
      await action()
      await load()
    } catch (error) {
      console.error(failure, error)
      if (error instanceof TimecardSubmittedError) {
        messageApi.error(error.message)
      } else {
        messageApi.error(failure)
      }
    } finally {
      setBusy(false)
    }
  }

  const handleGenerate = async () => {
    if (!week) return
    setBusy(true)
    try {
      const workingDays = await storageService.getWorkingDays()
      const result = await generateTimecardEntries(week.id!, workingDays)
      setLastRun({ unmapped: result.unmappedEvents })
      messageApi.success(
        `Pulled ${result.eventsRead} event${result.eventsRead === 1 ? '' : 's'} into ` +
          `${result.entriesCreated} entr${result.entriesCreated === 1 ? 'y' : 'ies'}`
      )
      await load()
      onChanged({ ...week, generated_at: new Date().toISOString() })
    } catch (error) {
      console.error('Error pulling from events:', error)
      if (error instanceof TimecardSubmittedError) {
        messageApi.error(error.message)
      } else {
        messageApi.error('Failed to pull from events')
      }
    } finally {
      setBusy(false)
    }
  }

  const handleSubmit = async () => {
    const updated = await submitTimecard(week!.id!)
    if (updated) {
      onChanged(updated)
      messageApi.success('Week submitted')
    }
  }

  const handleReopen = async () => {
    const updated = await reopenTimecard(week!.id!)
    if (updated) {
      onChanged(updated)
      messageApi.success('Week reopened')
    }
  }

  const patch = (entry: TimecardEntry, changes: Partial<TimecardEntry>) =>
    run(
      () =>
        updateTimecardEntry(entry.id!, {
          event_id: entry.event_id ?? null,
          date: changes.date ?? entry.date,
          hours: changes.hours ?? entry.hours,
          project_id:
            changes.project_id !== undefined ? changes.project_id : entry.project_id ?? null,
          activity_id:
            changes.activity_id !== undefined ? changes.activity_id : entry.activity_id ?? null,
          note: changes.note !== undefined ? changes.note : entry.note ?? null
        }),
      'Failed to update the entry'
    )

  const setCell = (
    date: string,
    projectId: number | null,
    activityId: number | null,
    hours: number
  ) =>
    run(
      () =>
        setTimecardCell(week!.id!, {
          date,
          project_id: projectId,
          activity_id: activityId,
          hours
        }),
      'Failed to set that cell'
    )

  const addEntry = (entry: EntryInput) =>
    run(() => addTimecardEntry(week!.id!, entry), 'Failed to add an entry')

  /** The month's total, by date — not the sum of its weeks. */
  const monthHours = monthEntries.reduce((sum, e) => sum + e.hours, 0)

  const byProject = useMemo(() => {
    const totals = new Map<number | null, number>()
    for (const entry of monthEntries) {
      const key = entry.project_id ?? null
      totals.set(key, (totals.get(key) ?? 0) + entry.hours)
    }
    return Array.from(totals.entries())
      .map(([projectId, hours]) => ({
        projectId,
        hours,
        project: projectId != null ? projectById.get(projectId) : undefined
      }))
      .sort((a, b) => b.hours - a.hours)
  }, [monthEntries, projectById])

  const monthWeeks = useMemo(
    () => (bounds ? weeksOf(bounds.start, bounds.end) : []),
    [bounds]
  )

  const dayEntries = useMemo(
    () => (openDay === null ? [] : rowSource.filter(e => e.date === openDay)),
    [rowSource, openDay]
  )

  const index = weeks.findIndex(w => w.id === week?.id)

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Flex align="center" gap={12} wrap>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          All timecards
        </Button>
        <Title level={3} style={{ marginBottom: 0 }}>
          {bounds?.name ?? month}
        </Title>
        <Text type="secondary">{monthHours.toFixed(2)} hours</Text>
        <div style={{ flexGrow: 1 }} />
        <Button icon={<SyncOutlined />} onClick={handleGenerate} disabled={submitted || busy}>
          {week?.generated_at ? 'Refresh from events' : 'Pull from events'}
        </Button>
        {submitted ? (
          <Button onClick={handleReopen}>Reopen week</Button>
        ) : (
          <Popconfirm
            title="Submit this week?"
            description="It becomes read-only until you reopen it. The other weeks are untouched."
            okText="Submit"
            cancelText="Cancel"
            onConfirm={handleSubmit}
          >
            <Button type="primary" disabled={busy || !week}>
              Submit week
            </Button>
          </Popconfirm>
        )}
      </Flex>

      <Flex align="center" gap={8} wrap>
        <Button
          icon={<LeftOutlined />}
          disabled={index <= 0}
          onClick={() => setOpenWeekId(weeks[index - 1]?.id ?? null)}
          aria-label="Previous week"
        />
        <Select
          value={week?.id ?? undefined}
          style={{ minWidth: 300 }}
          onChange={setOpenWeekId}
          aria-label="Week"
          options={weeks.map((w, i) => ({
            value: w.id!,
            label: `Week ${i + 1} — ${w.start_date} to ${w.end_date}${
              w.status === 'submitted' ? ' (submitted)' : ''
            }`
          }))}
        />
        <Button
          icon={<RightOutlined />}
          disabled={index < 0 || index >= weeks.length - 1}
          onClick={() => setOpenWeekId(weeks[index + 1]?.id ?? null)}
          aria-label="Next week"
        />
        {submitted && (
          <Tag icon={<LockOutlined />} color="success" style={{ marginInlineEnd: 0 }}>
            Submitted
          </Tag>
        )}
      </Flex>

      {submitted && (
        <Alert
          type="info"
          showIcon
          title="This week is submitted"
          description="It cannot be edited or refreshed. Reopen it to make changes — the calendar keeps syncing underneath either way, and the other weeks of the month are unaffected."
        />
      )}

      {lastRun && lastRun.unmapped > 0 && (
        <Alert
          type="warning"
          showIcon
          title={`${lastRun.unmapped} billable event${
            lastRun.unmapped === 1 ? ' has' : 's have'
          } no project`}
          description="Their time is on the Unassigned row. Give it a project here, or map the events on the Map Events screen and refresh."
        />
      )}

      <Flex align="center" gap={16} wrap>
        <Segmented
          value={view}
          onChange={value => setView(value as View)}
          options={['Week', 'Summary', 'Entries']}
        />
        {byProject.map(({ projectId, hours, project }) => (
          <Text key={projectId ?? 'none'} type="secondary">
            {project ? `${project.code} ${hours.toFixed(2)}` : `Unassigned ${hours.toFixed(2)}`}
          </Text>
        ))}
      </Flex>

      <Spin spinning={loading}>
        {view === 'Week' && gridWeek && (
          <TimecardWeekGrid
            entries={rowSource}
            projects={projects}
            activities={activities}
            week={gridWeek}
            month={month}
            disabled={submitted || busy}
            onSetCell={setCell}
            onOpenDay={setOpenDay}
          />
        )}

        {view === 'Summary' && (
          <TimecardSummary
            entries={monthEntries}
            projects={projects}
            activities={activities}
            weeks={monthWeeks}
          />
        )}

        {view === 'Entries' && (
          <TimecardEntryTable
            entries={monthEntries}
            projects={projects}
            activities={activities}
            disabled={busy}
            onPatch={patch}
            onDelete={entry => run(() => deleteTimecardEntry(entry.id!), 'Failed to delete the entry')}
            showNote
          />
        )}
      </Spin>

      <TimecardDayModal
        date={openDay}
        entries={dayEntries}
        projects={projects}
        activities={activities}
        disabled={submitted || busy}
        onClose={() => setOpenDay(null)}
        onPatch={patch}
        onDelete={entry => run(() => deleteTimecardEntry(entry.id!), 'Failed to delete the entry')}
        onAdd={addEntry}
      />
    </Space>
  )
}

export default TimecardPeriod
