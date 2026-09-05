import React, { useState } from 'react'
import { Typography, Space, Button, Table, Modal, Form, Input, Tag, Popconfirm, Flex, Empty } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { Timecard } from '../../api/timecards'

const { Text } = Typography

interface TimecardListProps {
  timecards: Timecard[]
  loading: boolean
  onOpen: (timecard: Timecard) => void
  onCreate: (name: string, startDate: string, endDate: string) => Promise<void>
  onDelete: (timecard: Timecard) => Promise<void>
}

/** "2026-10" -> the first and last day of that month, as ISO dates. */
function monthBounds(month: string): { start: string; end: string; name: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month.trim())
  if (!match) return null

  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  if (monthIndex < 0 || monthIndex > 11) return null

  // Day 0 of the next month is the last day of this one, which handles
  // February and leap years without a table of month lengths.
  const last = new Date(Date.UTC(year, monthIndex + 1, 0))
  const pad = (n: number) => String(n).padStart(2, '0')

  return {
    start: `${year}-${pad(monthIndex + 1)}-01`,
    end: `${year}-${pad(monthIndex + 1)}-${pad(last.getUTCDate())}`,
    name: new Date(Date.UTC(year, monthIndex, 1)).toLocaleString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    })
  }
}

function thisMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const TimecardList: React.FC<TimecardListProps> = ({
  timecards,
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

    const bounds = monthBounds(values.month)
    if (!bounds) return

    setSaving(true)
    try {
      await onCreate(values.name?.trim() || bounds.name, bounds.start, bounds.end)
      setModalVisible(false)
    } finally {
      setSaving(false)
    }
  }

  const columns = [
    {
      title: 'Timecard',
      key: 'name',
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
      title: 'Period',
      key: 'period',
      width: 220,
      render: (_: unknown, record: Timecard) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {record.start_date} to {record.end_date}
        </Text>
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
      title: 'Generated',
      dataIndex: 'generated_at',
      key: 'generated_at',
      width: 170,
      render: (generatedAt: string | null) =>
        generatedAt ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {generatedAt.slice(0, 16).replace('T', ' ')}
          </Text>
        ) : (
          // A timecard that has never pulled from events is empty, and that
          // is worth saying rather than showing a blank cell.
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
          title="Delete this timecard?"
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
      <Flex justify="space-between" align="center">
        <Text type="secondary">
          A timecard pulls from your calendar for a period. Editing one never changes the
          calendar.
        </Text>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields()
            form.setFieldsValue({ month: thisMonth(), name: '' })
            setModalVisible(true)
          }}
        >
          New timecard
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
        title="New timecard"
        open={modalVisible}
        onOk={handleCreate}
        onCancel={() => setModalVisible(false)}
        okText="Create"
        okButtonProps={{ loading: saving }}
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            label="Month"
            name="month"
            rules={[
              { required: true, message: 'Please enter a month' },
              {
                validator: (_, value) =>
                  monthBounds(value ?? '')
                    ? Promise.resolve()
                    : Promise.reject(new Error('Use YYYY-MM, e.g. 2026-10'))
              }
            ]}
          >
            {/* A plain text month rather than a DatePicker: test/setup.ts
                mocks dayjs globally without `.minute()`, so antd's pickers
                cannot render in any test. */}
            <Input placeholder="2026-10" />
          </Form.Item>

          <Form.Item label="Name" name="name">
            <Input placeholder="Defaults to the month, e.g. October 2026" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}

export { monthBounds }
export default TimecardList
