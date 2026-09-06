import React, { useMemo, useState } from 'react'
import { Typography, Table, Button, Flex, Select, InputNumber, Badge, Tooltip, Empty } from 'antd'
import { LeftOutlined, RightOutlined, PlusOutlined, UnorderedListOutlined } from '@ant-design/icons'
import { Project, Activity } from '../../types'
import { TimecardEntry } from '../../api/timecards'
import {
  GridDay,
  GridWeek,
  GridRow,
  buildRows,
  columnTotals,
  rowKey
} from '../../utils/timecardGrid'
import { projectLabel, NONE } from './TimecardEntryTable'

const { Text } = Typography

interface TimecardWeekGridProps {
  entries: TimecardEntry[]
  projects: Project[]
  activities: Activity[]
  weeks: GridWeek[]
  weekNumber: number
  onWeekChange: (weekNumber: number) => void
  disabled: boolean
  onSetCell: (
    date: string,
    projectId: number | null,
    activityId: number | null,
    hours: number
  ) => void
  onOpenDay: (date: string) => void
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Tue 1", or "Sun 30 Aug" for a day borrowed from another month. */
function dayLabel(day: GridDay): string {
  const [, month, date] = day.date.split('-').map(Number)
  const weekday = WEEKDAYS[day.weekday]
  return day.inPeriod ? `${weekday} ${date}` : `${weekday} ${date} ${MONTHS[month - 1]}`
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
  weeks,
  weekNumber,
  onWeekChange,
  disabled,
  onSetCell,
  onOpenDay
}) => {
  // Rows for projects with no time this week yet, kept until the view moves.
  const [extraRows, setExtraRows] = useState<GridRow[]>([])
  const [adding, setAdding] = useState(false)
  const [newProject, setNewProject] = useState<number>(NONE)
  const [newActivity, setNewActivity] = useState<number>(NONE)

  const week = weeks.find(w => w.number === weekNumber) ?? weeks[0]
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

  const columns = [
    {
      title: 'Project',
      key: 'project',
      width: 220,
      render: (_: unknown, row: GridRow) => (
        <Text style={{ fontSize: 13 }}>
          {row.project_id === null ? (
            <Text type="warning">Unassigned</Text>
          ) : (
            projectLabel(projectById.get(row.project_id))
          )}
        </Text>
      )
    },
    {
      title: 'Activity',
      key: 'activity',
      width: 160,
      render: (_: unknown, row: GridRow) => (
        <Text type="secondary" style={{ fontSize: 13 }}>
          {row.activity_id === null ? 'No activity' : activityById.get(row.activity_id)?.name}
        </Text>
      )
    },
    ...week.days.map(day => ({
      key: day.date,
      width: 108,
      align: 'center' as const,
      title: (
        <Flex vertical align="center" gap={0}>
          <Button
            type="link"
            size="small"
            style={{ padding: 0, height: 'auto', fontWeight: 600 }}
            disabled={!day.inPeriod}
            onClick={() => onOpenDay(day.date)}
            aria-label={`Items on ${day.date}`}
          >
            {dayLabel(day)}
          </Button>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {/* A non-breaking space keeps the borrowed columns the same
                height as the rest; the greyed date already says enough. */}
            {day.inPeriod ? hours(totals.byDate[day.date] ?? 0) : ' '}
          </Text>
        </Flex>
      ),
      render: (_: unknown, row: GridRow) => {
        if (!day.inPeriod) {
          // Shown for shape, never editable: this day is another card's.
          return <span aria-hidden style={{ opacity: 0.35 }}>—</span>
        }

        const cell = row.cells[day.date]
        // The activity belongs in the label: one project can have several
        // rows in the same week, and they need telling apart.
        const project =
          row.project_id === null ? 'Unassigned' : projectById.get(row.project_id)?.code
        const activity =
          row.activity_id === null
            ? 'no activity'
            : activityById.get(row.activity_id)?.name ?? 'no activity'
        const label = `${project}, ${activity} on ${day.date}`

        return (
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
                onSetCell(day.date, row.project_id, row.activity_id, next)
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
                    onClick={() => onOpenDay(day.date)}
                    aria-label={`Items behind ${label}`}
                  />
                </Badge>
              </Tooltip>
            ) : (
              <span style={{ display: 'inline-block', width: 24 }} />
            )}
          </Flex>
        )
      }
    })),
    {
      title: 'Total',
      key: 'total',
      width: 90,
      align: 'right' as const,
      render: (_: unknown, row: GridRow) => <Text strong>{hours(row.total)}</Text>
    }
  ]

  return (
    <Flex vertical gap={12}>
      <Flex align="center" gap={8} wrap>
        <Button
          icon={<LeftOutlined />}
          disabled={weekNumber <= 1}
          onClick={() => onWeekChange(weekNumber - 1)}
          aria-label="Previous week"
        />
        <Select
          value={week.number}
          style={{ minWidth: 260 }}
          onChange={onWeekChange}
          aria-label="Week"
          options={weeks.map(w => ({
            value: w.number,
            label: `Week ${w.number} — ${w.firstInPeriod} to ${w.lastInPeriod}`
          }))}
        />
        <Button
          icon={<RightOutlined />}
          disabled={weekNumber >= weeks.length}
          onClick={() => onWeekChange(weekNumber + 1)}
          aria-label="Next week"
        />
        <div style={{ flexGrow: 1 }} />
        <Text strong>{totals.total.toFixed(2)} hours this week</Text>
      </Flex>

      <Table
        columns={columns}
        dataSource={rows}
        rowKey="key"
        pagination={false}
        size="small"
        scroll={{ x: 'max-content' }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Nothing this week. Pull from events, or add a row."
            />
          )
        }}
      />

      {adding ? (
        <Flex gap={8} wrap align="center">
          <Select
            value={newProject}
            style={{ minWidth: 220 }}
            onChange={setNewProject}
            aria-label="Project for the new row"
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
