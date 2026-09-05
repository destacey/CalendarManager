import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Typography, Space, Button, Table, Tag, Popconfirm, Flex, Alert, Select, InputNumber, Empty
} from 'antd'
import { ArrowLeftOutlined, SyncOutlined, PlusOutlined, DeleteOutlined, LockOutlined } from '@ant-design/icons'
import { Project, Activity } from '../../types'
import { useMessage } from '../../contexts/MessageContext'
import {
  Timecard, TimecardEntry,
  getTimecardEntries, generateTimecardEntries, addTimecardEntry,
  updateTimecardEntry, deleteTimecardEntry, submitTimecard, reopenTimecard,
  TimecardSubmittedError
} from '../../api/timecards'
import { getProjects } from '../../api/projects'
import { getActivities } from '../../api/activities'
import { storageService } from '../../services/storage'

const { Text, Title } = Typography

interface TimecardDetailProps {
  timecard: Timecard
  onBack: () => void
  onChanged: (timecard: Timecard) => void
}

const NONE = -1

const TimecardDetail: React.FC<TimecardDetailProps> = ({ timecard, onBack, onChanged }) => {
  const messageApi = useMessage()
  const [entries, setEntries] = useState<TimecardEntry[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
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
          project_id: changes.project_id !== undefined ? changes.project_id : entry.project_id ?? null,
          activity_id:
            changes.activity_id !== undefined ? changes.activity_id : entry.activity_id ?? null,
          note: entry.note ?? null
        }),
      'Failed to update the entry'
    )

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

  const columns = [
    {
      title: 'Date',
      dataIndex: 'date',
      key: 'date',
      width: 120,
      sorter: (a: TimecardEntry, b: TimecardEntry) => a.date.localeCompare(b.date),
      defaultSortOrder: 'ascend' as const
    },
    {
      title: 'Hours',
      dataIndex: 'hours',
      key: 'hours',
      width: 110,
      render: (hours: number, record: TimecardEntry) => (
        <InputNumber
          size="small"
          min={0}
          max={24}
          step={0.25}
          value={hours}
          disabled={submitted || busy}
          style={{ width: 80 }}
          aria-label={`Hours on ${record.date}`}
          onBlur={e => {
            const next = Number((e.target as HTMLInputElement).value)
            if (Number.isFinite(next) && next !== hours) patch(record, { hours: next })
          }}
        />
      )
    },
    {
      title: 'Project',
      key: 'project',
      render: (_: unknown, record: TimecardEntry) => (
        <Select
          size="small"
          style={{ width: '100%', minWidth: 170 }}
          value={record.project_id ?? NONE}
          disabled={submitted || busy}
          aria-label={`Project on ${record.date}`}
          onChange={value => patch(record, { project_id: value === NONE ? null : value })}
          options={[
            { value: NONE, label: 'Unassigned' },
            ...projects
              .filter(p => p.is_active || p.id === record.project_id)
              .map(p => ({ value: p.id!, label: `${p.code} — ${p.name}` }))
          ]}
        />
      )
    },
    {
      title: 'Activity',
      key: 'activity',
      render: (_: unknown, record: TimecardEntry) => (
        <Select
          size="small"
          style={{ width: '100%', minWidth: 150 }}
          value={record.activity_id ?? NONE}
          disabled={submitted || busy}
          aria-label={`Activity on ${record.date}`}
          onChange={value => patch(record, { activity_id: value === NONE ? null : value })}
          options={[
            { value: NONE, label: 'No activity' },
            ...activities
              .filter(a => a.is_active || a.id === record.activity_id)
              .map(a => ({ value: a.id!, label: a.name }))
          ]}
        />
      )
    },
    {
      title: 'Source',
      dataIndex: 'source',
      key: 'source',
      width: 110,
      render: (source: string, record: TimecardEntry) =>
        source === 'manual' ? (
          // Worth showing: a manual entry is the one a refresh will not touch.
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>
            Yours
          </Tag>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.event_id == null ? 'Event (deleted)' : 'From event'}
          </Text>
        )
    },
    {
      title: '',
      key: 'actions',
      width: 60,
      render: (_: unknown, record: TimecardEntry) => (
        <Popconfirm
          title="Delete this entry?"
          okText="Yes"
          cancelText="No"
          disabled={submitted}
          onConfirm={() => run(() => deleteTimecardEntry(record.id!), 'Failed to delete the entry')}
        >
          <Button
            icon={<DeleteOutlined />}
            size="small"
            danger
            disabled={submitted}
            aria-label={`Delete entry on ${record.date}`}
          />
        </Popconfirm>
      )
    }
  ]

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
        <Button
          icon={<PlusOutlined />}
          disabled={submitted || busy}
          onClick={() =>
            run(
              () =>
                addTimecardEntry(timecard.id!, {
                  date: timecard.start_date,
                  hours: 1,
                  project_id: projects.find(p => p.is_active)?.id ?? null,
                  activity_id: null
                }),
              'Failed to add an entry'
            )
          }
        >
          Add entry
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
          title={`${lastRun.unmapped} event${lastRun.unmapped === 1 ? '' : 's'} produced no entry`}
          description="They have no project. Map them on the Map Events screen, then refresh."
        />
      )}

      {byProject.length > 0 && (
        <Flex gap={16} wrap>
          <Text strong>{totalHours.toFixed(2)} hours</Text>
          {byProject.map(({ projectId, hours, project }) => (
            <Text key={projectId ?? 'none'} type="secondary">
              {project ? `${project.code} ${hours.toFixed(2)}` : `Unassigned ${hours.toFixed(2)}`}
            </Text>
          ))}
        </Flex>
      )}

      {!loading && entries.length === 0 ? (
        <Empty
          description={
            timecard.generated_at
              ? 'No entries — every event in this period was unmapped, or there were none'
              : 'Nothing here yet. Pull from events to fill it.'
          }
        />
      ) : (
        <Table
          columns={columns}
          dataSource={entries}
          loading={loading}
          rowKey="id"
          pagination={false}
          size="small"
        />
      )}
    </Space>
  )
}

export default TimecardDetail
