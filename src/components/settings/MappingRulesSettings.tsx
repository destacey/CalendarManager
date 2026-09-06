import React, { useState, useEffect, useMemo } from 'react'
import { Typography, Space, Button, Table, Modal, Form, Input, Select, Switch, Popconfirm, Flex, Alert } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, SyncOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons'
import { MappingRule, Project, Activity, EventType } from '../../types'
import { useMessage } from '../../contexts/MessageContext'
import {
  getMappingRules,
  createMappingRule,
  updateMappingRule,
  deleteMappingRule,
  reorderMappingRules,
  applyMappingRules,
  InvalidMappingRuleError
} from '../../api/mapping'
import { getProjects } from '../../api/projects'
import { getActivities } from '../../api/activities'
import { getEventTypes } from '../../api/eventTypes'
import { useReloadOnShow } from '../../contexts/ScreenVisibilityContext'

const { Text } = Typography

interface MappingRulesSettingsProps {
  searchTerm?: string
}

/** Sentinel for "this project, no activity" — a real answer, not an absence. */
const NO_ACTIVITY = -1

const MappingRulesSettings: React.FC<MappingRulesSettingsProps> = ({ searchTerm = '' }) => {
  const messageApi = useMessage()
  const [rules, setRules] = useState<MappingRule[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [eventTypes, setEventTypes] = useState<EventType[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingRule, setEditingRule] = useState<MappingRule | null>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    loadAll()
  }, [])

  // Screens stay mounted, so the effect above runs once. This is what
  // picks up work done elsewhere while this one was hidden.
  useReloadOnShow(() => loadAll())

  const loadAll = async () => {
    try {
      setLoading(true)
      // In parallel: the rules table is unreadable without the names behind
      // its ids, so there is no useful intermediate state to render.
      const [r, p, a, t] = await Promise.all([
        getMappingRules(),
        getProjects(),
        getActivities(),
        getEventTypes()
      ])
      setRules(r)
      setProjects(p)
      setActivities(a)
      setEventTypes(t)
    } catch (error) {
      console.error('Error loading mapping rules:', error)
      messageApi.error('Failed to load mapping rules')
    } finally {
      setLoading(false)
    }
  }

  const projectById = useMemo(
    () => new Map(projects.map(p => [p.id!, p])),
    [projects]
  )
  const activityById = useMemo(
    () => new Map(activities.map(a => [a.id!, a])),
    [activities]
  )
  const typeById = useMemo(
    () => new Map(eventTypes.map(t => [t.id!, t])),
    [eventTypes]
  )

  const handleAdd = () => {
    setEditingRule(null)
    form.resetFields()
    form.setFieldsValue({
      name_operator: 'contains',
      name_value: '',
      category_value: '',
      type_id: null,
      project_id: projects[0]?.id,
      activity_id: NO_ACTIVITY,
      is_active: true
    })
    setModalVisible(true)
  }

  const handleEdit = (rule: MappingRule) => {
    setEditingRule(rule)
    form.setFieldsValue({
      name_operator: rule.name_operator ?? 'contains',
      name_value: rule.name_value ?? '',
      category_value: rule.category_value ?? '',
      type_id: rule.type_id ?? null,
      project_id: rule.project_id,
      activity_id: rule.activity_id ?? NO_ACTIVITY,
      is_active: rule.is_active
    })
    setModalVisible(true)
  }

  const handleDelete = async (rule: MappingRule) => {
    try {
      await deleteMappingRule(rule.id!)
      messageApi.success('Rule deleted')
      loadAll()
    } catch (error) {
      console.error('Error deleting rule:', error)
      messageApi.error('Failed to delete rule')
    }
  }

  const handleSave = async () => {
    let values
    try {
      values = await form.validateFields()
    } catch {
      return
    }

    const payload = {
      name_value: values.name_value?.trim() || null,
      // The operator only means anything alongside a value.
      name_operator: values.name_value?.trim() ? values.name_operator : null,
      category_value: values.category_value?.trim() || null,
      type_id: values.type_id ?? null,
      project_id: values.project_id,
      activity_id: values.activity_id === NO_ACTIVITY ? null : values.activity_id,
      is_active: values.is_active ?? true
    }

    try {
      if (editingRule) {
        await updateMappingRule(editingRule.id!, payload)
        messageApi.success('Rule updated')
      } else {
        await createMappingRule(payload)
        messageApi.success('Rule created')
      }
      setModalVisible(false)
      loadAll()
    } catch (error) {
      console.error('Error saving rule:', error)
      // A rule that tests nothing is the one failure with a message worth
      // showing verbatim — it is already user-facing prose from the backend.
      if (error instanceof InvalidMappingRuleError) {
        messageApi.error(error.message)
      } else {
        messageApi.error('Failed to save rule')
      }
    }
  }

  /* Order is the whole semantics of this list, so moving a rule has to be
     possible without a drag — one arrow click, and the backend rewrites every
     priority so no half-order can exist. */
  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= rules.length) return

    const ids = rules.map(r => r.id!)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]

    try {
      await reorderMappingRules(ids)
      loadAll()
    } catch (error) {
      console.error('Error reordering rules:', error)
      messageApi.error('Failed to reorder rules')
    }
  }

  const handleReapply = async () => {
    try {
      const result = await applyMappingRules()
      messageApi.success(
        `Mapped ${result.mapped} of ${result.evaluated} events` +
          (result.skippedManual > 0 ? ` — ${result.skippedManual} mapped by hand were left alone` : '')
      )
    } catch (error) {
      console.error('Error applying rules:', error)
      messageApi.error('Failed to apply rules')
    }
  }

  /** Reads a rule's conditions as prose rather than a row of raw columns. */
  const describe = (rule: MappingRule): React.ReactNode => {
    const parts: React.ReactNode[] = []
    if (rule.name_value) {
      parts.push(
        <span key="name">
          <Text type="secondary">name {rule.name_operator ?? 'is'} </Text>
          <Text code>{rule.name_value}</Text>
        </span>
      )
    }
    if (rule.category_value) {
      parts.push(
        <span key="cat">
          <Text type="secondary">category is </Text>
          <Text code>{rule.category_value}</Text>
        </span>
      )
    }
    if (rule.type_id != null) {
      parts.push(
        <span key="type">
          <Text type="secondary">type is </Text>
          <Text code>{typeById.get(rule.type_id)?.name ?? `#${rule.type_id}`}</Text>
        </span>
      )
    }
    return (
      <Space size={6} wrap>
        {parts.map((part, i) => (
          <span key={i}>
            {i > 0 && <Text type="secondary">and </Text>}
            {part}
          </span>
        ))}
      </Space>
    )
  }

  const columns = [
    {
      title: '#',
      key: 'priority',
      width: 50,
      render: (_: unknown, __: MappingRule, index: number) => (
        <Text type="secondary">{index + 1}</Text>
      )
    },
    {
      title: 'When an event matches',
      key: 'conditions',
      render: (_: unknown, record: MappingRule) => describe(record)
    },
    {
      title: 'Map to',
      key: 'target',
      render: (_: unknown, record: MappingRule) => {
        const project = projectById.get(record.project_id)
        const activity = record.activity_id != null ? activityById.get(record.activity_id) : null
        return (
          <Space size={6}>
            <Text code>{project?.code ?? `#${record.project_id}`}</Text>
            {activity ? (
              <>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: activity.color,
                    display: 'inline-block'
                  }}
                />
                <Text>{activity.name}</Text>
              </>
            ) : (
              <Text type="secondary">Project only</Text>
            )}
          </Space>
        )
      }
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
      title: 'Order',
      key: 'order',
      width: 90,
      render: (_: unknown, record: MappingRule, index: number) => (
        <Space size={4}>
          <Button
            icon={<ArrowUpOutlined />}
            size="small"
            disabled={index === 0}
            aria-label={`Move ${describeForLabel(record)} up`}
            onClick={() => move(index, -1)}
          />
          <Button
            icon={<ArrowDownOutlined />}
            size="small"
            disabled={index === rules.length - 1}
            aria-label={`Move ${describeForLabel(record)} down`}
            onClick={() => move(index, 1)}
          />
        </Space>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 110,
      render: (_: unknown, record: MappingRule) => (
        <Space>
          <Button
            icon={<EditOutlined />}
            size="small"
            aria-label={`Edit ${describeForLabel(record)}`}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title="Delete this rule?"
            description="Events it mapped go back to the queue."
            okText="Yes"
            cancelText="No"
            onConfirm={() => handleDelete(record)}
          >
            <Button
              icon={<DeleteOutlined />}
              size="small"
              danger
              aria-label={`Delete ${describeForLabel(record)}`}
            />
          </Popconfirm>
        </Space>
      )
    }
  ]

  const filteredRules = rules.filter(rule => {
    const term = searchTerm.toLowerCase()
    if (term === '') return true
    return (
      (rule.name_value ?? '').toLowerCase().includes(term) ||
      (rule.category_value ?? '').toLowerCase().includes(term) ||
      (projectById.get(rule.project_id)?.name ?? '').toLowerCase().includes(term)
    )
  })

  const shouldShow =
    searchTerm === '' ||
    'mapping rules'.includes(searchTerm.toLowerCase()) ||
    filteredRules.length > 0

  if (!shouldShow) return null

  return (
    <Space orientation="vertical" style={{ width: '100%', marginBottom: 16 }}>
      <Flex justify="space-between" align="center">
        <Text strong>Mapping Rules</Text>
        <Space>
          <Button icon={<SyncOutlined />} onClick={handleReapply}>
            Re-run on all events
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAdd}
            disabled={projects.length === 0}
          >
            Add Rule
          </Button>
        </Space>
      </Flex>

      <Text type="secondary">
        Checked top to bottom — the first rule that matches wins. Rules never change an event you
        mapped by hand.
      </Text>

      {projects.length === 0 && (
        <Alert
          type="info"
          showIcon
          title="No projects yet"
          description="A rule has to map to a project, so add one on the Projects tab first."
        />
      )}

      <Table
        columns={columns}
        dataSource={filteredRules}
        loading={loading}
        rowKey="id"
        pagination={false}
        size="small"
      />

      <Modal
        title={editingRule ? 'Edit Rule' : 'Create Rule'}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => setModalVisible(false)}
        okText="Save"
        width={560}
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Leave a condition blank to ignore it. A rule needs at least one.
          </Text>

          <Flex gap={8} style={{ marginTop: 12 }}>
            <Form.Item label="Name" name="name_operator" style={{ width: 130 }}>
              <Select
                options={[
                  { value: 'contains', label: 'contains' },
                  { value: 'is', label: 'is' }
                ]}
              />
            </Form.Item>
            <Form.Item label=" " name="name_value" style={{ flexGrow: 1 }}>
              <Input placeholder="e.g. Daily Standup" />
            </Form.Item>
          </Flex>

          <Form.Item label="Category is" name="category_value">
            <Input placeholder="e.g. Scrum" />
          </Form.Item>

          <Form.Item label="Event type is" name="type_id">
            <Select
              allowClear
              placeholder="Any type"
              options={eventTypes.map(t => ({ value: t.id!, label: t.name }))}
            />
          </Form.Item>

          <Form.Item
            label="Map to project"
            name="project_id"
            rules={[{ required: true, message: 'Please choose a project' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={projects.map(p => ({ value: p.id!, label: `${p.code} — ${p.name}` }))}
            />
          </Form.Item>

          <Form.Item label="Activity" name="activity_id">
            <Select
              showSearch
              optionFilterProp="label"
              options={[
                { value: NO_ACTIVITY, label: 'Project only, no activity' },
                ...activities.map(a => ({ value: a.id!, label: a.name }))
              ]}
            />
          </Form.Item>

          <Form.Item label="Active" name="is_active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}

/** A short, stable handle for accessible labels on the row buttons. */
function describeForLabel(rule: MappingRule): string {
  return rule.name_value ?? rule.category_value ?? `rule ${rule.id}`
}

export default MappingRulesSettings
