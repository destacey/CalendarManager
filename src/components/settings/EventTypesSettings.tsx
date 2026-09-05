import React, { useState, useEffect } from 'react'
import { Typography, Space, Button, Table, Modal, Form, Input, InputNumber, ColorPicker, Switch, Popconfirm, theme, Flex } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, StarOutlined, StarFilled } from '@ant-design/icons'
import { EventType } from '../../types'
import { useMessage } from '../../contexts/MessageContext'
import { getEventTypes, createEventType, updateEventType, deleteEventType, setDefaultEventType } from '../../api/eventTypes'

const { Text } = Typography

interface EventTypesSettingsProps {
  searchTerm?: string
}

const EventTypesSettings: React.FC<EventTypesSettingsProps> = ({ searchTerm = '' }) => {
  const messageApi = useMessage()
  const { token } = theme.useToken()
  const [eventTypes, setEventTypes] = useState<EventType[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingType, setEditingType] = useState<EventType | null>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    loadEventTypes()
  }, [])

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

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: EventType) => (
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
          {text}
          {record.is_default && <Text type="secondary">(Default)</Text>}
        </Space>
      ),
    },
    {
      title: 'Color',
      dataIndex: 'color',
      key: 'color',
      width: 80,
      render: (color: string) => (
        <div 
          style={{ 
            width: 24, 
            height: 24, 
            borderRadius: 4, 
            backgroundColor: color,
            border: `1px solid ${token.colorBorder}`
          }} 
        />
      ),
    },
    {
      title: 'Billable',
      dataIndex: 'is_billable',
      key: 'is_billable',
      width: 80,
      render: (is_billable: boolean) => (
        <Text type={is_billable ? 'success' : 'secondary'}>
          {is_billable ? 'Yes' : 'No'}
        </Text>
      ),
    },
    {
      title: 'All-day hours',
      dataIndex: 'all_day_hours',
      key: 'all_day_hours',
      width: 110,
      render: (hours: number) =>
        hours > 0 ? (
          <Text>{hours}</Text>
        ) : (
          <Text type="secondary">Doesn't count</Text>
        ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 160,
      render: (_: any, record: EventType) => (
        <Space>
          {!record.is_default && (
            <Button
              icon={<StarOutlined />}
              size="small"
              title="Set as Default"
              onClick={() => handleSetDefault(record)}
            />
          )}
          <Button
            icon={<EditOutlined />}
            size="small"
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title="Are you sure?"
            description={
              reassignmentTargetName(record)
                ? `Events using this type will be moved to "${reassignmentTargetName(record)}".`
                : 'Events using this type will be moved to the default type.'
            }
            onConfirm={() => handleDelete(record)}
          >
            <Button
              icon={<DeleteOutlined />}
              size="small"
              danger
            />
          </Popconfirm>
        </Space>
      ),
    },
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

  // Filter types based on search term
  const filteredTypes = eventTypes.filter(type =>
    type.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const shouldShow = searchTerm === '' || 
    'event types'.includes(searchTerm.toLowerCase()) ||
    'types'.includes(searchTerm.toLowerCase()) ||
    filteredTypes.length > 0

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
        
        <Table
          columns={columns}
          dataSource={filteredTypes}
          loading={loading}
          rowKey="id"
          pagination={false}
          size="small"
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