import React, { useState, useEffect } from 'react'
import { Typography, Space, Button, Modal, Form, Input, Select, AutoComplete, Popconfirm, App, Flex, theme } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ItemType } from 'antd/es/menu/interface'
import { EventType, EventTypeRule } from '../../types'
import { useMessage } from '../../contexts/MessageContext'
import { getEventTypeRules, createEventTypeRule, updateEventTypeRule, deleteEventTypeRule, updateRulePriorities, InvalidTargetTypeError } from '../../api/rules'
import { getEventTypes, reprocessEventTypes } from '../../api/eventTypes'
import { getEventCategories } from '../../api/events'
import { useReloadOnShow } from '../../contexts/ScreenVisibilityContext'
import { DataGrid, createActionsColumn, confirmDelete, DragHandleCell } from '../grid'
import type { ColumnDef, GridColumnContext, RowReorderEvent } from '../grid'
// Not re-exported by the top-level grid barrel (only DataGrid, the column
// helpers and confirmDelete are) — this page is the only row-reorder
// consumer among the migrated settings tables, so it reaches one level
// deeper for the drag-handle cell rather than widening that barrel.

const { Text } = Typography
const { Option } = Select

interface EventTypeRulesSettingsProps {
  searchTerm?: string
  onEventsUpdated?: () => void
}

const EventTypeRulesSettings: React.FC<EventTypeRulesSettingsProps> = ({ searchTerm = '', onEventsUpdated }) => {
  const messageApi = useMessage()
  const { modal, notification } = App.useApp()
  const { token } = theme.useToken()
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

  useEffect(() => {
    loadData()
  }, [])

  // Screens stay mounted, so the effect above runs once. This is what
  // picks up work done elsewhere while this one was hidden.
  useReloadOnShow(() => loadData())

  const loadData = async () => {
    try {
      setLoading(true)
      const [rulesData, typesData, categories] = await Promise.all([
        getEventTypeRules(),
        getEventTypes(),
        getEventCategories()
      ])
      setRules(rulesData)
      setEventTypes(typesData)
      setExistingCategories(categories)
    } catch (error) {
      console.error('Error loading rules:', error)
      messageApi.error('Failed to load rules')
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
      const success = await deleteEventTypeRule(rule.id!)
      if (success) {
        // After deletion, reorder priorities for remaining rules
        const remainingRules = rules
          .filter(r => r.id !== rule.id)
          .sort((a, b) => a.priority - b.priority)

        if (remainingRules.length > 0) {
          const ruleIds = remainingRules.map(r => r.id!)
          await updateRulePriorities(ruleIds)
        }

        messageApi.success('Rule deleted')
        loadData()
      } else {
        messageApi.error('Failed to delete rule')
      }
    } catch (error) {
      console.error('Error deleting rule:', error)
      messageApi.error('Failed to delete rule')
    }
  }

  const handleDeleteClick = (rule: EventTypeRule) => {
    confirmDelete(modal, {
      content: 'Remaining rules keep their relative order.',
      onConfirm: () => handleDelete(rule),
    })
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()

      if (editingRule) {
        // Update existing rule - keep existing priority
        const ruleData = { ...values, priority: editingRule.priority }
        const updated = await updateEventTypeRule(editingRule.id!, ruleData)
        if (updated) {
          messageApi.success('Rule updated')
        }
      } else {
        // Create new rule - assign next available priority (lowest priority)
        const ruleData = { ...values, priority: rules.length + 1 }
        const created = await createEventTypeRule(ruleData)
        if (created) {
          messageApi.success('Rule created')
        }
      }

      setModalVisible(false)
      loadData()
    } catch (error) {
      console.error('Error saving rule:', error)
      messageApi.error(error instanceof InvalidTargetTypeError ? error.message : 'Failed to save rule')
    }
  }

  /* The grid computes the dropped-order payload itself (it's pure arithmetic
     over the displayed rows) and auto-disables dragging while sorted, filtered
     or searched, so there is no index math left to do here — just persist the
     new priority order and reload to pick up the authoritative rows. */
  const handleRowReorder = async ({ orderedData }: RowReorderEvent<EventTypeRule>) => {
    try {
      await updateRulePriorities(orderedData.map(rule => rule.id!))
      await loadData()
    } catch (error) {
      console.error('Error updating rule priorities:', error)
      messageApi.error('Failed to update rule order')
      // Revert the change
      loadData()
    }
  }

  const handleReprocessEvents = async () => {
    try {
      setReprocessing(true)
      const result = await reprocessEventTypes()
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

  /** Reads a rule's condition as prose ("Title Contains \"work\""), and also
   *  backs the condition column's search/filter via its accessorFn. */
  const describeCondition = (rule: EventTypeRule): string => {
    const fieldLabel = getFieldOptions().find(f => f.value === rule.field_name)?.label
    const operatorLabel = getOperatorOptions(rule.field_name).find(o => o.value === rule.operator)?.label
    const valueDisplay = rule.operator === 'is_empty' ? '' : ` "${rule.value}"`
    return `${fieldLabel} ${operatorLabel}${valueDisplay}`
  }

  // The Priority column reads `rule.priority` (the backend's own order),
  // never the grid's row-render position — the grid can sort and filter, so
  // a column or handler derived from a row's displayed index would silently
  // point at the wrong record the moment the user sorts. Same reasoning for
  // reorder: `handleRowReorder` above writes the ids DataGrid hands back in
  // `orderedData`, never anything computed from a render index.
  const columns = ({ isDragEnabled }: GridColumnContext): ColumnDef<EventTypeRule, unknown>[] => [
    {
      accessorKey: 'priority',
      header: 'Priority',
      size: 90,
      cell: ({ row }) => (
        <Space size={4}>
          <DragHandleCell
            isDragEnabled={isDragEnabled}
            disabledTooltip="Clear sorting, filters and search to reorder rules"
          />
          <Text>{row.original.priority}</Text>
        </Space>
      ),
    },
    {
      accessorKey: 'name',
      header: 'Rule Name',
    },
    {
      id: 'condition',
      header: 'Condition',
      accessorFn: (rule: EventTypeRule) => describeCondition(rule),
      cell: ({ row }) => describeCondition(row.original),
    },
    {
      id: 'type',
      header: 'Assigns Type',
      accessorFn: (rule: EventTypeRule) => eventTypes.find(t => t.id === rule.target_type_id)?.name ?? 'Unknown',
      cell: ({ row }) => {
        const type = eventTypes.find(t => t.id === row.original.target_type_id)
        return type ? (
          <Space>
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: 4,
                backgroundColor: type.color,
                border: `1px solid ${token.colorBorder}`
              }}
            />
            {type.name}
          </Space>
        ) : 'Unknown'
      },
    },
    createActionsColumn<EventTypeRule>({
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
  // whole section renders (matching the section title, or any rule by name).
  const matchesSearch = rules.some(rule =>
    rule.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const shouldShow = searchTerm === '' ||
    'rules'.includes(searchTerm.toLowerCase()) ||
    'automation'.includes(searchTerm.toLowerCase()) ||
    matchesSearch

  if (!shouldShow) return null

  return (
    <Space orientation="vertical" style={{ width: '100%', marginBottom: 16 }}>
      <Flex justify="space-between" align="center">
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
      </Flex>

      <Text type="secondary">
        Rules automatically assign event types based on event properties. Rules are evaluated in priority order (drag to reorder).
      </Text>

      <DataGrid<EventTypeRule>
        data={rules}
        columns={columns}
        isLoading={loading}
        getRowId={row => String(row.id)}
        variant="advanced"
        persistStateKey="event-type-rules"
        csvFileName="event-type-rules"
        onRowReorder={handleRowReorder}
        emptyMessage="No rules yet."
      />

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
              <Select allowClear showSearch optionFilterProp="children">
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
                filterOption={(inputValue: string, option) =>
                  option?.label?.toLowerCase().includes(inputValue.toLowerCase()) ?? false
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
                        border: `1px solid ${token.colorBorder}`
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
  )
}

export default EventTypeRulesSettings
