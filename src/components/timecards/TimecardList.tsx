import React, { useState } from 'react'
import {
  Typography, Space, Button, Table, Modal, Form, DatePicker, Tag, Popconfirm, Flex, Empty
} from 'antd'
import dayjs, { Dayjs } from 'dayjs'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'

const { Text } = Typography

/** A month, and the weekly timecards that touch it. */
export interface PeriodSummary {
  /** "YYYY-MM". */
  month: string
  /** "September 2026". */
  name: string
  weeks: number
  submitted: number
  /** Hours dated inside the month, whichever week holds them. */
  hours: number
}

interface TimecardListProps {
  periods: PeriodSummary[]
  loading: boolean
  onOpen: (month: string) => void
  onCreate: (month: string) => Promise<void>
  onDelete: (month: string) => Promise<void>
}

const TimecardList: React.FC<TimecardListProps> = ({
  periods,
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
      await onCreate((values.month as Dayjs).format('YYYY-MM'))
      setModalVisible(false)
    } finally {
      setSaving(false)
    }
  }

  const columns = [
    {
      title: 'Period',
      key: 'name',
      render: (_: unknown, record: PeriodSummary) => (
        <Button
          type="link"
          style={{ padding: 0, height: 'auto' }}
          onClick={() => onOpen(record.month)}
        >
          {record.name}
        </Button>
      )
    },
    {
      title: 'Weeks',
      key: 'weeks',
      width: 200,
      render: (_: unknown, record: PeriodSummary) =>
        record.submitted === record.weeks ? (
          <Tag color="success" style={{ marginInlineEnd: 0 }}>
            All {record.weeks} submitted
          </Tag>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.submitted} of {record.weeks} submitted
          </Text>
        )
    },
    {
      title: 'Hours',
      key: 'hours',
      width: 120,
      align: 'right' as const,
      render: (_: unknown, record: PeriodSummary) => (
        <Text strong>{record.hours.toFixed(2)}</Text>
      )
    },
    {
      title: '',
      key: 'actions',
      width: 60,
      render: (_: unknown, record: PeriodSummary) => (
        <Popconfirm
          title={`Delete every week of ${record.name}?`}
          description="Their entries go too, and so does any week shared with the month next door. The events are untouched."
          okText="Yes"
          cancelText="No"
          onConfirm={() => onDelete(record.month)}
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
          Time is kept a week at a time and each week is submitted on its own. A month is a
          view over the weeks it touches.
        </Text>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            form.resetFields()
            form.setFieldsValue({ month: dayjs() })
            setModalVisible(true)
          }}
        >
          New month
        </Button>
      </Flex>

      {!loading && periods.length === 0 ? (
        <Empty description="No timecards yet" />
      ) : (
        <Table
          columns={columns}
          dataSource={periods}
          loading={loading}
          rowKey="month"
          pagination={false}
          size="small"
        />
      )}

      <Modal
        title="New month"
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
            rules={[{ required: true, message: 'Please choose a month' }]}
            extra="A timecard is created for each week the month touches, including the days either side that share a week with it."
          >
            <DatePicker
              picker="month"
              format="MMMM YYYY"
              allowClear={false}
              style={{ width: '100%' }}
              aria-label="Month"
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}

export default TimecardList
