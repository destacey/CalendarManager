import React, { useMemo, useState, useEffect } from 'react'
import {
  Modal, Typography, Flex, Button, Table, Select, Tag, Empty, Alert, Popconfirm, InputNumber
} from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Project, Activity, Event, EventType } from '../../types'
import { TimecardEntry, EntryInput } from '../../api/timecards'
import { getEventsByIds } from '../../api/events'
import { projectLabel, NONE } from './TimecardEntryTable'

const { Text } = Typography

/** One line of the day: an entry, and the event it came from if it had one. */
interface DayRow {
  entry: TimecardEntry
  event?: Event
}

interface TimecardDayModalProps {
  date: string | null
  /** Set when only one row of the day is being shown, e.g. "PRJ-001 · Dev". */
  scope?: string
  entries: TimecardEntry[]
  projects: Project[]
  activities: Activity[]
  eventTypes: EventType[]
  disabled: boolean
  onClose: () => void
  /** Maps the event itself, then re-pulls so the timecard agrees. */
  onRemapEvent: (eventId: number, projectId: number | null, activityId: number | null) => void
  /** For an entry with no event, where the mapping is the entry's own. */
  onPatchEntry: (entry: TimecardEntry, changes: Partial<TimecardEntry>) => void
  onDelete: (entry: TimecardEntry) => void
  /** Time with no event behind it — a call, or work away from the calendar. */
  onAdd: (entry: EntryInput) => void
  /** The row this was opened from, so a new item starts where you looked. */
  defaults?: { project_id: number | null; activity_id: number | null }
}

/**
 * What a day is actually made of.
 *
 * The grid shows a cell's total; this shows the EVENTS behind it — their
 * titles, times and type — because that is what someone checking a number
 * wants to see, not a second copy of the total.
 *
 * Changing a project or activity here changes the EVENT, exactly as mapping
 * it on Map Events would, and the week is then re-pulled so the timecard
 * follows. Fixing the source means the same event arrives correctly mapped on
 * every future timecard rather than being corrected once a month.
 */
const TimecardDayModal: React.FC<TimecardDayModalProps> = ({
  date,
  scope,
  entries,
  projects,
  activities,
  eventTypes,
  disabled,
  onClose,
  onRemapEvent,
  onPatchEntry,
  onDelete,
  onAdd,
  defaults
}) => {
  const [events, setEvents] = useState<Map<number, Event>>(new Map())
  const [adding, setAdding] = useState(false)
  const [newProject, setNewProject] = useState<number>(NONE)
  const [newActivity, setNewActivity] = useState<number>(NONE)
  const [newHours, setNewHours] = useState<number>(1)

  const eventIds = useMemo(
    () => entries.map(e => e.event_id).filter((id): id is number => id != null),
    [entries]
  )
  const idKey = eventIds.join(',')

  useEffect(() => {
    if (date === null || eventIds.length === 0) {
      setEvents(new Map())
      return
    }

    let cancelled = false
    getEventsByIds(eventIds)
      .then(found => {
        if (!cancelled) setEvents(new Map(found.map(e => [e.id as number, e])))
      })
      .catch(error => console.error('Error reading the events behind a day:', error))

    return () => {
      cancelled = true
    }
    // Keyed on the ids themselves: a reload rebuilds the array with the same
    // contents, and depending on the array would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, idKey])

  const rows = useMemo<DayRow[]>(
    () => entries.map(entry => ({ entry, event: events.get(entry.event_id ?? -1) })),
    [entries, events]
  )

  const total = useMemo(() => entries.reduce((sum, e) => sum + e.hours, 0), [entries])
  const typeById = useMemo(() => new Map(eventTypes.map(t => [t.id!, t])), [eventTypes])

  /** "09:00 – 09:15", or a word for the cases with no clock time. */
  const timeOf = (row: DayRow): string => {
    if (!row.event) return '—'
    if (row.event.is_all_day) return 'All day'
    const at = (value?: string) => (value ? value.slice(11, 16) : '')
    const end = at(row.event.end_date)
    return end ? `${at(row.event.start_date)} – ${end}` : at(row.event.start_date)
  }

  const remap = (
    row: DayRow,
    changes: { project_id?: number | null; activity_id?: number | null }
  ) => {
    // An entry with no event is the timecard's own, so it is the thing to
    // change: there is no source to fix.
    if (row.event?.id == null) {
      onPatchEntry(row.entry, changes)
      return
    }

    const project =
      changes.project_id !== undefined ? changes.project_id : row.entry.project_id ?? null
    const activity =
      changes.activity_id !== undefined ? changes.activity_id : row.entry.activity_id ?? null
    onRemapEvent(row.event.id as number, project, activity)
  }

  const startAdding = () => {
    // Opened from a cell, so a new item belongs to that cell until said
    // otherwise: retyping the project you were just looking at is busywork.
    setNewProject(defaults?.project_id ?? NONE)
    setNewActivity(defaults?.activity_id ?? NONE)
    setNewHours(1)
    setAdding(true)
  }

  const add = () => {
    onAdd({
      date: date!,
      hours: newHours,
      project_id: newProject === NONE ? null : newProject,
      activity_id: newActivity === NONE ? null : newActivity,
      note: null
    })
    setAdding(false)
  }

  const columns = [
    {
      title: 'Event',
      key: 'event',
      sorter: (a: DayRow, b: DayRow) => (a.event?.title ?? '').localeCompare(b.event?.title ?? ''),
      render: (_: unknown, row: DayRow) =>
        row.event ? (
          <Text>{row.event.title}</Text>
        ) : (
          <Text type="secondary">
            {row.entry.event_id == null ? 'Added by hand' : 'Event since deleted'}
          </Text>
        )
    },
    {
      title: 'Time',
      key: 'time',
      width: 130,
      sorter: (a: DayRow, b: DayRow) =>
        (a.event?.start_date ?? '').localeCompare(b.event?.start_date ?? ''),
      render: (_: unknown, row: DayRow) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {timeOf(row)}
        </Text>
      )
    },
    {
      title: 'Type',
      key: 'type',
      width: 130,
      sorter: (a: DayRow, b: DayRow) =>
        (typeById.get(a.event?.type_id ?? -1)?.name ?? '').localeCompare(
          typeById.get(b.event?.type_id ?? -1)?.name ?? ''
        ),
      render: (_: unknown, row: DayRow) => {
        const type = typeById.get(row.event?.type_id ?? -1)
        return type ? (
          <Tag color={type.color} style={{ marginInlineEnd: 0 }}>
            {type.name}
          </Tag>
        ) : (
          <Text type="secondary">—</Text>
        )
      }
    },
    {
      title: 'Hours',
      key: 'hours',
      width: 90,
      align: 'right' as const,
      sorter: (a: DayRow, b: DayRow) => a.entry.hours - b.entry.hours,
      render: (_: unknown, row: DayRow) => <Text>{row.entry.hours.toFixed(2)}</Text>
    },
    {
      title: 'Project',
      key: 'project',
      sorter: (a: DayRow, b: DayRow) => (a.entry.project_id ?? 0) - (b.entry.project_id ?? 0),
      render: (_: unknown, row: DayRow) => (
        <Select
          size="small"
          style={{ width: '100%', minWidth: 170 }}
          value={row.entry.project_id ?? NONE}
          disabled={disabled}
          showSearch
          optionFilterProp="label"
          aria-label={`Project for ${row.event?.title ?? 'this item'}`}
          onChange={value => remap(row, { project_id: value === NONE ? null : value })}
          options={[
            { value: NONE, label: 'Unassigned' },
            ...projects
              .filter(p => p.is_active || p.id === row.entry.project_id)
              .map(p => ({ value: p.id!, label: projectLabel(p) }))
          ]}
        />
      )
    },
    {
      title: 'Activity',
      key: 'activity',
      sorter: (a: DayRow, b: DayRow) => (a.entry.activity_id ?? 0) - (b.entry.activity_id ?? 0),
      render: (_: unknown, row: DayRow) => (
        <Select
          size="small"
          style={{ width: '100%', minWidth: 150 }}
          value={row.entry.activity_id ?? NONE}
          disabled={disabled}
          showSearch
          optionFilterProp="label"
          aria-label={`Activity for ${row.event?.title ?? 'this item'}`}
          onChange={value => remap(row, { activity_id: value === NONE ? null : value })}
          options={[
            { value: NONE, label: 'No activity' },
            ...activities
              .filter(a => a.is_active || a.id === row.entry.activity_id)
              .map(a => ({ value: a.id!, label: a.name }))
          ]}
        />
      )
    },
    {
      title: '',
      key: 'actions',
      width: 50,
      render: (_: unknown, row: DayRow) => (
        <Popconfirm
          title="Remove this from the timecard?"
          description="The event itself is untouched."
          okText="Yes"
          cancelText="No"
          disabled={disabled}
          onConfirm={() => onDelete(row.entry)}
        >
          <Button
            icon={<DeleteOutlined />}
            size="small"
            danger
            disabled={disabled}
            aria-label={`Remove ${row.event?.title ?? 'this item'}`}
          />
        </Popconfirm>
      )
    }
  ]

  return (
    <Modal
      title={date ? (scope ? `${scope} on ${date}` : `Items on ${date}`) : ''}
      open={date !== null}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
      width={1100}
    >
      <Flex vertical gap={12}>
        <Flex justify="space-between" align="center" gap={16} wrap>
          <Text strong>{total.toFixed(2)} hours</Text>
          <Flex align="center" gap={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Changing a project or activity here maps the event itself
            </Text>
            <Button
              icon={<PlusOutlined />}
              size="small"
              disabled={disabled || adding}
              onClick={startAdding}
            >
              Add item
            </Button>
          </Flex>
        </Flex>

        {rows.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing on this day" />
        ) : (
          <Table
            columns={columns}
            dataSource={rows}
            rowKey={row => row.entry.id!}
            pagination={false}
            size="small"
          />
        )}

        {adding && (
          <Flex gap={8} wrap align="center">
            <InputNumber
              min={0}
              max={24}
              step={0.25}
              value={newHours}
              onChange={value => setNewHours(value ?? 0)}
              aria-label="Hours for the new item"
              style={{ width: 90 }}
            />
            <Select
              value={newProject}
              style={{ minWidth: 220 }}
              onChange={setNewProject}
              showSearch
              optionFilterProp="label"
              aria-label="Project for the new item"
              options={[
                { value: NONE, label: 'Unassigned' },
                ...projects
                  .filter(p => p.is_active)
                  .map(p => ({ value: p.id!, label: projectLabel(p) }))
              ]}
            />
            <Select
              value={newActivity}
              style={{ minWidth: 180 }}
              onChange={setNewActivity}
              showSearch
              optionFilterProp="label"
              aria-label="Activity for the new item"
              options={[
                { value: NONE, label: 'No activity' },
                ...activities.filter(a => a.is_active).map(a => ({ value: a.id!, label: a.name }))
              ]}
            />
            <Button type="primary" onClick={add}>
              Add
            </Button>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
          </Flex>
        )}

        {entries.some(e => e.source === 'cell') && (
          <Alert
            type="info"
            showIcon
            message="A cell here was typed in, so a refresh will not add event time to it."
          />
        )}
      </Flex>
    </Modal>
  )
}

export default TimecardDayModal
