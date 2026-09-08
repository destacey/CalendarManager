import React, { useMemo, useState, useCallback } from 'react'
import { Typography, Tag, Tooltip, Button, Select } from 'antd'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import ExcelJS from 'exceljs'
import { Event, EventType, Project, Activity } from '../../types'
import { calculateEventDuration } from '../../utils/eventUtils'
import { useMessage } from '../../contexts/MessageContext'
import { saveFile } from '../../api/files'
import { mapEvents, unmapEvents } from '../../api/mapping'
import { DataGrid, createCsvColumn } from '../grid'
import type { ColumnDef } from '../grid'

const { Text } = Typography

/* Title is the widest column and the one worth reading, so it gets the most
   room. This is the floor a drag-resize may never take it below - see the
   comment on the column itself. */
const TITLE_MIN_WIDTH = 200

/** Cells that read as centred under the old table, kept so the migration
    changes no cell's appearance. */
const centred: React.CSSProperties = { textAlign: 'center' }

interface EventTableProps {
  currentDate: Dayjs
  getEventsForDate: (date: Dayjs) => Event[]
  getEventDisplayColor?: (event: Event) => string
  getEventBackgroundColor: (showAs: string) => string
  setSelectedEvent: (event: Event) => void
  setIsModalVisible: (visible: boolean) => void
  userTimezone: string
  eventTypes: EventType[]
  projects: Project[]
  activities: Activity[]
  /** Called after an inline mapping change, so the grid can reload. */
  onMappingChanged?: () => void
  onExportReady?: (exportFn: () => void) => void
}

/** Sentinel for "no activity" / "not mapped" — a real answer, not an absence. */
const NONE = -1

/**
 * One editable mapping cell. Reads as plain text until clicked, then becomes a
 * Select, so a grid of 500 rows is not 1,000 mounted form controls.
 *
 * Changing the project clears the activity: activities are not project-scoped
 * today, but an activity chosen for one project is a claim about that project,
 * and silently carrying it across is worse than asking again.
 */
export const MappingCell: React.FC<{
  record: TableEvent
  projects: Project[]
  activities: Activity[]
  field: 'project' | 'activity'
  onChanged?: () => void
}> = ({ record, projects, activities, field, onChanged }) => {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const messageApi = useMessage()

  const commit = async (value: number) => {
    const chosen = value === NONE ? null : value
    // Changing the project clears the activity; changing the activity keeps
    // the project it belongs to.
    const projectId = field === 'project' ? chosen : (record.project_id ?? null)
    const activityId = field === 'project' ? null : chosen

    setSaving(true)
    try {
      if (projectId == null) {
        await unmapEvents([record.id!])
      } else {
        await mapEvents([record.id!], projectId, activityId)
      }
      setEditing(false)
      onChanged?.()
    } catch (error) {
      console.error('Error changing mapping:', error)
      messageApi.error('Failed to change the mapping')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    const label =
      field === 'project'
        ? record.project
          ? `${record.project.code} — ${record.project.name}`
          : null
        : record.activity?.name ?? null

    return (
      <Button
        type="link"
        size="small"
        aria-label={`Change ${field} for ${record.title}`}
        onClick={e => {
          e.stopPropagation()
          setEditing(true)
        }}
        style={{
          padding: 0,
          height: 'auto',
          fontSize: '12px',
          textAlign: 'left',
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: label ? undefined : 'rgba(0,0,0,0.25)'
        }}
      >
        {label ?? 'Unmapped'}
      </Button>
    )
  }

  const options =
    field === 'project'
      ? [
          { value: NONE, label: 'Unmapped' },
          ...projects
            .filter(p => p.is_active || p.id === record.project_id)
            .map(p => ({ value: p.id!, label: `${p.code} — ${p.name}` }))
        ]
      : [
          { value: NONE, label: 'No activity' },
          ...activities
            .filter(a => a.is_active || a.id === record.activity_id)
            .map(a => ({ value: a.id!, label: a.name }))
        ]

  return (
    <Select
      autoFocus
      defaultOpen
      size="small"
      loading={saving}
      style={{ width: '100%' }}
      value={(field === 'project' ? record.project_id : record.activity_id) ?? NONE}
      options={options}
      showSearch
      optionFilterProp="label"
      onChange={commit}
      onBlur={() => setEditing(false)}
      onClick={e => e.stopPropagation()}
      aria-label={`${field} for ${record.title}`}
    />
  )
}

interface TableEvent extends Event {
  key: string
  startDateTime: Dayjs
  endDateTime?: Dayjs
  duration: string
  eventType?: EventType
  project?: Project
  activity?: Activity
  displayStartTime: string
  displayEndTime: string
  displayDate: string
}

/**
 * An event's length in minutes — what the Duration column sorts and filters
 * on, since its displayed value ("1h 30m") does not sort as text.
 *
 * An all-day event counts as whole days (1 day = 1440 minutes): the only
 * arithmetic available here. The billable summary deliberately refuses to make
 * the same guess, because valuing a day off is a timecard decision.
 */
const durationInMinutes = (event: TableEvent, userTimezone: string): number => {
  if (!event.end_date) return 0

  if (event.is_all_day) {
    const start = dayjs(event.start_date)
    const end = dayjs(event.end_date).subtract(1, 'day')
    return (end.diff(start, 'day') + 1) * 1440
  }

  const timezone = userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const start = dayjs.utc(event.start_date).tz(timezone)
  const end = dayjs.utc(event.end_date).tz(timezone)
  return end.diff(start, 'minute')
}

/**
 * The Categories cell. Deliberately hand-rolled rather than the grid's
 * TagListCell: this column shows the first two categories plus a "+N" tag
 * whose tooltip lists the rest, where TagListCell renders every value behind a
 * CSS fade with no threshold and no tooltip. The column's *filter* is the
 * grid's — see createCsvColumn on the column itself.
 */
const CategoriesCell: React.FC<{ categories?: string }> = ({ categories }) => {
  const categoryList = (categories ?? '')
    .split(',')
    .map(cat => cat.trim())
    .filter(cat => cat !== '')

  if (categoryList.length === 0) {
    return <Text type="secondary" style={{ fontSize: '12px' }}>-</Text>
  }

  // Show first 2 categories as tags, with tooltip showing all if more than 2
  const displayCategories = categoryList.slice(0, 2)
  const hasMore = categoryList.length > 2

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
      {displayCategories.map((category, position) => (
        <Tag key={position} style={{ margin: 0, fontSize: '10px' }}>
          {category.length > 15 ? `${category.substring(0, 15)}...` : category}
        </Tag>
      ))}
      {hasMore && (
        <Tooltip
          title={
            <div>
              <Text strong>All Categories:</Text>
              <br />
              {categoryList.join(', ')}
            </div>
          }
        >
          <Tag style={{ margin: 0, fontSize: '10px', cursor: 'pointer' }} color="blue">
            +{categoryList.length - 2}
          </Tag>
        </Tooltip>
      )}
    </div>
  )
}

const EventTable: React.FC<EventTableProps> = ({
  currentDate,
  getEventsForDate,
  getEventDisplayColor,
  getEventBackgroundColor,
  setSelectedEvent,
  setIsModalVisible,
  userTimezone,
  eventTypes,
  projects,
  activities,
  onMappingChanged,
  onExportReady
}) => {
  /* The rows the grid is actually showing — post-filter, post-sort, in display
     order. The grid reports them through onDisplayedRowsChange, on mount
     included, so this is authoritative from the first render and both the
     export and the summary below read it directly. */
  const [filteredData, setFilteredData] = useState<TableEvent[]>([])
  const messageApi = useMessage()

  // Use current date to determine the month range for table view
  const dateRange = useMemo<[Dayjs, Dayjs]>(() => [
    currentDate.startOf('month'),
    currentDate.endOf('month')
  ], [currentDate])

  // Generate all events for the date range
  const tableEvents = useMemo(() => {
    const events: TableEvent[] = []
    const [startDate, endDate] = dateRange

    // Create a set to track processed events (avoid duplicates)
    const processedEvents = new Set<string>()

    let current = startDate.startOf('day')
    while (current.isSameOrBefore(endDate, 'day')) {
      const dayEvents = getEventsForDate(current)

      dayEvents.forEach(event => {
        // Skip if we've already processed this event
        if (processedEvents.has(event.graph_id || event.id?.toString() || '')) {
          return
        }
        processedEvents.add(event.graph_id || event.id?.toString() || '')

        const startDateTime = event.is_all_day
          ? dayjs(event.start_date)
          : dayjs.utc(event.start_date).tz(userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
        const endDateTime = event.end_date
          ? (event.is_all_day
            ? dayjs(event.end_date).subtract(1, 'day')
            : dayjs.utc(event.end_date).tz(userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone))
          : undefined

        // Find event type
        const eventType = event.type_id ? eventTypes.find(t => t.id === event.type_id) : undefined
        const project = event.project_id ? projects.find(p => p.id === event.project_id) : undefined
        const activity = event.activity_id
          ? activities.find(a => a.id === event.activity_id)
          : undefined

        // Calculate duration using shared utility
        const duration = calculateEventDuration(
          event.start_date,
          event.end_date,
          event.is_all_day,
          userTimezone
        )

        const tableEvent: TableEvent = {
          ...event,
          key: event.graph_id || event.id?.toString() || Math.random().toString(),
          startDateTime,
          endDateTime,
          duration,
          eventType,
          project,
          activity,
          displayStartTime: event.is_all_day ? 'All Day' : startDateTime.format('h:mm A'),
          displayEndTime: event.is_all_day ? 'All Day' : (endDateTime ? endDateTime.format('h:mm A') : ''),
          displayDate: startDateTime.format('MMM D, YYYY')
        }

        events.push(tableEvent)
      })

      current = current.add(1, 'day')
    }

    // Sort events by start date/time
    return events.sort((a, b) => a.startDateTime.valueOf() - b.startDateTime.valueOf())
  }, [dateRange, getEventsForDate, userTimezone, eventTypes, projects, activities])

  // Helper function to format duration for export as h:mm
  const formatDurationForExport = (event: TableEvent): string => {
    if (!event.end_date) return '0:00'

    const totalMinutes = durationInMinutes(event, userTimezone)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return `${hours}:${minutes.toString().padStart(2, '0')}`
  }

  // Export function
  const handleExport = useCallback(async () => {
    /* Exactly what is on screen — the grid's displayed rows, so the column
       filters, the search box and the sort order all carry into the file. */
    const exportData = filteredData.map(event => ({
      'Start': event.is_all_day
        ? `${dayjs(event.start_date).format('MMM D, YYYY')} 12:00 AM`
        : `${event.displayDate} ${event.displayStartTime}`,
      'End': event.end_date
        ? (event.is_all_day
          ? `${dayjs(event.end_date).format('MMM D, YYYY')} 12:00 AM`
          : `${event.endDateTime!.format('MMM D, YYYY')} ${event.displayEndTime}`)
        : '',
      'Title': event.title,
      'Duration': formatDurationForExport(event),
      'Status': event.show_as || 'unknown',
      'Type': event.eventType?.name || event.show_as || '',
      'Meeting': event.is_meeting ? 'Yes' : 'No',
      'Categories': event.categories || ''
    }))

    // Create workbook and worksheet using exceljs
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Calendar Events')

    // Add headers
    const headers = ['Start', 'End', 'Title', 'Duration', 'Status', 'Type', 'Meeting', 'Categories']
    worksheet.addRow(headers)

    // Style the header row
    worksheet.getRow(1).font = { bold: true }
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    }

    // Add data rows
    exportData.forEach(row => {
      worksheet.addRow([
        row.Start,
        row.End,
        row.Title,
        row.Duration,
        row.Status,
        row.Type,
        row.Meeting,
        row.Categories
      ])
    })

    // Auto-fit columns
    worksheet.columns.forEach(column => {
      let maxLength = 0
      column.eachCell?.({ includeEmpty: true }, cell => {
        const columnLength = cell.value ? String(cell.value).length : 10
        if (columnLength > maxLength) {
          maxLength = columnLength
        }
      })
      column.width = Math.min(maxLength + 2, 50)
    })

    // Generate filename with timestamp to ensure uniqueness
    const now = dayjs().tz(userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
    const timestamp = now.format('YYYY-MM-DD HHmm')
    const fileName = `Calendar Export ${timestamp}.xlsx`

    const buffer = await workbook.xlsx.writeBuffer()

    try {
      const saved = await saveFile(
        fileName,
        new Uint8Array(buffer as ArrayBuffer),
        'Excel Workbook',
        ['xlsx']
      )

      // A cancelled dialog is a normal outcome, not a failure — say nothing.
      if (saved) {
        messageApi.success(`Exported ${exportData.length} events`)
      }
    } catch (error) {
      console.error('Export failed:', error)
      messageApi.error('Could not save the export')
    }
  }, [filteredData, userTimezone, messageApi])

  // Pass export function to parent via callback
  React.useEffect(() => {
    if (onExportReady) {
      onExportReady(handleExport)
    }
  }, [onExportReady, handleExport])

  /* Memoized deliberately, not for tidiness: a fresh array each render gives
     the grid fresh column defs, which rebuilds its row model, which fires
     onDisplayedRowsChange, which sets state here and renders again - a loop
     that never settles. The grid's own displayed-rows effect keys on the row
     model's identity, so the columns must hold theirs. */
  const columns = useMemo<ColumnDef<TableEvent, unknown>[]>(() => [
    {
      id: 'start',
      header: 'Start',
      size: 140,
      /* dateTime supplies the chronological sort and the date/time filter the
         hand-written sorter used to stand in for; the explicit cell below
         still wins over the preset's plain formatting (see applyColumnType),
         so the two-line date-over-time reading is unchanged. */
      meta: { columnType: 'dateTime' },
      accessorFn: row => row.startDateTime.toDate(),
      // A Date is not a string, so TanStack would start this column's sort
      // descending; the old table sorted ascending first.
      sortDescFirst: false,
      cell: ({ row }) => (
        <div style={centred}>
          <Text type="secondary" style={{ fontSize: '10px', display: 'block' }}>
            {row.original.startDateTime.format('MMM D')}
          </Text>
          <Text strong style={{ fontSize: '12px' }}>
            {row.original.displayStartTime}
          </Text>
        </div>
      )
    },
    {
      id: 'end',
      header: 'End',
      size: 140,
      meta: { columnType: 'dateTime' },
      /* Null, not undefined, for an event with no end: the grid's default sort
         keeps empties last ascending, and the filter's "(Blanks)" option can
         then reach them. The old sorter put them first instead. */
      accessorFn: row => row.endDateTime?.toDate() ?? null,
      sortDescFirst: false,
      cell: ({ row }) => (
        <div style={centred}>
          {row.original.endDateTime && (
            <Text type="secondary" style={{ fontSize: '10px', display: 'block' }}>
              {row.original.endDateTime.format('MMM D')}
            </Text>
          )}
          <Text style={{ fontSize: '12px' }}>
            {row.original.displayEndTime || '-'}
          </Text>
        </div>
      )
    },
    {
      id: 'title',
      accessorKey: 'title',
      header: 'Title',
      /* The widest column, and the one worth reading. `minSize` is the floor a
         drag-resize may not take it below, so it truncates via the cell's own
         ellipsis rather than disappearing. */
      size: 320,
      minSize: TITLE_MIN_WIDTH,
      // The grid's standard text filter, in place of the hand-rolled
      // filterDropdown search box this column used to carry.
      cell: ({ row }) => (
        <Tooltip title={row.original.title}>
          <Button
            type="link"
            style={{
              padding: 0,
              height: 'auto',
              textAlign: 'left',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%'
            }}
            onClick={() => {
              setSelectedEvent(row.original)
              setIsModalVisible(true)
            }}
          >
            {row.original.title}
          </Button>
        </Tooltip>
      )
    },
    {
      id: 'duration',
      header: 'Duration',
      size: 120,
      /* Sorts and filters on real minutes while displaying "1h 30m". `align`
         opts the cell out of the numeric right-align so it stays centred, and
         the CSV gets the readable string rather than a minute count. */
      meta: {
        align: 'left',
        exportFormatter: (_value, row) => (row as TableEvent).duration
      },
      accessorFn: row => durationInMinutes(row, userTimezone),
      // Numeric columns start descending by default; this one sorted ascending
      // first, like every other column here.
      sortDescFirst: false,
      cell: ({ row }) => (
        <div style={centred}>
          <Text style={{ fontSize: '12px' }}>{row.original.duration}</Text>
        </div>
      )
    },
    {
      id: 'status',
      header: 'Status',
      size: 120,
      /* No filterOptions: the set filter facets them from the live rows, which
         is what the hand-built status list did by walking the data itself. */
      meta: { filterType: 'set' },
      // 'unknown' rather than '' so the filter list offers exactly what the
      // cell displays.
      accessorFn: row => row.show_as || 'unknown',
      cell: ({ row }) => (
        <div style={centred}>
          <Text style={{ fontSize: '12px' }}>
            {row.original.show_as || 'unknown'}
          </Text>
        </div>
      )
    },
    {
      id: 'project',
      header: 'Project',
      size: 190,
      /* Declared from the projects list rather than faceted, so a project with
         no events this month is still offered - which is what the old
         filter-by-id list did. */
      meta: {
        filterType: 'set',
        filterOptions: projects.map(p => {
          const label = `${p.code} — ${p.name}`
          return { label, value: label }
        })
      },
      accessorFn: row => (row.project ? `${row.project.code} — ${row.project.name}` : ''),
      /* Editable in place: the grid is where you notice a mapping is wrong,
         and making the user go to another screen to fix it is the kind of
         friction that leaves it wrong. `data-row-activate="ignore"` keeps a
         click anywhere in the cell from also opening the event modal. */
      cell: ({ row }) => (
        <div data-row-activate="ignore">
          <MappingCell
            record={row.original}
            projects={projects}
            activities={activities}
            field="project"
            onChanged={onMappingChanged}
          />
        </div>
      )
    },
    {
      id: 'program',
      header: 'Program',
      size: 150,
      meta: { filterType: 'set' },
      accessorFn: row => row.project?.program ?? '',
      /* Read-only, and deliberately: a program belongs to the project, so it
         is changed on the Projects tab rather than per event. */
      cell: ({ row }) =>
        row.original.project?.program ? (
          <Text style={{ fontSize: '12px' }}>{row.original.project.program}</Text>
        ) : (
          <Text type="secondary" style={{ fontSize: '12px' }}>—</Text>
        )
    },
    {
      id: 'activity',
      header: 'Activity',
      size: 190,
      meta: {
        filterType: 'set',
        filterOptions: activities.map(a => ({ label: a.name, value: a.name }))
      },
      accessorFn: row => row.activity?.name ?? '',
      cell: ({ row }) => (
        <div data-row-activate="ignore">
          <MappingCell
            record={row.original}
            projects={projects}
            activities={activities}
            field="activity"
            onChanged={onMappingChanged}
          />
        </div>
      )
    },
    {
      id: 'type',
      header: 'Type',
      size: 120,
      meta: { filterType: 'set' },
      // Falls back to show_as exactly as the cell does, so filtering by a
      // listed value always matches the rows displaying it.
      accessorFn: row => row.eventType?.name || row.show_as || '',
      cell: ({ row }) => {
        const record = row.original
        if (record.eventType) {
          return (
            <Tag
              color={record.eventType.color}
              style={{
                margin: 0,
                fontSize: '11px',
                border: 'none'
              }}
            >
              {record.eventType.name}
            </Tag>
          )
        }
        return (
          <Tag
            color={getEventDisplayColor ? getEventDisplayColor(record) : getEventBackgroundColor(record.show_as)}
            style={{
              margin: 0,
              fontSize: '11px',
              border: 'none'
            }}
          >
            {record.show_as}
          </Tag>
        )
      }
    },
    {
      id: 'meeting',
      header: 'Meeting',
      size: 120,
      // yesNo maps the boolean to "Yes"/"No" for both display and the set
      // filter, replacing the hand-declared Yes/No filter pair; the explicit
      // cell keeps the old font size and centring.
      meta: { columnType: 'yesNo' },
      // Coerced so an event with no is_meeting flag filters as "No", which is
      // what the cell has always shown it as.
      accessorFn: row => !!row.is_meeting,
      cell: ({ row }) => (
        <div style={centred}>
          <Text style={{ fontSize: '12px' }}>
            {row.original.is_meeting ? 'Yes' : 'No'}
          </Text>
        </div>
      )
    },
    {
      /* A comma-joined column: createCsvColumn supplies the accessor,
         meta.multiValueSplit and a per-token filterFn, so the checkbox list is
         built from individual categories rather than whole joined strings -
         replacing an onFilter that split and trimmed by hand. Its tag-list
         cell is deliberately overridden below. */
      ...createCsvColumn<TableEvent>({
        id: 'categories',
        header: 'Categories',
        size: 150
      }),
      cell: ({ row }) => <CategoriesCell categories={row.original.categories} />
    }
  ], [
    projects,
    activities,
    userTimezone,
    getEventDisplayColor,
    getEventBackgroundColor,
    setSelectedEvent,
    setIsModalVisible,
    onMappingChanged
  ])

  /* The grid reports its displayed rows on mount, so this is the filtered set
     from the first render. It no longer falls back to every event while
     waiting for a first onChange, which also means a filter matching nothing
     now reports zero instead of the unfiltered total. */
  const currentData = filteredData
  const summaryData = {
    totalEvents: currentData.length,
    allDayEvents: currentData.filter(event => event.is_all_day).length,
    timedEvents: currentData.filter(event => !event.is_all_day).length,
    billableEvents: currentData.filter(event => event.eventType?.is_billable).length,
    /* TIMED events only. An all-day event has no hours - the calendar simply
       does not know whether a day off is worth 8 hours, 24, or none. This used
       to count `days * 1440`, so a five-day PTO block reported 120 hours.
       Valuing an all-day event is a timecard decision, not a calendar one, so
       the days are reported as days below rather than guessed at here. */
    totalBillableMinutes: currentData
      .filter(event => event.eventType?.is_billable && !event.is_all_day && event.endDateTime)
      .reduce(
        (total, event) => total + event.endDateTime!.diff(event.startDateTime, 'minute'),
        0
      ),
    billableAllDayEvents: currentData.filter(
      event => event.eventType?.is_billable && event.is_all_day
    ).length
  }

  const billableHours = Math.floor(summaryData.totalBillableMinutes / 60)
  const remainingBillableMinutes = summaryData.totalBillableMinutes % 60

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Table */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <DataGrid<TableEvent>
          data={tableEvents}
          columns={columns}
          /* The row's own stable key rather than its id: `id` is optional on
             Event, and an event only ever seen through Graph has just a
             graph_id. */
          getRowId={event => event.key}
          variant="advanced"
          persistStateKey="events"
          csvFileName="events"
          emptyMessage="No events this month"
          initialSorting={[{ id: 'start', desc: false }]}
          onDisplayedRowsChange={setFilteredData}
          /* Rows are focusable buttons, so the table is keyboard-navigable for
             the first time. Clicks on the cells' own controls - the title
             link, the mapping cells - are left alone. */
          onRowActivate={event => {
            setSelectedEvent(event)
            setIsModalVisible(true)
          }}
          getRowActivateLabel={event => event.title}
        />
      </div>

      {/* Fixed Summary Footer */}
      <div style={{
        padding: '8px 16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }} className="ant-table-summary">
        <Text size="sm">
          <Text strong>Summary:</Text> {summaryData.totalEvents} events ({summaryData.timedEvents} timed, {summaryData.allDayEvents} all-day)
        </Text>
        <Text size="sm">
          {summaryData.billableEvents} billable
          {summaryData.totalBillableMinutes > 0 && (
            <Text strong type="primary" style={{ marginLeft: '8px' }}>
              {billableHours > 0 ? `${billableHours}h ` : ''}{remainingBillableMinutes > 0 ? `${remainingBillableMinutes}m` : ''}
            </Text>
          )}
          {/* Counted, not valued: how many hours an all-day event is worth is
              a timecard question the calendar cannot answer. */}
          {summaryData.billableAllDayEvents > 0 && (
            <Text type="secondary" style={{ marginLeft: '8px' }}>
              + {summaryData.billableAllDayEvents} all-day
            </Text>
          )}
        </Text>
      </div>
    </div>
  )
}

export default EventTable
