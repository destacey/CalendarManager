import React, { useMemo, useState } from 'react'
import { Typography, Button, Flex, Select, InputNumber, Badge, Tooltip, Empty } from 'antd'
import { PlusOutlined, UnorderedListOutlined } from '@ant-design/icons'
import { Project, Activity } from '../../types'
import { TimecardEntry } from '../../api/timecards'
import { GridDay, GridWeek, GridRow, buildRows, columnTotals, rowKey } from '../../utils/timecardGrid'
import { projectLabel, NONE } from './TimecardEntryTable'
import { DataGrid } from '../grid'
import type { ColumnDef } from '../grid'

const { Text } = Typography

interface TimecardWeekGridProps {
  entries: TimecardEntry[]
  projects: Project[]
  activities: Activity[]
  /** The seven days this timecard covers. */
  week: GridWeek
  /**
   * The month being viewed, "YYYY-MM". A week can reach into the months
   * either side, and those days are marked so it is clear they count towards
   * the neighbouring month - but they take input like any other, because this
   * timecard is the only one that holds them.
   */
  month?: string
  disabled: boolean
  onSetCell: (
    date: string,
    projectId: number | null,
    activityId: number | null,
    hours: number
  ) => void
  /**
   * Opens the day. With a row, only what that row holds on that day — which
   * is what the affordance beside a cell means; the column header means the
   * whole day.
   */
  onOpenDay: (date: string, row?: GridRow) => void
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Tue 1", or "Sun 30 Aug" for a day belonging to a neighbouring month. */
function dayLabel(day: GridDay, month?: string): string {
  const [, monthNumber, date] = day.date.split('-').map(Number)
  const weekday = WEEKDAYS[day.weekday]
  const elsewhere = month !== undefined && day.date.slice(0, 7) !== month
  return elsewhere ? `${weekday} ${date} ${MONTHS[monthNumber - 1]}` : `${weekday} ${date}`
}

/**
 * Sorts by a label, with "nothing" after every real one.
 *
 * The absence is compared as a flag rather than as a stand-in character:
 * `'~'.localeCompare('S')` puts the tilde FIRST, because collation orders
 * punctuation before letters — the opposite of what a sentinel is for.
 */
function byLabel(a: [boolean, string], b: [boolean, string]): number {
  if (a[0] !== b[0]) return a[0] ? 1 : -1
  return a[1].localeCompare(b[1])
}

function codeOf(row: GridRow, projects: Map<number, Project>): [boolean, string] {
  if (row.project_id === null) return [true, '']
  return [false, projects.get(row.project_id)?.code ?? '']
}

function nameOf(row: GridRow, activities: Map<number, Activity>): [boolean, string] {
  if (row.activity_id === null) return [true, '']
  return [false, activities.get(row.activity_id)?.name ?? '']
}

/** True for a day this week reaches into a neighbouring month. */
function elsewhere(day: GridDay, month?: string): boolean {
  return month !== undefined && day.date.slice(0, 7) !== month
}

function hours(value: number): string {
  return value === 0 ? '—' : value.toFixed(2)
}

/**
 * A week of the timecard: projects down the side, days across the top.
 *
 * Days the week borrows from the neighbouring month are shown but dead —
 * a week that began on a Tuesday should still look like a week, and the
 * greyed columns say plainly which days belong to another timecard.
 */
const TimecardWeekGrid: React.FC<TimecardWeekGridProps> = ({
  entries,
  projects,
  activities,
  week,
  month,
  disabled,
  onSetCell,
  onOpenDay
}) => {
  // Rows for projects with no time this week yet, kept until the view moves.
  const [extraRows, setExtraRows] = useState<GridRow[]>([])
  const [adding, setAdding] = useState(false)
  const [newProject, setNewProject] = useState<number>(NONE)
  const [newActivity, setNewActivity] = useState<number>(NONE)

  const dates = useMemo(() => week?.days.map(d => d.date) ?? [], [week])

  const projectById = useMemo(() => new Map(projects.map(p => [p.id!, p])), [projects])
  const activityById = useMemo(() => new Map(activities.map(a => [a.id!, a])), [activities])

  const rows = useMemo(() => {
    const built = buildRows(entries, dates)
    const seen = new Set(built.map(r => r.key))
    const merged = [...built, ...extraRows.filter(r => !seen.has(r.key))]

    return merged.sort((a, b) => {
      // Unassigned last: it is a prompt to fix something, not a project.
      if (a.project_id === null) return b.project_id === null ? 0 : 1
      if (b.project_id === null) return -1
      const byProject = (projectById.get(a.project_id)?.code ?? '').localeCompare(
        projectById.get(b.project_id)?.code ?? ''
      )
      if (byProject !== 0) return byProject
      return (activityById.get(a.activity_id ?? -1)?.name ?? '').localeCompare(
        activityById.get(b.activity_id ?? -1)?.name ?? ''
      )
    })
  }, [entries, dates, extraRows, projectById, activityById])

  const totals = useMemo(() => columnTotals(rows, dates), [rows, dates])

  if (!week) return <Empty description="This timecard covers no days" />

  const addRow = () => {
    const projectId = newProject === NONE ? null : newProject
    const activityId = newActivity === NONE ? null : newActivity
    const key = rowKey(projectId, activityId)
    setExtraRows(current =>
      current.some(r => r.key === key)
        ? current
        : [...current, { key, project_id: projectId, activity_id: activityId, cells: {}, total: 0 }]
    )
    setAdding(false)
    setNewProject(NONE)
    setNewActivity(NONE)
  }

  const columns: ColumnDef<GridRow, unknown>[] = [
    {
      // No accessorKey — the visible and sorted value is looked up by id via
      // codeOf, not a field GridRow carries directly. TanStack's
      // getCanSort() requires an accessorFn regardless of the custom sortFn.
      id: 'project',
      header: 'Project',
      size: 220,
      accessorFn: row => codeOf(row, projectById)[1],
      sortFn: (a, b) => byLabel(codeOf(a.original, projectById), codeOf(b.original, projectById)),
      cell: ({ row }) => (
        <Text style={{ fontSize: 13 }}>
          {row.original.project_id === null ? (
            <Text type="warning">Unassigned</Text>
          ) : (
            projectLabel(projectById.get(row.original.project_id))
          )}
        </Text>
      )
    },
    {
      id: 'activity',
      header: 'Activity',
      size: 160,
      accessorFn: row => nameOf(row, activityById)[1],
      sortFn: (a, b) => byLabel(nameOf(a.original, activityById), nameOf(b.original, activityById)),
      cell: ({ row }) => (
        <Text type="secondary" style={{ fontSize: 13 }}>
          {row.original.activity_id === null
            ? 'No activity'
            : activityById.get(row.original.activity_id)?.name}
        </Text>
      )
    },
    ...week.days.map(
      (day): ColumnDef<GridRow, unknown> => ({
        id: day.date,
        size: 108,
        // Deliberately not sortable (no accessorFn/sortFn): this header is
        // already a button that opens the day, and a sorter on the same
        // cell would make one click do two things. Also holds its position —
        // the week's days must stay in order regardless of column reorder.
        meta: { enableReordering: false },
        header: () => (
          <Flex vertical align="center" gap={0}>
            <Button
              type="link"
              size="small"
              style={{
                padding: 0,
                height: 'auto',
                fontWeight: 600,
                // Dimmed, not disabled: the day counts towards the month next
                // door, but this timecard is the only one that holds it.
                opacity: elsewhere(day, month) ? 0.6 : 1
              }}
              onClick={() => onOpenDay(day.date)}
              aria-label={`Items on ${day.date}`}
            >
              {dayLabel(day, month)}
            </Button>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {hours(totals.byDate[day.date] ?? 0)}
            </Text>
          </Flex>
        ),
        cell: ({ row }) => {
          const cell = row.original.cells[day.date]
          // The activity belongs in the label: one project can have several
          // rows in the same week, and they need telling apart.
          const project =
            row.original.project_id === null
              ? 'Unassigned'
              : projectById.get(row.original.project_id)?.code
          const activity =
            row.original.activity_id === null
              ? 'no activity'
              : activityById.get(row.original.activity_id)?.name ?? 'no activity'
          const label = `${project}, ${activity} on ${day.date}`

          return (
            <div data-row-activate="ignore">
              <Flex align="center" justify="center" gap={4}>
                <InputNumber
                  size="small"
                  min={0}
                  max={24}
                  step={0.25}
                  value={cell?.hours ?? null}
                  disabled={disabled}
                  placeholder="—"
                  style={{ width: 62 }}
                  aria-label={label}
                  onBlur={e => {
                    const raw = (e.target as HTMLInputElement).value
                    const next = raw === '' ? 0 : Number(raw)
                    if (!Number.isFinite(next)) return
                    if (next === (cell?.hours ?? 0)) return
                    onSetCell(day.date, row.original.project_id, row.original.activity_id, next)
                  }}
                />
                {cell ? (
                  <Tooltip
                    title={
                      cell.entries === 1
                        ? 'One item — open the day'
                        : `${cell.entries} items — open the day`
                    }
                  >
                    <Badge
                      count={cell.entries > 1 ? cell.entries : 0}
                      size="small"
                      offset={[-2, 2]}
                    >
                      <Button
                        type="text"
                        size="small"
                        icon={<UnorderedListOutlined />}
                        style={{ opacity: cell.entries > 1 ? 1 : 0.45 }}
                        onClick={() => onOpenDay(day.date, row.original)}
                        aria-label={`Items behind ${label}`}
                      />
                    </Badge>
                  </Tooltip>
                ) : (
                  <span style={{ display: 'inline-block', width: 24 }} />
                )}
              </Flex>
            </div>
          )
        }
      })
    ),
    {
      id: 'total',
      header: 'Total',
      size: 90,
      meta: { align: 'right' },
      accessorFn: row => row.total,
      // TanStack defaults a numeric column's first click to descending; the
      // original antd sorter (like project/activity) went ascending first.
      sortDescFirst: false,
      cell: ({ row }) => <Text strong>{hours(row.original.total)}</Text>
    }
  ]

  return (
    <Flex vertical gap={12}>

      <DataGrid<GridRow>
        data={rows}
        columns={columns}
        getRowId={row => row.key}
        variant="simple"
        emptyMessage="Nothing this week. Pull from events, or add a row."
      />

      {adding ? (
        <Flex gap={8} wrap align="center">
          <Select
            value={newProject}
            style={{ minWidth: 220 }}
            onChange={setNewProject}
            aria-label="Project for the new row"
            showSearch
            optionFilterProp="label"
            options={[
              { value: NONE, label: 'Unassigned' },
              ...projects.filter(p => p.is_active).map(p => ({ value: p.id!, label: projectLabel(p) }))
            ]}
          />
          <Select
            value={newActivity}
            style={{ minWidth: 180 }}
            onChange={setNewActivity}
            aria-label="Activity for the new row"
            showSearch
            optionFilterProp="label"
            options={[
              { value: NONE, label: 'No activity' },
              ...activities.filter(a => a.is_active).map(a => ({ value: a.id!, label: a.name }))
            ]}
          />
          <Button type="primary" onClick={addRow}>
            Add
          </Button>
          <Button onClick={() => setAdding(false)}>Cancel</Button>
        </Flex>
      ) : (
        <div>
          <Button icon={<PlusOutlined />} disabled={disabled} onClick={() => setAdding(true)}>
            Add row
          </Button>
        </div>
      )}
    </Flex>
  )
}

export default TimecardWeekGrid
