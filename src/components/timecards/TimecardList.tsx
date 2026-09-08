import React, { useState } from 'react'
import { Typography, Space, Button, App, Modal, Form, DatePicker, Tag, Flex } from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import type { ItemType } from 'antd/es/menu/interface'
import { Timecard } from '../../api/timecards'
import { weekBoundsOf } from '../../utils/timecardGrid'
import { DataGrid, createActionsColumn, confirmDelete } from '../grid'
import type { ColumnDef } from '../grid'

const { Text } = Typography

interface TimecardListProps {
  timecards: Timecard[]
  /** Hours on each timecard, by id. */
  hoursById: Record<number, number>
  loading: boolean
  onOpen: (timecard: Timecard) => void
  onCreate: (date: string) => Promise<void>
  onDelete: (timecard: Timecard) => Promise<void>
}

/**
 * Every week that has a timecard.
 *
 * A week is the only thing that gets created: a longer stretch is a question
 * to ask the report, not a bigger timecard.
 */
const TimecardList: React.FC<TimecardListProps> = ({
  timecards,
  hoursById,
  loading,
  onOpen,
  onCreate,
  onDelete
}) => {
  const { modal } = App.useApp()
  const [modalVisible, setModalVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const handleCreate = async () => {
    let values
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    setSaving(true)
    try {
      await onCreate((values.week as Dayjs).format('YYYY-MM-DD'))
      setModalVisible(false)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteClick = (timecard: Timecard) => {
    confirmDelete(modal, {
      content: 'Its entries go with it. The events are untouched.',
      onConfirm: () => onDelete(timecard),
    })
  }

  const columns: ColumnDef<Timecard, unknown>[] = [
    {
      // The visible label is the week's name, but the column sorts (and
      // defaults to sorting) by its actual start date.
      accessorKey: 'start_date',
      header: 'Week',
      meta: { columnType: 'dateOnly' },
      cell: ({ row }) => (
        <Button
          type="link"
          style={{ padding: 0, height: 'auto' }}
          onClick={() => onOpen(row.original)}
        >
          {row.original.name}
        </Button>
      )
    },
    {
      id: 'dates',
      header: 'Dates',
      size: 220,
      cell: ({ row }) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {row.original.start_date} to {row.original.end_date}
        </Text>
      )
    },
    {
      id: 'hours',
      header: 'Hours',
      size: 100,
      meta: { align: 'right' },
      accessorFn: (row) => hoursById[row.id!] ?? 0,
      // TanStack defaults a numeric column's first click to descending; the
      // original antd sorter went ascending first, like every column here.
      sortDescFirst: false,
      cell: ({ row }) => <Text strong>{(hoursById[row.original.id!] ?? 0).toFixed(2)}</Text>
    },
    {
      accessorKey: 'status',
      header: 'Status',
      size: 120,
      cell: ({ row }) =>
        row.original.status === 'submitted' ? (
          <Tag color="success" style={{ marginInlineEnd: 0 }}>
            Submitted
          </Tag>
        ) : (
          <Tag style={{ marginInlineEnd: 0 }}>Draft</Tag>
        )
    },
    {
      accessorKey: 'generated_at',
      header: 'Pulled',
      size: 170,
      cell: ({ row }) => {
        const generatedAt = row.original.generated_at
        return generatedAt ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {generatedAt.slice(0, 16).replace('T', ' ')}
          </Text>
        ) : (
          // A timecard that has never pulled from events is empty, and that is
          // worth saying rather than showing a blank cell.
          <Text type="warning" style={{ fontSize: 12 }}>
            Not yet pulled
          </Text>
        )
      }
    },
    createActionsColumn<Timecard>({
      getItems: (record) => [
        {
          key: 'delete',
          label: 'Delete',
          icon: <DeleteOutlined />,
          danger: true,
          onClick: () => handleDeleteClick(record),
        },
      ] as ItemType[],
    }),
  ]

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Flex justify="space-between" align="center" gap={16}>
        <Text type="secondary">
          Time is kept a week at a time, and each week is submitted on its own. For a total
          over a longer stretch, use the report.
        </Text>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields()
            form.setFieldsValue({ week: dayjs() })
            setModalVisible(true)
          }}
        >
          New week
        </Button>
      </Flex>

      <DataGrid<Timecard>
        data={timecards}
        columns={columns}
        isLoading={loading}
        getRowId={row => String(row.id)}
        variant="advanced"
        persistStateKey="timecards"
        csvFileName="timecards"
        emptyMessage="No timecards yet"
        initialSorting={[{ id: 'start_date', desc: true }]}
      />

      <Modal
        title="New week"
        open={modalVisible}
        onOk={handleCreate}
        onCancel={() => setModalVisible(false)}
        okText="Create"
        okButtonProps={{ loading: saving }}
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            label="Week"
            name="week"
            rules={[{ required: true, message: 'Please choose a week' }]}
            extra={
              <WeekHint form={form} />
            }
          >
            {/* Any day in the week: the card always covers Sunday to Saturday,
                so picking a Wednesday is the same as picking its Sunday. */}
            <DatePicker
              picker="week"
              allowClear={false}
              style={{ width: '100%' }}
              aria-label="Week"
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}

/** Spells out the days the chosen week covers, since a week picker doesn't. */
const WeekHint: React.FC<{ form: ReturnType<typeof Form.useForm>[0] }> = ({ form }) => {
  const week = Form.useWatch('week', form) as Dayjs | undefined
  if (!week) return null

  const bounds = weekBoundsOf(week.format('YYYY-MM-DD'))
  return <>Covers {bounds.start} to {bounds.end}</>
}

export default TimecardList
