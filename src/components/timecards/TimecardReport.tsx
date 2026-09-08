import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Typography, DatePicker, Flex, Space, Button } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import ExcelJS from 'exceljs'
import dayjs, { Dayjs } from 'dayjs'
import { Project, Activity } from '../../types'
import { useMessage } from '../../contexts/MessageContext'
import { TimecardEntry, getTimecardEntriesInRange } from '../../api/timecards'
import { getProjects } from '../../api/projects'
import { getActivities } from '../../api/activities'
import { saveFile } from '../../api/files'
import { totalsByProjectActivity, TotalRow } from '../../utils/timecardGrid'
import { projectLabel } from './TimecardEntryTable'
import { DataGrid } from '../grid'
import type { ColumnDef } from '../grid'

const { Text } = Typography

/**
 * What a stretch of time came to, by project and activity.
 *
 * No dates in it, deliberately: the day-by-day view is the timecard itself,
 * and what gets reported is the total. The range is free rather than a
 * timecard's own period, so a month, a quarter or a fortnight are all just
 * two dates — none of which a weekly timecard could answer on its own.
 *
 * Read by date across every timecard, so a week spanning the end of the range
 * contributes only the days inside it.
 */
const TimecardReport: React.FC = () => {
  const messageApi = useMessage()
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [
    dayjs().startOf('month'),
    dayjs().endOf('month')
  ])
  const [entries, setEntries] = useState<TimecardEntry[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)

  const start = range[0].format('YYYY-MM-DD')
  const end = range[1].format('YYYY-MM-DD')

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [e, p, a] = await Promise.all([
        getTimecardEntriesInRange(start, end),
        getProjects(),
        getActivities()
      ])
      setEntries(e)
      setProjects(p)
      setActivities(a)
    } catch (error) {
      console.error('Error loading the report:', error)
      messageApi.error('Failed to load the report')
    } finally {
      setLoading(false)
    }
  }, [start, end, messageApi])

  useEffect(() => {
    load()
  }, [load])

  const projectById = useMemo(() => new Map(projects.map(p => [p.id!, p])), [projects])
  const activityById = useMemo(() => new Map(activities.map(a => [a.id!, a])), [activities])

  const rows = useMemo(() => totalsByProjectActivity(entries), [entries])
  const total = rows.reduce((sum, row) => sum + row.hours, 0)

  /** The same rows, named, for a spreadsheet and for the table alike. */
  const named = useMemo(
    () =>
      rows.map(row => ({
        project: row.project_id === null ? 'Unassigned' : projectById.get(row.project_id)?.code ?? '',
        projectName:
          row.project_id === null ? '' : projectById.get(row.project_id)?.name ?? '',
        program: (row.project_id !== null && projectById.get(row.project_id)?.program) || '',
        activity:
          row.activity_id === null ? 'No activity' : activityById.get(row.activity_id)?.name ?? '',
        hours: row.hours
      })),
    [rows, projectById, activityById]
  )

  const handleExport = async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Timecard report')

    // The period belongs in the file, not only in its name: a spreadsheet
    // pasted into an email loses the name and keeps the cells.
    sheet.addRow([`Timecard report: ${start} to ${end}`])
    sheet.getRow(1).font = { bold: true, size: 14 }
    sheet.addRow([])

    const headers = ['Project', 'Project name', 'Program', 'Activity', 'Hours']
    sheet.addRow(headers)
    const headerRow = sheet.getRow(3)
    headerRow.font = { bold: true }
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }

    for (const row of named) {
      sheet.addRow([row.project, row.projectName, row.program, row.activity, row.hours])
    }

    const totalRow = sheet.addRow(['Total', '', '', '', total])
    totalRow.font = { bold: true }

    // Hours as numbers, so the spreadsheet can add them up itself.
    sheet.getColumn(5).numFmt = '0.00'
    sheet.columns.forEach(column => {
      let widest = 10
      column.eachCell?.({ includeEmpty: true }, cell => {
        widest = Math.max(widest, cell.value ? String(cell.value).length : 0)
      })
      column.width = Math.min(widest + 2, 50)
    })

    const buffer = await workbook.xlsx.writeBuffer()

    try {
      const saved = await saveFile(
        `Timecard report ${start} to ${end}.xlsx`,
        new Uint8Array(buffer as ArrayBuffer),
        'Excel Workbook',
        ['xlsx']
      )
      // A cancelled dialog is a normal outcome, not a failure — say nothing.
      if (saved) {
        messageApi.success(`Exported ${named.length} row${named.length === 1 ? '' : 's'}`)
      }
    } catch (error) {
      console.error('Export failed:', error)
      messageApi.error('Could not save the export')
    }
  }

  const columns: ColumnDef<TotalRow, unknown>[] = [
    {
      // No accessorKey: the visible and sorted value is the project's code,
      // looked up by id, not a field TotalRow carries directly. TanStack's
      // getCanSort() requires an accessorFn regardless of the custom sortFn.
      id: 'project',
      header: 'Project',
      accessorFn: row => projectById.get(row.project_id ?? -1)?.code ?? '',
      footer: 'Total',
      cell: ({ row }) =>
        row.original.project_id === null ? (
          <Text type="warning">Unassigned</Text>
        ) : (
          projectLabel(projectById.get(row.original.project_id))
        )
    },
    {
      id: 'program',
      header: 'Program',
      size: 180,
      accessorFn: row => (row.project_id !== null && projectById.get(row.project_id)?.program) || '',
      cell: ({ row }) => (
        <Text type="secondary">
          {(row.original.project_id !== null && projectById.get(row.original.project_id)?.program) ||
            '—'}
        </Text>
      )
    },
    {
      id: 'activity',
      header: 'Activity',
      size: 220,
      accessorFn: row => activityById.get(row.activity_id ?? -1)?.name ?? '',
      cell: ({ row }) => (
        <Text type="secondary">
          {row.original.activity_id === null
            ? 'No activity'
            : activityById.get(row.original.activity_id)?.name}
        </Text>
      )
    },
    {
      id: 'hours',
      header: 'Hours',
      size: 120,
      meta: { align: 'right' },
      // totalsByProjectActivity already returns rows sorted by hours
      // descending, and initialSorting below just makes that visible in the
      // header's sort indicator on first render — same as the antd
      // Table's defaultSortOrder did.
      accessorFn: row => row.hours,
      footer: () => total.toFixed(2),
      cell: ({ row }) => <Text strong>{row.original.hours.toFixed(2)}</Text>
    }
  ]

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      {/* No title: the tab above already says Report, and repeating it just
          crowded the controls. */}
      <Flex align="center" gap={12} wrap>
        <Text type="secondary">Period</Text>
        <DatePicker.RangePicker
          value={range}
          allowClear={false}
          aria-label="Period"
          format="D MMM YYYY"
          presets={[
            { label: 'This month', value: [dayjs().startOf('month'), dayjs().endOf('month')] },
            {
              label: 'Last month',
              value: [
                dayjs().subtract(1, 'month').startOf('month'),
                dayjs().subtract(1, 'month').endOf('month')
              ]
            },
            {
              label: 'Last 3 months',
              value: [dayjs().subtract(2, 'month').startOf('month'), dayjs().endOf('month')]
            },
            { label: 'This year', value: [dayjs().startOf('year'), dayjs().endOf('year')] }
          ]}
          onChange={value => {
            if (value?.[0] && value[1]) setRange([value[0], value[1]])
          }}
        />
        <div style={{ flexGrow: 1 }} />
        <Flex align="baseline" gap={6}>
          <Text strong style={{ fontSize: 22, lineHeight: 1 }}>
            {total.toFixed(2)}
          </Text>
          <Text type="secondary">hours</Text>
        </Flex>
        <Button
          icon={<DownloadOutlined />}
          onClick={handleExport}
          disabled={loading || rows.length === 0}
        >
          Export
        </Button>
      </Flex>

      <DataGrid<TotalRow>
        data={rows}
        columns={columns}
        isLoading={loading}
        getRowId={row => row.key}
        variant="advanced"
        persistStateKey="timecard-report"
        csvFileName="timecard-report"
        emptyMessage={`No time on any timecard between ${start} and ${end}`}
        initialSorting={[{ id: 'hours', desc: true }]}
      />
    </Space>
  )
}

export default TimecardReport
