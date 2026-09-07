import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Typography, Space, Button, Tag, Popconfirm, Flex, Alert, Segmented, Spin } from 'antd'
import { ArrowLeftOutlined, SyncOutlined, LockOutlined } from '@ant-design/icons'
import { Project, Activity, EventType } from '../../types'
import { useMessage } from '../../contexts/MessageContext'
import {
  Timecard, TimecardEntry, EntryInput,
  getTimecardEntries, generateTimecardEntries, addTimecardEntry,
  updateTimecardEntry, deleteTimecardEntry, setTimecardCell,
  submitTimecard, reopenTimecard, TimecardSubmittedError
} from '../../api/timecards'
import { getProjects } from '../../api/projects'
import { getActivities } from '../../api/activities'
import { getEventTypes } from '../../api/eventTypes'
import { mapEvents, unmapEvents } from '../../api/mapping'
import { storageService } from '../../services/storage'
import { weeksOf, GridRow } from '../../utils/timecardGrid'
import TimecardWeekGrid from './TimecardWeekGrid'
import TimecardDayModal from './TimecardDayModal'
import TimecardEntryTable from './TimecardEntryTable'

const { Text, Title } = Typography

interface TimecardWeekProps {
  timecard: Timecard
  onBack: () => void
  onChanged: (timecard: Timecard) => void
}

type View = 'Grid' | 'Entries'

/**
 * One week: the timecard itself.
 *
 * A week is the whole unit — it is what pulls from events, what gets edited,
 * and what gets submitted. Totals across a longer stretch are a report, not a
 * bigger timecard, which is what keeps this screen about seven days.
 */
const TimecardWeek: React.FC<TimecardWeekProps> = ({ timecard, onBack, onChanged }) => {
  const messageApi = useMessage()
  const [entries, setEntries] = useState<TimecardEntry[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [eventTypes, setEventTypes] = useState<EventType[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<View>('Grid')
  /* A day, and optionally the one row of it that was asked about: the
     affordance beside a cell means "what is behind THIS number", the column
     header means "everything on this day". */
  const [openDay, setOpenDay] = useState<{ date: string; row?: GridRow } | null>(null)
  const [lastRun, setLastRun] = useState<{ unmapped: number } | null>(null)

  const submitted = timecard.status === 'submitted'

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [e, p, a, t] = await Promise.all([
        getTimecardEntries(timecard.id!),
        getProjects(),
        getActivities(),
        getEventTypes()
      ])
      setEntries(e)
      setProjects(p)
      setActivities(a)
      setEventTypes(t)
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

  /* Exactly seven days, all of them this card's own. */
  const gridWeek = useMemo(
    () => weeksOf(timecard.start_date, timecard.end_date)[0],
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
      setLastRun({ unmapped: result.unmappedEvents })
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
      messageApi.success('Week submitted')
    }
  }

  const handleReopen = async () => {
    const updated = await reopenTimecard(timecard.id!)
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
        setTimecardCell(timecard.id!, {
          date,
          project_id: projectId,
          activity_id: activityId,
          hours
        }),
      'Failed to set that cell'
    )

  const addEntry = (entry: EntryInput) =>
    run(() => addTimecardEntry(timecard.id!, entry), 'Failed to add an entry')

  /**
   * Maps the EVENT, then re-pulls the week so the timecard agrees.
   *
   * Fixing the source is the point: the same event then arrives correctly
   * mapped on every future timecard instead of being corrected week by week.
   * The re-pull replaces only what generation owns, so anything typed over or
   * added by hand survives it.
   */
  const remapEvent = (eventId: number, projectId: number | null, activityId: number | null) =>
    run(async () => {
      if (projectId === null) await unmapEvents([eventId])
      else await mapEvents([eventId], projectId, activityId)

      // A submitted week refuses the re-pull; the event is still mapped, and
      // the refusal says why.
      const workingDays = await storageService.getWorkingDays()
      await generateTimecardEntries(timecard.id!, workingDays)
    }, 'Failed to map the event')

  const totalHours = entries.reduce((sum, e) => sum + e.hours, 0)

  const dayEntries = useMemo(() => {
    if (openDay === null) return []
    const onThatDay = entries.filter(e => e.date === openDay.date)
    const row = openDay.row
    if (!row) return onThatDay
    return onThatDay.filter(
      e => (e.project_id ?? null) === row.project_id && (e.activity_id ?? null) === row.activity_id
    )
  }, [entries, openDay])

  /** What the modal is showing, when it is not the whole day. */
  const openRowLabel = useMemo(() => {
    const row = openDay?.row
    if (!row) return undefined
    const project =
      row.project_id === null ? 'Unassigned' : projectById.get(row.project_id)?.code ?? 'Unassigned'
    const activity =
      row.activity_id === null
        ? 'no activity'
        : activities.find(a => a.id === row.activity_id)?.name ?? 'no activity'
    return `${project} · ${activity}`
  }, [openDay, projectById, activities])

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Flex align="center" gap={12} wrap>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          All timecards
        </Button>
        <Flex vertical gap={0}>
          <Title level={3} style={{ marginBottom: 0, lineHeight: 1.2 }}>
            {timecard.name}
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {timecard.start_date} to {timecard.end_date}
          </Text>
        </Flex>
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
            title="Submit this week?"
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
          title="This week is submitted"
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

      {/* The per-project breakdown used to live here as a row of figures. A
          real week has a dozen projects, which wrapped onto two lines and
          buried the controls; the grid's own Total column says the same thing
          per row, and the report says it across weeks. */}
      <Flex align="center" justify="space-between" gap={16} wrap>
        <Segmented
          value={view}
          onChange={value => setView(value as View)}
          options={['Grid', 'Entries']}
        />
        <Flex align="baseline" gap={6}>
          <Text strong style={{ fontSize: 22, lineHeight: 1 }}>
            {totalHours.toFixed(2)}
          </Text>
          <Text type="secondary">hours this week</Text>
        </Flex>
      </Flex>

      <Spin spinning={loading}>
        {view === 'Grid' && gridWeek && (
          <TimecardWeekGrid
            entries={entries}
            projects={projects}
            activities={activities}
            week={gridWeek}
            disabled={submitted || busy}
            onSetCell={setCell}
            onOpenDay={(date, row) => setOpenDay({ date, row })}
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
        date={openDay?.date ?? null}
        scope={openRowLabel}
        entries={dayEntries}
        projects={projects}
        activities={activities}
        eventTypes={eventTypes}
        disabled={submitted || busy}
        onClose={() => setOpenDay(null)}
        onRemapEvent={remapEvent}
        onPatchEntry={patch}
        onAdd={addEntry}
        defaults={openDay?.row}
        onDelete={entry => run(() => deleteTimecardEntry(entry.id!), 'Failed to delete the entry')}
      />
    </Space>
  )
}

export default TimecardWeek
