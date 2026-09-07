import React, { useState, useEffect } from 'react'
import { Typography, Space, Button, App, Modal, Form, Input, ColorPicker, Switch, theme, Flex } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import type { ItemType } from 'antd/es/menu/interface'
import { Activity } from '../../types'
import { useMessage } from '../../contexts/MessageContext'
import {
  getActivities,
  createActivity,
  updateActivity,
  deleteActivity,
  DuplicateActivityError
} from '../../api/activities'
import { useReloadOnShow } from '../../contexts/ScreenVisibilityContext'
import { DataGrid, createActionsColumn, confirmDelete } from '../grid'
import type { ColumnDef } from '../grid'

const { Text } = Typography

interface ActivitiesSettingsProps {
  searchTerm?: string
}

const ActivitiesSettings: React.FC<ActivitiesSettingsProps> = ({ searchTerm = '' }) => {
  const messageApi = useMessage()
  const { modal } = App.useApp()
  const { token } = theme.useToken()
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    loadActivities()
  }, [])

  // Screens stay mounted, so the effect above runs once. This is what
  // picks up work done elsewhere while this one was hidden.
  useReloadOnShow(() => loadActivities())

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

  const handleDeleteClick = (activity: Activity) => {
    confirmDelete(modal, {
      content: 'Events and rules using this activity keep their project and simply lose the activity.',
      onConfirm: () => handleDelete(activity),
    })
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

  const columns: ColumnDef<Activity, unknown>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => {
        const record = row.original
        return (
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
            <Text type={record.is_active ? undefined : 'secondary'}>{record.name}</Text>
          </Space>
        )
      },
    },
    {
      accessorKey: 'is_active',
      header: 'Active',
      size: 80,
      meta: { columnType: 'yesNo' },
      // Explicit cell wins over the yesNo preset's plain-text one (see
      // column-types.ts's applyColumnType), while the preset still supplies
      // the sort/filter behaviour via its accessorFn — keeps the colour
      // coding without giving up "Yes"/"No" set-filtering.
      cell: ({ row }) => (
        <Text type={row.original.is_active ? 'success' : 'secondary'}>
          {row.original.is_active ? 'Yes' : 'No'}
        </Text>
      ),
    },
    createActionsColumn<Activity>({
      getItems: (record) => [
        {
          key: 'edit',
          label: 'Edit',
          icon: <EditOutlined />,
          onClick: () => handleEdit(record),
        },
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

  // Whether this settings section matches an in-page search term. The grid's
  // own toolbar owns row-level filtering now; this only gates whether the
  // whole section renders (matching the section title, or any activity by
  // name).
  const matchesSearch = activities.some(activity =>
    activity.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const shouldShow =
    searchTerm === '' ||
    'activities'.includes(searchTerm.toLowerCase()) ||
    matchesSearch

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

      <DataGrid<Activity>
        data={activities}
        columns={columns}
        isLoading={loading}
        getRowId={row => String(row.id)}
        variant="advanced"
        persistStateKey="activities"
        csvFileName="activities"
        emptyMessage="No activities yet."
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
