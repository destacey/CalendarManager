import React from 'react'
import { Typography, Table, Tag, Popconfirm, Button, Select, InputNumber, Input } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import { Project, Activity } from '../../types'
import { TimecardEntry } from '../../api/timecards'

const { Text } = Typography

/** Selects need a value for "none"; null is not one antd will hold onto. */
export const NONE = -1

interface TimecardEntryTableProps {
  entries: TimecardEntry[]
  projects: Project[]
  activities: Activity[]
  disabled: boolean
  onPatch: (entry: TimecardEntry, changes: Partial<TimecardEntry>) => void
  onDelete: (entry: TimecardEntry) => void
  /** The day view already knows the date; the month-wide view does not. */
  showDate?: boolean
  showNote?: boolean
}

export function projectLabel(project: Project | undefined): string {
  if (!project) return 'Unassigned'
  return `${project.code} — ${project.name}`
}

/**
 * The individual entries behind a timecard, editable in place.
 *
 * Used twice: for a whole timecard on the Entries view, and for one day in
 * the day modal. The grid shows sums; this is the only place the entries
 * themselves — their notes, and which event produced them — are visible.
 */
const TimecardEntryTable: React.FC<TimecardEntryTableProps> = ({
  entries,
  projects,
  activities,
  disabled,
  onPatch,
  onDelete,
  showDate = true,
  showNote = false
}) => {
  const columns = [
    ...(showDate
      ? [
          {
            title: 'Date',
            dataIndex: 'date',
            key: 'date',
            width: 120,
            sorter: (a: TimecardEntry, b: TimecardEntry) => a.date.localeCompare(b.date),
            defaultSortOrder: 'ascend' as const
          }
        ]
      : []),
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
          disabled={disabled}
          style={{ width: 80 }}
          aria-label={`Hours on ${record.date}`}
          onBlur={e => {
            const next = Number((e.target as HTMLInputElement).value)
            if (Number.isFinite(next) && next !== hours) onPatch(record, { hours: next })
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
          disabled={disabled}
          aria-label={`Project on ${record.date}`}
          onChange={value => onPatch(record, { project_id: value === NONE ? null : value })}
          options={[
            { value: NONE, label: 'Unassigned' },
            ...projects
              .filter(p => p.is_active || p.id === record.project_id)
              .map(p => ({ value: p.id!, label: projectLabel(p) }))
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
          disabled={disabled}
          aria-label={`Activity on ${record.date}`}
          onChange={value => onPatch(record, { activity_id: value === NONE ? null : value })}
          options={[
            { value: NONE, label: 'No activity' },
            ...activities
              .filter(a => a.is_active || a.id === record.activity_id)
              .map(a => ({ value: a.id!, label: a.name }))
          ]}
        />
      )
    },
    ...(showNote
      ? [
          {
            title: 'Note',
            dataIndex: 'note',
            key: 'note',
            render: (note: string | null, record: TimecardEntry) => (
              <Input
                size="small"
                defaultValue={note ?? ''}
                placeholder="Add a note"
                disabled={disabled}
                aria-label={`Note on ${record.date}`}
                onBlur={e => {
                  const next = e.target.value.trim()
                  if (next !== (note ?? '')) onPatch(record, { note: next || null })
                }}
              />
            )
          }
        ]
      : []),
    {
      title: 'Source',
      dataIndex: 'source',
      key: 'source',
      width: 130,
      render: (source: string, record: TimecardEntry) => {
        if (source === 'cell') {
          // Worth distinguishing: this one also keeps events out of its cell.
          return (
            <Tag color="purple" style={{ marginInlineEnd: 0 }}>
              Typed in
            </Tag>
          )
        }
        if (source === 'manual') {
          return (
            <Tag color="blue" style={{ marginInlineEnd: 0 }}>
              Yours
            </Tag>
          )
        }
        return (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.event_id == null ? 'Event (deleted)' : 'From event'}
          </Text>
        )
      }
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
          disabled={disabled}
          onConfirm={() => onDelete(record)}
        >
          <Button
            icon={<DeleteOutlined />}
            size="small"
            danger
            disabled={disabled}
            aria-label={`Delete entry on ${record.date}`}
          />
        </Popconfirm>
      )
    }
  ]

  return (
    <Table
      columns={columns}
      dataSource={entries}
      rowKey="id"
      pagination={false}
      size="small"
    />
  )
}

export default TimecardEntryTable
