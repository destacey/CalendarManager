import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Typography, Space, Button, Tag, Popconfirm, Flex, Alert, Segmented, Spin } from 'antd'
import { ArrowLeftOutlined, SyncOutlined, LockOutlined } from '@ant-design/icons'
import { Project, Activity } from '../../types'
import { useMessage } from '../../contexts/MessageContext'
import {
  Timecard, TimecardEntry, EntryInput,
  getTimecardEntries, generateTimecardEntries, addTimecardEntry,
  updateTimecardEntry, deleteTimecardEntry, setTimecardCell,
  submitTimecard, reopenTimecard, TimecardSubmittedError
} from '../../api/timecards'
import { getProjects } from '../../api/projects'
import { getActivities } from '../../api/activities'
import { storageService } from '../../services/storage'
import { weeksOf } from '../../utils/timecardGrid'
import TimecardWeekGrid from './TimecardWeekGrid'
import TimecardDayModal from './TimecardDayModal'
import TimecardSummary from './TimecardSummary'
import TimecardEntryTable from './TimecardEntryTable'

const { Text, Title } = Typography

interface TimecardDetailProps {
  timecard: Timecard
  onBack: () => void
  onChanged: (timecard: Timecard) => void
}

type View = 'Week' | 'Summary' | 'Entries'

const TimecardDetail: React.FC<TimecardDetailProps> = ({ timecard, onBack, onChanged }) => {
  const messageApi = useMessage()
  const [entries, setEntries] = useState<TimecardEntry[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<View>('Week')
  const [weekNumber, setWeekNumber] = useState(1)
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<{ unmapped: number; kept: number } | null>(null)

  const submitted = timecard.status === 'submitted'

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [e, p, a] = await Promise.all([
        getTimecardEntries(timecard.id!),
        getProjects(),
        getActivities()
      ])
      setEntries(e)
      setProjects(p)
      setActivities(a)
    } catch (error) {
      console.error('Error loading timecard:', error)
      messageApi.error('Failed to load the timecard')
    } finally {
      setLoading(false)
    }
  }, [timecard.id, messageApi])

  useEffect(() => {
    load()
  }, [load])

  const weeks = useMemo(
    () => weeksOf(timecard.start_date, timecard.end_date),
    [timecard.start_date, timecard.end_date]
  )

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
    setBusy(true)
    try {
      const workingDays = await storageService.getWorkingDays()
      const result = await generateTimecardEntries(timecard.id!, workingDays)
      setLastRun({ unmapped: result.unmappedEvents, kept: result.manualEntriesKept })
      messageApi.success(
        `Pulled ${result.eventsRead} event${result.eventsRead === 1 ? '' : 's'} into ` +
          `${result.entriesCreated} entr${result.entriesCreated === 1 ? 'y' : 'ies'}`
      )
      await load()
      onChanged({ ...timecard, generated_at: new Date().toISOString() })
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
    const updated = await submitTimecard(timecard.id!)
    if (updated) {
      onChanged(updated)
      messageApi.success('Timecard submitted')
    }
  }

  const handleReopen = async () => {
    const updated = await reopenTimecard(timecard.id!)
    if (updated) {
      onChanged(updated)
      messageApi.success('Timecard reopened')
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
      () => setTimecardCell(timecard.id!, { date, project_id: projectId, activity_id: activityId, hours }),
      'Failed to set that cell'
    )

  const addEntry = (entry: EntryInput) =>
    run(() => addTimecardEntry(timecard.id!, entry), 'Failed to add an entry')

  const totalHours = entries.reduce((sum, e) => sum + e.hours, 0)

  /** Hours per project, biggest first — the number the timecard exists for. */
  const byProject = useMemo(() => {
    const totals = new Map<number | null, number>()
    for (const entry of entries) {
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
  }, [entries, projectById])

  const dayEntries = useMemo(
    () => (openDay === null ? [] : entries.filter(e => e.date === openDay)),
    [entries, openDay]
  )

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Flex align="center" gap={12} wrap>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          All timecards
        </Button>
        <Title level={3} style={{ marginBottom: 0 }}>
          {timecard.name}
        </Title>
        <Text type="secondary">
          {timecard.start_date} to {timecard.end_date}
        </Text>
        {submitted && (
          <Tag icon={<LockOutlined />} color="success" style={{ marginInlineEnd: 0 }}>
            Submitted
          </Tag>
        )}
        <div style={{ flexGrow: 1 }} />
        <Button icon={<SyncOutlined />} onClick={handleGenerate} disabled={submitted || busy}>
          {timecard.generated_at ? 'Refresh from events' : 'Pull from events'}
        </Button>
        {submitted ? (
          <Button onClick={handleReopen}>Reopen</Button>
        ) : (
          <Popconfirm
            title="Submit this timecard?"
            description="It becomes read-only until you reopen it."
            okText="Submit"
            cancelText="Cancel"
            onConfirm={handleSubmit}
          >
            <Button type="primary" disabled={busy}>
              Submit
            </Button>
          </Popconfirm>
        )}
      </Flex>

      {submitted && (
        <Alert
          type="info"
          showIcon
          title="This timecard is submitted"
          description="It cannot be edited or refreshed. Reopen it to make changes — the calendar keeps syncing underneath either way."
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
        <Text strong>{totalHours.toFixed(2)} hours</Text>
        {byProject.map(({ projectId, hours, project }) => (
          <Text key={projectId ?? 'none'} type="secondary">
            {project ? `${project.code} ${hours.toFixed(2)}` : `Unassigned ${hours.toFixed(2)}`}
          </Text>
        ))}
      </Flex>

      <Spin spinning={loading}>
        {view === 'Week' && (
          <TimecardWeekGrid
            entries={entries}
            projects={projects}
            activities={activities}
            weeks={weeks}
            weekNumber={weekNumber}
            onWeekChange={setWeekNumber}
            disabled={submitted || busy}
            onSetCell={setCell}
            onOpenDay={setOpenDay}
          />
        )}

        {view === 'Summary' && (
          <TimecardSummary
            entries={entries}
            projects={projects}
            activities={activities}
            weeks={weeks}
          />
        )}

        {view === 'Entries' && (
          <TimecardEntryTable
            entries={entries}
            projects={projects}
            activities={activities}
            disabled={submitted || busy}
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

export default TimecardDetail
