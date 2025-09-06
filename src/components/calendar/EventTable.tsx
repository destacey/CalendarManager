import React, { useMemo, useRef, useState, useCallback } from 'react'
import { Table, Typography, Tag, Tooltip, Button, Input, Space } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import type { ColumnsType, FilterDropdownProps } from 'antd/es/table'
import type { TableRef } from 'antd/es/table'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'
import { Event, EventType } from '../../types'
import { calculateEventDuration } from '../../utils/eventUtils'

const { Text } = Typography

interface EventTableProps {
  currentDate: Dayjs
  getEventsForDate: (date: Dayjs) => Event[]
  getEventDisplayColor?: (event: Event) => string
  getEventBackgroundColor: (showAs: string) => string
  setSelectedEvent: (event: Event) => void
  setIsModalVisible: (visible: boolean) => void
  userTimezone: string
  eventTypes: EventType[]
  onExportReady?: (exportFn: () => void) => void
}

interface TableEvent extends Event {
  key: string
  startDateTime: Dayjs
  endDateTime?: Dayjs
  duration: string
  eventType?: EventType
  displayStartTime: string
  displayEndTime: string
  displayDate: string
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
  onExportReady
}) => {
  const tableRef = useRef<TableRef>(null)
  const [filteredData, setFilteredData] = useState<TableEvent[]>([])

  const handleTableChange = useCallback((pagination: any, filters: any, sorter: any, extra: any) => {
    // Always update filtered data with current visible data
    setFilteredData(extra.currentDataSource as TableEvent[])
  }, [])
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
  }, [dateRange, getEventsForDate, userTimezone, eventTypes])

  // Generate filter options based on actual data
  const filterOptions = useMemo(() => {
    const statusSet = new Set<string>()
    const typeSet = new Set<string>()
    const categorySet = new Set<string>()

    tableEvents.forEach(event => {
      // Status filters
      if (event.show_as) {
        statusSet.add(event.show_as)
      }

      // Type filters
      if (event.eventType?.name) {
        typeSet.add(event.eventType.name)
      } else if (event.show_as) {
        typeSet.add(event.show_as)
      }

      // Category filters
      if (event.categories) {
        const categories = event.categories.split(',').map(cat => cat.trim()).filter(cat => cat !== '')
        categories.forEach(category => categorySet.add(category))
      }
    })

    return {
      status: Array.from(statusSet).sort().map(status => ({ text: status, value: status })),
      type: Array.from(typeSet).sort().map(type => ({ text: type, value: type })),
      category: Array.from(categorySet).sort().map(category => ({ text: category, value: category }))
    }
  }, [tableEvents])

  // Helper function to format duration for export as h:mm
  const formatDurationForExport = (event: TableEvent): string => {
    if (!event.end_date) return '0:00'
    
    if (event.is_all_day) {
      // Calculate days and convert to hours (1 day = 24 hours)
      const start = dayjs(event.start_date)
      const end = dayjs(event.end_date).subtract(1, 'day')
      const days = end.diff(start, 'day') + 1
      const hours = days * 24
      return `${hours}:00`
    } else {
      // Calculate hours and minutes for timed events
      const timezone = userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone
      const start = dayjs.utc(event.start_date).tz(timezone)
      const end = dayjs.utc(event.end_date).tz(timezone)
      const totalMinutes = end.diff(start, 'minute')
      const hours = Math.floor(totalMinutes / 60)
      const minutes = totalMinutes % 60
      return `${hours}:${minutes.toString().padStart(2, '0')}`
    }
  }

  // Export function
  const handleExport = useCallback(() => {
    // Use filtered data if available, otherwise use all table events
    const dataToExport = filteredData.length > 0 ? filteredData : tableEvents
    
    const exportData = dataToExport.map(event => ({
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

    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.json_to_sheet(exportData)

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Calendar Events')

    // Generate filename with timestamp to ensure uniqueness
    const now = dayjs().tz(userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
    const timestamp = now.format('YYYY-MM-DD HHmm')
    const fileName = `Calendar Export ${timestamp}.xlsx`
    
    // Use browser download (which works in Electron's renderer process)
    XLSX.writeFile(workbook, fileName)
  }, [filteredData, tableEvents, userTimezone])

  // Pass export function to parent via callback
  React.useEffect(() => {
    if (onExportReady) {
      onExportReady(handleExport)
    }
  }, [onExportReady, handleExport])

  const columns: ColumnsType<TableEvent> = [
    {
      title: 'Start',
      key: 'start',
      width: 140,
      align: 'center',
      sorter: (a, b) => a.startDateTime.valueOf() - b.startDateTime.valueOf(),
      defaultSortOrder: 'ascend',
      render: (_, record) => (
        <div style={{ textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: '10px', display: 'block' }}>
            {record.startDateTime.format('MMM D')}
          </Text>
          <Text strong style={{ fontSize: '12px' }}>
            {record.displayStartTime}
          </Text>
        </div>
      )
    },
    {
      title: 'End',
      key: 'end',
      width: 140,
      align: 'center',
      sorter: (a, b) => {
        if (!a.endDateTime && !b.endDateTime) return 0
        if (!a.endDateTime) return -1
        if (!b.endDateTime) return 1
        return a.endDateTime.valueOf() - b.endDateTime.valueOf()
      },
      render: (_, record) => (
        <div style={{ textAlign: 'center' }}>
          {record.endDateTime && (
            <Text type="secondary" style={{ fontSize: '10px', display: 'block' }}>
              {record.endDateTime.format('MMM D')}
            </Text>
          )}
          <Text style={{ fontSize: '12px' }}>
            {record.displayEndTime || '-'}
          </Text>
        </div>
      )
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      ellipsis: {
        showTitle: false
      },
      filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: FilterDropdownProps) => (
        <div style={{ padding: 8 }}>
          <Input
            placeholder="Search title"
            value={selectedKeys[0]}
            onChange={e => setSelectedKeys(e.target.value ? [e.target.value] : [])}
            onPressEnter={() => confirm()}
            style={{ marginBottom: 8, display: 'block' }}
          />
          <Space>
            <Button
              onClick={() => {
                clearFilters?.()
                confirm()
              }}
              size="small"
              style={{ width: 90 }}
            >
              Reset
            </Button>
            <Button
              type="primary"
              onClick={() => confirm()}
              size="small"
              style={{ width: 90 }}
            >
              OK
            </Button>
          </Space>
        </div>
      ),
      onFilter: (value, record) =>
        record.title.toLowerCase().includes((value as string).toLowerCase()),
      sorter: (a, b) => a.title.localeCompare(b.title),
      render: (title: string, record) => (
        <Tooltip title={title}>
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
              setSelectedEvent(record)
              setIsModalVisible(true)
            }}
          >
            {title}
          </Button>
        </Tooltip>
      )
    },
    {
      title: 'Duration',
      dataIndex: 'duration',
      key: 'duration',
      width: 120,
      align: 'center',
      sorter: (a, b) => {
        // Helper function to convert duration to minutes for sorting
        const getDurationInMinutes = (event: TableEvent) => {
          if (!event.end_date) return 0
          
          if (event.is_all_day) {
            // Calculate days and convert to minutes (1 day = 1440 minutes)
            const start = dayjs(event.start_date)
            const end = dayjs(event.end_date).subtract(1, 'day')
            const days = end.diff(start, 'day') + 1
            return days * 1440
          } else {
            // Calculate minutes for timed events
            const timezone = userTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone
            const start = dayjs.utc(event.start_date).tz(timezone)
            const end = dayjs.utc(event.end_date).tz(timezone)
            return end.diff(start, 'minute')
          }
        }
        
        return getDurationInMinutes(a) - getDurationInMinutes(b)
      }
    },
    {
      title: 'Status',
      key: 'status',
      width: 120,
      align: 'center',
      filters: filterOptions.status,
      onFilter: (value, record) => record.show_as === value,
      sorter: (a, b) => {
        const aStatus = a.show_as || ''
        const bStatus = b.show_as || ''
        return aStatus.localeCompare(bStatus)
      },
      render: (_, record) => (
        <Text style={{ fontSize: '12px' }}>
          {record.show_as || 'unknown'}
        </Text>
      )
    },
    {
      title: 'Type',
      key: 'type',
      width: 120,
      filters: filterOptions.type,
      onFilter: (value, record) => {
        const recordType = record.eventType?.name || record.show_as || ''
        return recordType === value
      },
      sorter: (a, b) => {
        const aType = a.eventType?.name || a.show_as || ''
        const bType = b.eventType?.name || b.show_as || ''
        return aType.localeCompare(bType)
      },
      render: (_, record) => {
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
      title: 'Meeting',
      key: 'meeting',
      width: 120,
      align: 'center',
      filters: [
        { text: 'Yes', value: true },
        { text: 'No', value: false }
      ],
      onFilter: (value, record) => record.is_meeting === value,
      sorter: (a, b) => {
        const aMeeting = a.is_meeting ? 1 : 0
        const bMeeting = b.is_meeting ? 1 : 0
        return aMeeting - bMeeting
      },
      render: (_, record) => (
        <Text style={{ fontSize: '12px' }}>
          {record.is_meeting ? 'Yes' : 'No'}
        </Text>
      )
    },
    {
      title: 'Categories',
      dataIndex: 'categories',
      key: 'categories',
      width: 150,
      ellipsis: {
        showTitle: false
      },
      filters: filterOptions.category,
      onFilter: (value, record) => {
        if (!record.categories) return false
        const categories = record.categories.split(',').map(cat => cat.trim()).filter(cat => cat !== '')
        return categories.includes(value as string)
      },
      sorter: (a, b) => {
        const aCategories = a.categories || ''
        const bCategories = b.categories || ''
        return aCategories.localeCompare(bCategories)
      },
      render: (categories: string) => {
        if (!categories || categories.trim() === '') {
          return <Text type="secondary" style={{ fontSize: '12px' }}>-</Text>
        }
        
        // Split categories by comma and create tags
        const categoryList = categories.split(',').map(cat => cat.trim()).filter(cat => cat !== '')
        
        if (categoryList.length === 0) {
          return <Text type="secondary" style={{ fontSize: '12px' }}>-</Text>
        }
        
        // Show first 2 categories as tags, with tooltip showing all if more than 2
        const displayCategories = categoryList.slice(0, 2)
        const hasMore = categoryList.length > 2
        
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {displayCategories.map((category, index) => (
              <Tag key={index} style={{ margin: 0, fontSize: '10px' }}>
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
    }
  ]

  // Calculate summary data based on current visible data
  const currentData = filteredData.length > 0 ? filteredData : tableEvents
  const summaryData = {
    totalEvents: currentData.length,
    allDayEvents: currentData.filter(event => event.is_all_day).length,
    timedEvents: currentData.filter(event => !event.is_all_day).length,
    billableEvents: currentData.filter(event => event.eventType?.is_billable).length,
    totalBillableMinutes: currentData
      .filter(event => event.eventType?.is_billable && event.endDateTime)
      .reduce((total, event) => {
        if (event.is_all_day) {
          const start = dayjs(event.start_date)
          const end = dayjs(event.end_date!).subtract(1, 'day')
          const days = end.diff(start, 'day') + 1
          return total + (days * 1440)
        } else {
          return total + event.endDateTime!.diff(event.startDateTime, 'minute')
        }
      }, 0)
  }

  const billableHours = Math.floor(summaryData.totalBillableMinutes / 60)
  const remainingBillableMinutes = summaryData.totalBillableMinutes % 60

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Table */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <Table<TableEvent>
          ref={tableRef}
          columns={columns}
          dataSource={tableEvents}
          size="small"
          scroll={{ y: 'calc(100vh - 280px)', x: 800 }}
          components={{
            header: {
              cell: (props: any) => (
                <th {...props} style={{ ...props.style, whiteSpace: 'nowrap' }} />
              )
            }
          }}
          pagination={false}
          onChange={handleTableChange}
          rowClassName={(record) => 'table-row-clickable'}
          onRow={(record) => ({
            onClick: () => {
              setSelectedEvent(record)
              setIsModalVisible(true)
            },
            style: { cursor: 'pointer' }
          })}
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
        </Text>
      </div>
    </div>
  )
}

export default EventTable