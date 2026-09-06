import React, { useMemo } from 'react'
import { Typography, Table, Empty } from 'antd'
import { Project, Activity } from '../../types'
import { TimecardEntry } from '../../api/timecards'
import { GridWeek, SummaryRow, summarise } from '../../utils/timecardGrid'
import { projectLabel } from './TimecardEntryTable'

const { Text } = Typography

interface TimecardSummaryProps {
  entries: TimecardEntry[]
  projects: Project[]
  activities: Activity[]
  weeks: GridWeek[]
}

function hours(value: number): string {
  return value === 0 ? '—' : value.toFixed(2)
}

/**
 * The number the timecard exists to produce: hours per project and activity
 * for the whole period, with the weeks that made them up.
 */
const TimecardSummary: React.FC<TimecardSummaryProps> = ({
  entries,
  projects,
  activities,
  weeks
}) => {
  const projectById = useMemo(() => new Map(projects.map(p => [p.id!, p])), [projects])
  const activityById = useMemo(() => new Map(activities.map(a => [a.id!, a])), [activities])

  const rows = useMemo(() => {
    return summarise(entries, weeks).sort((a, b) => {
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
  }, [entries, weeks, projectById, activityById])

  const grandTotal = rows.reduce((sum, row) => sum + row.total, 0)
  const weekTotals = weeks.map((_, index) =>
    rows.reduce((sum, row) => sum + row.byWeek[index], 0)
  )

  const columns = [
    {
      title: 'Project',
      key: 'project',
      render: (_: unknown, row: SummaryRow) =>
        row.project_id === null ? (
          <Text type="warning">Unassigned</Text>
        ) : (
          projectLabel(projectById.get(row.project_id))
        )
    },
    {
      title: 'Program',
      key: 'program',
      width: 160,
      render: (_: unknown, row: SummaryRow) => (
        <Text type="secondary">
          {(row.project_id !== null && projectById.get(row.project_id)?.program) || '—'}
        </Text>
      )
    },
    {
      title: 'Activity',
      key: 'activity',
      width: 180,
      render: (_: unknown, row: SummaryRow) => (
        <Text type="secondary">
          {row.activity_id === null ? 'No activity' : activityById.get(row.activity_id)?.name}
        </Text>
      )
    },
    ...weeks.map((week, index) => ({
      title: `Week ${week.number}`,
      key: `week-${week.number}`,
      width: 92,
      align: 'right' as const,
      render: (_: unknown, row: SummaryRow) => (
        <Text type="secondary">{hours(row.byWeek[index])}</Text>
      )
    })),
    {
      title: 'Total',
      key: 'total',
      width: 100,
      align: 'right' as const,
      render: (_: unknown, row: SummaryRow) => <Text strong>{row.total.toFixed(2)}</Text>
    }
  ]

  if (rows.length === 0) {
    return <Empty description="Nothing on this timecard yet" />
  }

  return (
    <Table
      columns={columns}
      dataSource={rows}
      rowKey="key"
      pagination={false}
      size="small"
      scroll={{ x: 'max-content' }}
      summary={() => (
        <Table.Summary.Row>
          <Table.Summary.Cell index={0} colSpan={3}>
            <Text strong>Total</Text>
          </Table.Summary.Cell>
          {weekTotals.map((total, index) => (
            <Table.Summary.Cell key={index} index={3 + index} align="right">
              <Text strong>{hours(total)}</Text>
            </Table.Summary.Cell>
          ))}
          <Table.Summary.Cell index={3 + weeks.length} align="right">
            <Text strong>{grandTotal.toFixed(2)}</Text>
          </Table.Summary.Cell>
        </Table.Summary.Row>
      )}
    />
  )
}

export default TimecardSummary
