import React, { useState, useEffect } from 'react'
import { Card, Typography, Space, Button, Table, Modal, Form, Input, Select, AutoComplete, message, Popconfirm, App } from 'antd'
import { SettingOutlined, PlusOutlined, EditOutlined, DeleteOutlined, HolderOutlined, ReloadOutlined } from '@ant-design/icons'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { EventType, EventTypeRule } from '../../types'

const { Title, Text } = Typography
const { Option } = Select

interface EventTypeRulesSettingsProps {
  searchTerm?: string
  onEventsUpdated?: () => void
}

interface SortableRowProps {
  children: React.ReactNode
  'data-row-key': string
}

const SortableRow: React.FC<SortableRowProps> = ({ children, ...props }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: props['data-row-key'],
  })

  const style: React.CSSProperties = {
    ...props.style,
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { position: 'relative', zIndex: 9999 } : {}),
  }

  return (
    <tr {...props} ref={setNodeRef} style={style}>
      {React.Children.map(children, (child, index) => {
        if (index === 0) {
          return React.cloneElement(child as React.ReactElement, {
            children: (
              <Space>
                <span {...attributes} {...listeners} style={{ cursor: 'grab' }}>
                  <HolderOutlined />
                </span>
                {(child as React.ReactElement).props.children}
              </Space>
            ),
          })
        }
        return child
      })}
    </tr>
  )
}

const EventTypeRulesSettings: React.FC<EventTypeRulesSettingsProps> = ({ searchTerm = '', onEventsUpdated }) => {
  const { notification } = App.useApp()
  const [rules, setRules] = useState<EventTypeRule[]>([])
  const [eventTypes, setEventTypes] = useState<EventType[]>([])
  const [existingCategories, setExistingCategories] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [reprocessing, setReprocessing] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingRule, setEditingRule] = useState<EventTypeRule | null>(null)
  const [form] = Form.useForm()
  
  // Watch form field changes
  const fieldName = Form.useWatch('field_name', form)
  const operator = Form.useWatch('operator', form)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      if (window.electronAPI?.getEventTypeRules && window.electronAPI?.getEventTypes && window.electronAPI?.getEvents) {
        const [rulesData, typesData, eventsData] = await Promise.all([
          window.electronAPI.getEventTypeRules(),
          window.electronAPI.getEventTypes(),
          window.electronAPI.getEvents()
        ])
        setRules(rulesData)
        setEventTypes(typesData)
        
        // Extract unique categories from existing events
        const categoriesSet = new Set<string>()
        eventsData.forEach(event => {
          if (event.categories && event.categories.trim()) {
            // Split comma-separated categories and add each one
            event.categories.split(',').forEach(cat => {
              const trimmedCat = cat.trim()
              if (trimmedCat) {
                categoriesSet.add(trimmedCat)
              }
            })
          }
        })
        setExistingCategories(Array.from(categoriesSet).sort())
      }
    } catch (error) {
      console.error('Error loading rules:', error)
      message.error('Failed to load rules')
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditingRule(null)
    form.resetFields()
    form.setFieldsValue({
      name: '',
      field_name: 'title',
      operator: 'contains',
      value: '',
      target_type_id: undefined
    })
    setModalVisible(true)
  }

  const handleEdit = (rule: EventTypeRule) => {
    setEditingRule(rule)
    form.setFieldsValue(rule)
    setModalVisible(true)
  }

  const handleDelete = async (rule: EventTypeRule) => {
    try {
      if (!window.electronAPI?.deleteEventTypeRule) return
      
      const success = await window.electronAPI.deleteEventTypeRule(rule.id!)
      if (success) {
        message.success('Rule deleted')
        loadData()
      } else {
        message.error('Failed to delete rule')
      }
    } catch (error) {
      console.error('Error deleting rule:', error)
      message.error('Failed to delete rule')
    }
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      
      if (editingRule) {
        // Update existing rule - keep existing priority
        const ruleData = { ...values, priority: editingRule.priority }
        if (!window.electronAPI?.updateEventTypeRule) return
        const updated = await window.electronAPI.updateEventTypeRule(editingRule.id!, ruleData)
        if (updated) {
          message.success('Rule updated')
        }
      } else {
        // Create new rule - assign next available priority (lowest priority)
        const ruleData = { ...values, priority: rules.length + 1 }
        if (!window.electronAPI?.createEventTypeRule) return
        const created = await window.electronAPI.createEventTypeRule(ruleData)
        if (created) {
          message.success('Rule created')
        }
      }
      
      setModalVisible(false)
      loadData()
    } catch (error) {
      console.error('Error saving rule:', error)
      message.error('Failed to save rule')
    }
  }

  const handleDragEnd = async (event: any) => {
    const { active, over } = event

    if (active.id !== over?.id) {
      const oldIndex = rules.findIndex(rule => rule.id!.toString() === active.id)
      const newIndex = rules.findIndex(rule => rule.id!.toString() === over.id)
      
      const newRules = arrayMove(rules, oldIndex, newIndex)
      setRules(newRules)
      
      // Update priorities in backend
      try {
        if (window.electronAPI?.updateRulePriorities) {
          const ruleIds = newRules.map(rule => rule.id!)
          await window.electronAPI.updateRulePriorities(ruleIds)
        }
      } catch (error) {
        console.error('Error updating rule priorities:', error)
        message.error('Failed to update rule order')
        // Revert the change
        loadData()
      }
    }
  }

  const handleReprocessEvents = async () => {
    try {
      setReprocessing(true)
      if (window.electronAPI?.reprocessEventTypes) {
        const result = await window.electronAPI.reprocessEventTypes()
        if (result.success) {
          notification.success({
            message: 'Events Reprocessed',
            description: result.message,
            duration: 4
          })
          // Refresh calendar data
          onEventsUpdated?.()
        } else {
          notification.error({
            message: 'Reprocessing Failed', 
            description: result.message,
            duration: 6
          })
        }
      }
    } catch (error) {
      console.error('Error reprocessing events:', error)
      notification.error({
        message: 'Reprocessing Failed',
        description: 'Failed to reprocess events',
        duration: 6
      })
    } finally {
      setReprocessing(false)
    }
  }

  const getFieldOptions = () => [
    { value: 'title', label: 'Title' },
    { value: 'is_all_day', label: 'All Day' },
    { value: 'show_as', label: 'Show As' },
    { value: 'categories', label: 'Categories' },
  ]

  const getOperatorOptions = (fieldName: string) => {
    switch (fieldName) {
      case 'is_all_day':
        return [{ value: 'equals', label: 'Equals' }]
      case 'show_as':
        return [{ value: 'equals', label: 'Equals' }]
      default:
        return [
          { value: 'contains', label: 'Contains' },
          { value: 'equals', label: 'Equals' },
          { value: 'is_empty', label: 'Is Empty' },
        ]
    }
  }

  const getValueOptions = (fieldName: string) => {
    switch (fieldName) {
      case 'is_all_day':
        return [
          { value: 'true', label: 'True' },
          { value: 'false', label: 'False' },
        ]
      case 'show_as':
        return [
          { value: 'free', label: 'Free' },
          { value: 'tentative', label: 'Tentative' },
          { value: 'busy', label: 'Busy' },
          { value: 'oof', label: 'Out of Office' },
          { value: 'workingElsewhere', label: 'Working Elsewhere' },
        ]
      default:
        return []
    }
  }

  const columns = [
    {
      title: 'Priority',
      dataIndex: 'priority',
      key: 'priority',
      width: 80,
      render: (text: number) => (
        <Space>
          <HolderOutlined style={{ color: '#999' }} />
          {text}
        </Space>
      ),
    },
    {
      title: 'Rule Name',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Condition',
      key: 'condition',
      render: (_, record: EventTypeRule) => {
        const fieldLabel = getFieldOptions().find(f => f.value === record.field_name)?.label
        const operatorLabel = getOperatorOptions(record.field_name).find(o => o.value === record.operator)?.label
        const valueDisplay = record.operator === 'is_empty' ? '' : ` "${record.value}"`
        return `${fieldLabel} ${operatorLabel}${valueDisplay}`
      },
    },
    {
      title: 'Assigns Type',
      key: 'type',
      render: (_, record: EventTypeRule) => {
        const type = eventTypes.find(t => t.id === record.target_type_id)
        return type ? (
          <Space>
            <div 
              style={{ 
                width: 16, 
                height: 16, 
                borderRadius: 4, 
                backgroundColor: type.color,
                border: '1px solid #d9d9d9'
              }} 
            />
            {type.name}
          </Space>
        ) : 'Unknown'
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 120,
      render: (_, record: EventTypeRule) => (
        <Space>
          <Button
            icon={<EditOutlined />}
            size="small"
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title="Are you sure?"
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

  // Filter rules based on search term
  const filteredRules = rules.filter(rule =>
    rule.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const shouldShow = searchTerm === '' || 
    'rules'.includes(searchTerm.toLowerCase()) ||
    'automation'.includes(searchTerm.toLowerCase()) ||
    filteredRules.length > 0

  if (!shouldShow) return null

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <Text strong>Rules</Text>
        <Space>
          <Popconfirm
            title="Process rules for all events?"
            description="This will re-evaluate type rules for all existing events (except manually set ones). Continue?"
            onConfirm={handleReprocessEvents}
            okText="Yes, process"
            cancelText="Cancel"
          >
            <Button
              icon={<ReloadOutlined />}
              loading={reprocessing}
              disabled={rules.length === 0}
            >
              Process Rules
            </Button>
          </Popconfirm>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAdd}
          >
            Add Rule
          </Button>
        </Space>
      </div>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Text type="secondary">
          Rules automatically assign event types based on event properties. Rules are evaluated in priority order (drag to reorder).
        </Text>
        
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={filteredRules.map(rule => rule.id!.toString())}
            strategy={verticalListSortingStrategy}
          >
            <Table
              columns={columns}
              dataSource={filteredRules}
              loading={loading}
              rowKey="id"
              pagination={false}
              size="small"
              components={{
                body: {
                  row: SortableRow,
                },
              }}
            />
          </SortableContext>
        </DndContext>
        
        <Modal
          title={editingRule ? 'Edit Rule' : 'Create Rule'}
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
              label="Rule Name"
              name="name"
              rules={[{ required: true, message: 'Please enter a rule name' }]}
            >
              <Input placeholder="e.g., Free time → Info" />
            </Form.Item>
            
            <Form.Item
              label="Field"
              name="field_name"
              rules={[{ required: true, message: 'Please select a field' }]}
            >
              <Select 
                onChange={() => {
                  // Clear dependent fields when field changes
                  form.setFieldsValue({ operator: undefined, value: undefined })
                }}
              >
                {getFieldOptions().map(option => (
                  <Option key={option.value} value={option.value}>
                    {option.label}
                  </Option>
                ))}
              </Select>
            </Form.Item>
            
            <Form.Item
              label="Operator"
              name="operator"
              rules={[{ required: true, message: 'Please select an operator' }]}
            >
              <Select
                onChange={() => {
                  // Clear value field when operator changes
                  form.setFieldsValue({ value: undefined })
                }}
              >
                {getOperatorOptions(fieldName).map(option => (
                  <Option key={option.value} value={option.value}>
                    {option.label}
                  </Option>
                ))}
              </Select>
            </Form.Item>
            
            <Form.Item
              label="Value"
              name="value"
              rules={[
                {
                  required: operator !== 'is_empty',
                  message: 'Please enter a value'
                }
              ]}
            >
              {getValueOptions(fieldName)?.length > 0 ? (
                <Select allowClear>
                  {getValueOptions(fieldName).map(option => (
                    <Option key={option.value} value={option.value}>
                      {option.label}
                    </Option>
                  ))}
                </Select>
              ) : fieldName === 'categories' && existingCategories.length > 0 ? (
                <AutoComplete
                  placeholder={operator === 'is_empty' ? 'Not needed for "is empty"' : 'Select or type a category'}
                  disabled={operator === 'is_empty'}
                  options={existingCategories.map(category => ({
                    value: category,
                    label: category
                  }))}
                  filterOption={(inputValue, option) =>
                    option?.label?.toLowerCase().includes(inputValue.toLowerCase())
                  }
                  allowClear
                />
              ) : (
                <Input
                  placeholder={operator === 'is_empty' ? 'Not needed for "is empty"' : 'Enter value to match'}
                  disabled={operator === 'is_empty'}
                />
              )}
            </Form.Item>
            
            
            <Form.Item
              label="Assign Type"
              name="target_type_id"
              rules={[{ required: true, message: 'Please select a type to assign' }]}
            >
              <Select>
                {eventTypes.map(type => (
                  <Option key={type.id} value={type.id}>
                    <Space>
                      <div 
                        style={{ 
                          width: 16, 
                          height: 16, 
                          borderRadius: 4, 
                          backgroundColor: type.color,
                          border: '1px solid #d9d9d9'
                        }} 
                      />
                      {type.name}
                    </Space>
                  </Option>
                ))}
              </Select>
            </Form.Item>
          </Form>
        </Modal>
      </Space>
    </div>
  )
}

export default EventTypeRulesSettings