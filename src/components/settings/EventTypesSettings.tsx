import React, { useState, useEffect } from 'react'
import { Typography, Space, Button, Table, Modal, Form, Input, ColorPicker, Switch, Popconfirm, App, theme, Flex } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { EventType } from '../../types'

const { Text } = Typography

interface EventTypesSettingsProps {
  searchTerm?: string
}

const EventTypesSettings: React.FC<EventTypesSettingsProps> = ({ searchTerm = '' }) => {
  const { message } = App.useApp()
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
      if (window.electronAPI?.getEventTypes) {
        const types = await window.electronAPI.getEventTypes()
        setEventTypes(types)
      }
    } catch (error) {
      console.error('Error loading event types:', error)
      message.error('Failed to load event types')
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
      is_default: false
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
      if (!window.electronAPI?.deleteEventType) return
      
      const success = await window.electronAPI.deleteEventType(type.id!)
      if (success) {
        message.success('Event type deleted')
        loadEventTypes()
      } else {
        message.error('Failed to delete event type')
      }
    } catch (error) {
      console.error('Error deleting event type:', error)
      message.error('Failed to delete event type')
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
        if (!window.electronAPI?.updateEventType) return
        const updated = await window.electronAPI.updateEventType(editingType.id!, processedValues)
        if (updated) {
          message.success('Event type updated')
        }
      } else {
        // Create new type
        if (!window.electronAPI?.createEventType) return
        const created = await window.electronAPI.createEventType(processedValues)
        if (created) {
          message.success('Event type created')
        }
      }
      
      setModalVisible(false)
      loadEventTypes()
    } catch (error) {
      console.error('Error saving event type:', error)
      message.error('Failed to save event type')
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
      width: 100,
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
      title: 'Actions',
      key: 'actions',
      width: 120,
      render: (_: any, record: EventType) => (
        <Space>
          <Button
            icon={<EditOutlined />}
            size="small"
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title="Are you sure?"
            description="This will remove the type from all events using it."
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
    <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
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
              label="Default Type"
              name="is_default"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              The default type is assigned when no rules match an event.
            </Text>
          </Form>
        </Modal>
    </Space>
  )
}

export default EventTypesSettings