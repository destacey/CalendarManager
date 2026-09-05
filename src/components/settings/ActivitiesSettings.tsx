import React, { useState, useEffect } from 'react'
import { Typography, Space, Button, Table, Modal, Form, Input, ColorPicker, Switch, Popconfirm, theme, Flex } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { Activity } from '../../types'
import { useMessage } from '../../contexts/MessageContext'
import {
  getActivities,
  createActivity,
  updateActivity,
  deleteActivity,
  DuplicateActivityError
} from '../../api/activities'

const { Text } = Typography

interface ActivitiesSettingsProps {
  searchTerm?: string
}

const ActivitiesSettings: React.FC<ActivitiesSettingsProps> = ({ searchTerm = '' }) => {
  const messageApi = useMessage()
  const { token } = theme.useToken()
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    loadActivities()
  }, [])

  const loadActivities = async () => {
    try {
      setLoading(true)
      setActivities(await getActivities())
    } catch (error) {
      console.error('Error loading activities:', error)
      messageApi.error('Failed to load activities')
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditingActivity(null)
    form.resetFields()
    form.setFieldsValue({ name: '', color: token.colorPrimary, is_active: true })
    setModalVisible(true)
  }

  const handleEdit = (activity: Activity) => {
    setEditingActivity(activity)
    form.setFieldsValue({ ...activity })
    setModalVisible(true)
  }

  const handleDelete = async (activity: Activity) => {
    try {
      const outcome = await deleteActivity(activity.id!)
      // Events and rules keep their project and simply lose the activity, so
      // this is worth saying rather than a bare success.
      const cleared = outcome.eventsCleared + outcome.rulesCleared
      messageApi.success(
        cleared > 0
          ? `Activity deleted — cleared from ${outcome.eventsCleared} event${outcome.eventsCleared === 1 ? '' : 's'} and ${outcome.rulesCleared} rule${outcome.rulesCleared === 1 ? '' : 's'}`
          : 'Activity deleted'
      )
      loadActivities()
    } catch (error) {
      console.error('Error deleting activity:', error)
      messageApi.error('Failed to delete activity')
    }
  }

  const handleSave = async () => {
    let values
    try {
      values = await form.validateFields()
    } catch {
      return // antd already marks the invalid fields
    }

    // ColorPicker hands back a Color object when the user picks one, but the
    // original string when the field was only ever seeded by setFieldsValue.
    let color = values.color
    if (typeof color === 'object' && color !== null) {
      color = color.toHexString?.() ?? token.colorPrimary
    }
    if (typeof color !== 'string') {
      color = token.colorPrimary
    }

    const payload = { name: values.name, color, is_active: values.is_active ?? true }

    try {
      if (editingActivity) {
        await updateActivity(editingActivity.id!, payload)
        messageApi.success('Activity updated')
      } else {
        await createActivity(payload)
        messageApi.success('Activity created')
      }
      setModalVisible(false)
      loadActivities()
    } catch (error) {
      console.error('Error saving activity:', error)
      // A duplicate name is the one failure with a message worth showing
      // verbatim; it is already user-facing prose from src/api/activities.ts.
      if (error instanceof DuplicateActivityError) {
        messageApi.error(error.message)
      } else {
        messageApi.error('Failed to save activity')
      }
    }
  }

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Activity) => (
        <Space>
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              backgroundColor: record.color,
              border: `1px solid ${token.colorBorder}`
            }}
          />
          <Text type={record.is_active ? undefined : 'secondary'}>{text}</Text>
        </Space>
      )
    },
    {
      title: 'Active',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 80,
      render: (is_active: boolean) => (
        <Text type={is_active ? 'success' : 'secondary'}>{is_active ? 'Yes' : 'No'}</Text>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 120,
      render: (_: unknown, record: Activity) => (
        <Space>
          <Button
            icon={<EditOutlined />}
            size="small"
            title="Edit"
            aria-label={`Edit ${record.name}`}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title="Delete this activity?"
            description="This cannot be undone."
            okText="Yes"
            cancelText="No"
            onConfirm={() => handleDelete(record)}
          >
            <Button
              icon={<DeleteOutlined />}
              size="small"
              danger
              title="Delete"
              aria-label={`Delete ${record.name}`}
            />
          </Popconfirm>
        </Space>
      )
    }
  ]

  const filteredActivities = activities.filter(activity =>
    activity.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const shouldShow =
    searchTerm === '' ||
    'activities'.includes(searchTerm.toLowerCase()) ||
    filteredActivities.length > 0

  if (!shouldShow) return null

  return (
    <Space orientation="vertical" style={{ width: '100%', marginBottom: 16 }}>
      <Flex justify="space-between" align="center">
        <Text strong>Activities</Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          Add Activity
        </Button>
      </Flex>

      <Text type="secondary">
        The disciplines work falls under. Inactive activities are kept for history but hidden from
        future pickers.
      </Text>

      <Table
        columns={columns}
        dataSource={filteredActivities}
        loading={loading}
        rowKey="id"
        pagination={false}
        size="small"
      />

      <Modal
        title={editingActivity ? 'Edit Activity' : 'Create Activity'}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => setModalVisible(false)}
        okText="Save"
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            label="Name"
            name="name"
            rules={[{ required: true, message: 'Please enter a name' }]}
          >
            <Input placeholder="e.g., Software Development, UX Design" />
          </Form.Item>

          <Form.Item
            label="Color"
            name="color"
            rules={[{ required: true, message: 'Please select a color' }]}
          >
            <ColorPicker showText />
          </Form.Item>

          <Form.Item label="Active" name="is_active" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: '12px' }}>
            Inactive activities stay in the list but will not be offered when assigning work.
          </Text>
        </Form>
      </Modal>
    </Space>
  )
}

export default ActivitiesSettings
