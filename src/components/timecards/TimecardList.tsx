import React, { useState } from 'react'
import {
  Typography, Space, Button, Table, Modal, Form, DatePicker, Tag, Popconfirm, Flex, Empty
} from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { Timecard } from '../../api/timecards'
import { weekBoundsOf } from '../../utils/timecardGrid'

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

  const columns = [
    {
      title: 'Week',
      key: 'name',
      sorter: (a: Timecard, b: Timecard) => a.start_date.localeCompare(b.start_date),
      defaultSortOrder: 'descend' as const,
      render: (_: unknown, record: Timecard) => (
        <Button
          type="link"
          style={{ padding: 0, height: 'auto' }}
          onClick={() => onOpen(record)}
        >
          {record.name}
        </Button>
      )
    },
    {
      title: 'Dates',
      key: 'dates',
      width: 220,
      render: (_: unknown, record: Timecard) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {record.start_date} to {record.end_date}
        </Text>
      )
    },
    {
      title: 'Hours',
      key: 'hours',
      width: 100,
      align: 'right' as const,
      sorter: (a: Timecard, b: Timecard) => (hoursById[a.id!] ?? 0) - (hoursById[b.id!] ?? 0),
      render: (_: unknown, record: Timecard) => (
        <Text strong>{(hoursById[record.id!] ?? 0).toFixed(2)}</Text>
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: string) =>
        status === 'submitted' ? (
          <Tag color="success" style={{ marginInlineEnd: 0 }}>
            Submitted
          </Tag>
        ) : (
          <Tag style={{ marginInlineEnd: 0 }}>Draft</Tag>
        )
    },
    {
      title: 'Pulled',
      dataIndex: 'generated_at',
      key: 'generated_at',
      width: 170,
      render: (generatedAt: string | null) =>
        generatedAt ? (
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
    },
    {
      title: '',
      key: 'actions',
      width: 60,
      render: (_: unknown, record: Timecard) => (
        <Popconfirm
          title="Delete this week?"
          description="Its entries go with it. The events are untouched."
          okText="Yes"
          cancelText="No"
          onConfirm={() => onDelete(record)}
        >
          <Button
            icon={<DeleteOutlined />}
            size="small"
            danger
            aria-label={`Delete ${record.name}`}
          />
        </Popconfirm>
      )
    }
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

      {!loading && timecards.length === 0 ? (
        <Empty description="No timecards yet" />
      ) : (
        <Table
          columns={columns}
          dataSource={timecards}
          loading={loading}
          rowKey="id"
          pagination={false}
          size="small"
        />
      )}

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
