import React from 'react'
import { Typography, Tag, Popconfirm, Button, Select, InputNumber, Input } from 'antd'
import { DeleteOutlined } from '@ant-design/icons'
import { Project, Activity } from '../../types'
import { TimecardEntry } from '../../api/timecards'
import { DataGrid } from '../grid'
import type { ColumnDef } from '../grid'

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
  const columns: ColumnDef<TimecardEntry, unknown>[] = [
    ...(showDate
      ? [
          {
            accessorKey: 'date',
            header: 'Date',
            size: 120,
            sortFn: (a, b) => a.original.date.localeCompare(b.original.date),
          } as ColumnDef<TimecardEntry, unknown>
        ]
      : []),
    {
      accessorKey: 'hours',
      header: 'Hours',
      size: 110,
      cell: ({ row }) => {
        const record = row.original
        return (
          <div data-row-activate="ignore">
            <InputNumber
              size="small"
              min={0}
              max={24}
              step={0.25}
              value={record.hours}
              disabled={disabled}
              style={{ width: 80 }}
              aria-label={`Hours on ${record.date}`}
              onBlur={e => {
                const next = Number((e.target as HTMLInputElement).value)
                if (Number.isFinite(next) && next !== record.hours) onPatch(record, { hours: next })
              }}
            />
          </div>
        )
      }
    },
    {
      id: 'project',
      header: 'Project',
      cell: ({ row }) => {
        const record = row.original
        return (
          <div data-row-activate="ignore">
            <Select
              size="small"
              style={{ width: '100%', minWidth: 170 }}
              value={record.project_id ?? NONE}
              disabled={disabled}
              aria-label={`Project on ${record.date}`}
              showSearch
              optionFilterProp="label"
              onChange={value => onPatch(record, { project_id: value === NONE ? null : value })}
              options={[
                { value: NONE, label: 'Unassigned' },
                ...projects
                  .filter(p => p.is_active || p.id === record.project_id)
                  .map(p => ({ value: p.id!, label: projectLabel(p) }))
              ]}
            />
          </div>
        )
      }
    },
    {
      id: 'activity',
      header: 'Activity',
      cell: ({ row }) => {
        const record = row.original
        return (
          <div data-row-activate="ignore">
            <Select
              size="small"
              style={{ width: '100%', minWidth: 150 }}
              value={record.activity_id ?? NONE}
              disabled={disabled}
              aria-label={`Activity on ${record.date}`}
              showSearch
              optionFilterProp="label"
              onChange={value => onPatch(record, { activity_id: value === NONE ? null : value })}
              options={[
                { value: NONE, label: 'No activity' },
                ...activities
                  .filter(a => a.is_active || a.id === record.activity_id)
                  .map(a => ({ value: a.id!, label: a.name }))
              ]}
            />
          </div>
        )
      }
    },
    ...(showNote
      ? [
          {
            accessorKey: 'note',
            header: 'Note',
            cell: ({ row }: { row: { original: TimecardEntry } }) => {
              const record = row.original
              return (
                <div data-row-activate="ignore">
                  <Input
                    size="small"
                    defaultValue={record.note ?? ''}
                    placeholder="Add a note"
                    disabled={disabled}
                    aria-label={`Note on ${record.date}`}
                    onBlur={e => {
                      const next = e.target.value.trim()
                      if (next !== (record.note ?? '')) onPatch(record, { note: next || null })
                    }}
                  />
                </div>
              )
            }
          } as ColumnDef<TimecardEntry, unknown>
        ]
      : []),
    {
      accessorKey: 'source',
      header: 'Source',
      size: 130,
      cell: ({ row }) => {
        const record = row.original
        if (record.source === 'cell') {
          // Worth distinguishing: this one also keeps events out of its cell.
          return (
            <Tag color="purple" style={{ marginInlineEnd: 0 }}>
              Typed in
            </Tag>
          )
        }
        if (record.source === 'manual') {
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
      id: 'actions',
      header: '',
      size: 60,
      cell: ({ row }) => {
        const record = row.original
        return (
          <div data-row-activate="ignore">
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
          </div>
        )
      }
    }
  ]

  return (
    <DataGrid<TimecardEntry>
      data={entries}
      columns={columns}
      getRowId={row => String(row.id)}
      variant="simple"
      initialSorting={showDate ? [{ id: 'date', desc: false }] : undefined}
    />
  )
}

export default TimecardEntryTable
