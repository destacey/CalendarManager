import React, { useState, useEffect } from 'react'
import { Typography, Space, Button, App, Modal, Form, Input, InputNumber, ColorPicker, Switch, theme, Flex } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, StarOutlined } from '@ant-design/icons'
import type { ItemType } from 'antd/es/menu/interface'
import { EventType } from '../../types'
import { useMessage } from '../../contexts/MessageContext'
import { getEventTypes, createEventType, updateEventType, deleteEventType, setDefaultEventType } from '../../api/eventTypes'
import { useReloadOnShow } from '../../contexts/ScreenVisibilityContext'
import { DataGrid, createActionsColumn } from '../grid'
import type { ColumnDef } from '../grid'

const { Text } = Typography

interface EventTypesSettingsProps {
  searchTerm?: string
}

const EventTypesSettings: React.FC<EventTypesSettingsProps> = ({ searchTerm = '' }) => {
  const messageApi = useMessage()
  const { modal } = App.useApp()
  const { token } = theme.useToken()
  const [eventTypes, setEventTypes] = useState<EventType[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingType, setEditingType] = useState<EventType | null>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    loadEventTypes()
  }, [])

  // Screens stay mounted, so the effect above runs once. This is what
  // picks up work done elsewhere while this one was hidden.
  useReloadOnShow(() => loadEventTypes())

  const loadEventTypes = async () => {
    try {
      setLoading(true)
      const types = await getEventTypes()
      setEventTypes(types)
    } catch (error) {
      console.error('Error loading event types:', error)
      messageApi.error('Failed to load event types')
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditingType(null)
    form.resetFields()
    form.setFieldsValue({
      name: '',
      color: token.colorPrimary,
      is_billable: false,
      all_day_hours: 8
    })
    setModalVisible(true)
  }

  const handleEdit = (type: EventType) => {
    setEditingType(type)
    form.setFieldsValue({
      ...type,
      color: type.color // Keep color as string for editing
    })
    setModalVisible(true)
  }

  const handleDelete = async (type: EventType) => {
    try {
      const outcome = await deleteEventType(type.id!)
      if (outcome.deleted) {
        if (outcome.eventsReassigned > 0 || outcome.rulesRemoved > 0) {
          const parts: string[] = []
          if (outcome.eventsReassigned > 0) {
            parts.push(`${outcome.eventsReassigned.toLocaleString()} event${outcome.eventsReassigned === 1 ? '' : 's'} moved to ${outcome.reassignedTo}`)
          }
          if (outcome.rulesRemoved > 0) {
            parts.push(`${outcome.rulesRemoved} rule${outcome.rulesRemoved === 1 ? '' : 's'} removed`)
          }
          messageApi.success(`Deleted. ${parts.join(', ')}.`)
        } else {
          messageApi.success('Event type deleted')
        }
        loadEventTypes()
      } else {
        messageApi.error('Failed to delete event type')
      }
    } catch (error) {
      console.error('Error deleting event type:', error)
      messageApi.error('Failed to delete event type')
    }
  }

  const handleDeleteClick = (type: EventType) => {
    modal.confirm({
      title: 'Are you sure?',
      content: reassignmentTargetName(type)
        ? `Events using this type will be moved to "${reassignmentTargetName(type)}".`
        : 'Events using this type will be moved to the default type.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => handleDelete(type),
    })
  }

  const handleSetDefault = async (type: EventType) => {
    try {
      const success = await setDefaultEventType(type.id!)
      if (success) {
        messageApi.success(`"${type.name}" set as default type`)
        loadEventTypes()
      } else {
        messageApi.error('Failed to set as default type')
      }
    } catch (error) {
      console.error('Error setting default type:', error)
      messageApi.error('Failed to set as default type')
    }
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      
      // Convert color value to string if it's an object
      let colorValue = values.color
      if (typeof colorValue === 'object' && colorValue !== null) {
        colorValue = colorValue.toHexString?.() || token.colorPrimary
      }
      if (typeof colorValue !== 'string') {
        colorValue = token.colorPrimary // Default fallback color
      }
      
      const processedValues = {
        ...values,
        color: colorValue
      }
      
      if (editingType) {
        // Update existing type
        const updated = await updateEventType(editingType.id!, processedValues)
        if (updated) {
          messageApi.success('Event type updated')
        }
      } else {
        // Create new type
        const created = await createEventType(processedValues)
        if (created) {
          messageApi.success('Event type created')
        }
      }
      
      setModalVisible(false)
      loadEventTypes()
    } catch (error) {
      console.error('Error saving event type:', error)
      messageApi.error('Failed to save event type')
    }
  }

  const columns: ColumnDef<EventType, unknown>[] = [
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
            {record.name}
            {record.is_default && <Text type="secondary">(Default)</Text>}
          </Space>
        )
      },
    },
    {
      accessorKey: 'color',
      header: 'Color',
      size: 80,
      cell: ({ row }) => (
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 4,
            backgroundColor: row.original.color,
            border: `1px solid ${token.colorBorder}`
          }}
        />
      ),
    },
    {
      accessorKey: 'is_billable',
      header: 'Billable',
      size: 80,
      meta: { columnType: 'yesNo' },
    },
    {
      accessorKey: 'all_day_hours',
      header: 'All-day hours',
      size: 110,
      cell: ({ row }) => {
        const hours = row.original.all_day_hours
        return hours > 0 ? (
          <Text>{hours}</Text>
        ) : (
          <Text type="secondary">Doesn't count</Text>
        )
      },
    },
    createActionsColumn<EventType>({
      getItems: (record) =>
        [
          !record.is_default && {
            key: 'default',
            label: 'Set as Default',
            icon: <StarOutlined />,
            onClick: () => handleSetDefault(record),
          },
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
        ].filter(Boolean) as ItemType[],
    }),
  ]

  /**
   * The name of the type events will land on if `record` is deleted, for
   * the delete confirmation. `delete_event_type` (event_types.rs) reassigns
   * referencing events to the default type — or, if `record` is itself the
   * default, promotes another type (lowest id among the rest) to default
   * first and reassigns there instead. Mirrors that same "lowest id among
   * the rest" rule so the name shown here matches what the backend will
   * actually do.
   */
  const reassignmentTargetName = (record: EventType): string | undefined => {
    const candidates = record.is_default
      ? eventTypes.filter(t => t.id !== record.id)
      : eventTypes.filter(t => t.is_default)
    const target = candidates.reduce<EventType | undefined>((lowest, t) => {
      if (!lowest) return t
      return (t.id ?? Infinity) < (lowest.id ?? Infinity) ? t : lowest
    }, undefined)
    return target?.name
  }

  // Whether this settings section matches an in-page search term. The grid's
  // own toolbar owns row-level filtering now; this only gates whether the
  // whole section renders (matching the section title, or any type by name).
  const matchesSearch = eventTypes.some(type =>
    type.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const shouldShow = searchTerm === '' ||
    'event types'.includes(searchTerm.toLowerCase()) ||
    'types'.includes(searchTerm.toLowerCase()) ||
    matchesSearch

  if (!shouldShow) return null

  return (
    <Space orientation="vertical" style={{ width: '100%', marginBottom: 16 }}>
      <Flex justify="space-between" align="center">
        <Text strong>Types</Text>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleAdd}
        >
          Add Type
        </Button>
      </Flex>
      
      <Text type="secondary">
        Define event types that can be automatically assigned based on rules or set manually.
      </Text>
        
        <DataGrid<EventType>
          data={eventTypes}
          columns={columns}
          isLoading={loading}
          getRowId={row => String(row.id)}
          variant="advanced"
          persistStateKey="event-types"
          csvFileName="event-types"
          emptyMessage="No event types yet."
        />
        
        <Modal
          title={editingType ? 'Edit Event Type' : 'Create Event Type'}
          open={modalVisible}
          onOk={handleSave}
          onCancel={() => setModalVisible(false)}
          okText="Save"
        >
          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
          >
            <Form.Item
              label="Name"
              name="name"
              rules={[{ required: true, message: 'Please enter a name' }]}
            >
              <Input placeholder="e.g., Work, Personal, Info" />
            </Form.Item>
            
            <Form.Item
              label="Color"
              name="color"
              rules={[{ required: true, message: 'Please select a color' }]}
            >
              <ColorPicker showText />
            </Form.Item>
            
            <Form.Item
              label="Billable Hours"
              name="is_billable"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item label="All-day hours" name="all_day_hours">
              <InputNumber min={0} max={24} step={0.5} style={{ width: 120 }} />
            </Form.Item>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              How much one day of an all-day event of this type is worth. Set 0 for types
              that shouldn't count toward hours at all, like a birthday or a public holiday.
            </Text>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              Events of this type will count toward hours worked calculations.
            </Text>
          </Form>
        </Modal>
    </Space>
  )
}

export default EventTypesSettings