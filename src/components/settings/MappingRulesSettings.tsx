import React, { useState, useEffect, useMemo } from 'react'
import {
  Typography, Space, Button, App, Modal, Form, Input, Select, Switch, Flex,
  Alert, Checkbox
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, SyncOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons'
import type { ItemType } from 'antd/es/menu/interface'
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
import { DataGrid, createActionsColumn, confirmDelete } from '../grid'
import type { ColumnDef } from '../grid'

const { Text } = Typography

interface MappingRulesSettingsProps {
  searchTerm?: string
}

/** Sentinel for "this project, no activity" — a real answer, not an absence. */
const NO_ACTIVITY = -1

const MappingRulesSettings: React.FC<MappingRulesSettingsProps> = ({ searchTerm = '' }) => {
  const messageApi = useMessage()
  const { modal } = App.useApp()
  const [rules, setRules] = useState<MappingRule[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [eventTypes, setEventTypes] = useState<EventType[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [runVisible, setRunVisible] = useState(false)
  const [running, setRunning] = useState(false)
  const [overwriteExisting, setOverwriteExisting] = useState(false)
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

  const handleDeleteClick = (rule: MappingRule) => {
    confirmDelete(modal, {
      content: 'Events it mapped go back to the queue.',
      onConfirm: () => handleDelete(rule),
    })
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
    setRunning(true)
    try {
      const result = await applyMappingRules(overwriteExisting)
      const said = [
        `Mapped ${result.mapped} of ${result.evaluated} event${result.evaluated === 1 ? '' : 's'}`,
        result.overwritten > 0 && `${result.overwritten} replaced`,
        result.cleared > 0 && `${result.cleared} cleared`,
        result.skippedManual > 0 && `${result.skippedManual} mapped by hand were left alone`
      ].filter(Boolean)
      messageApi.success(said.join(' — '))
      setRunVisible(false)
      setOverwriteExisting(false)
    } catch (error) {
      console.error('Error applying rules:', error)
      messageApi.error('Failed to apply rules')
    } finally {
      setRunning(false)
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

  // The Order column's arrows and the "#" column both need a rule's position
  // among ALL rules, not its position among the grid's currently displayed
  // (sorted/filtered/searched) rows — so they read `priority` (the backend's
  // own 1-based order, matching `rules`' index) rather than the table row's
  // display index.
  const columns: ColumnDef<MappingRule, unknown>[] = [
    {
      accessorKey: 'priority',
      header: '#',
      size: 50,
      cell: ({ row }) => <Text type="secondary">{row.original.priority}</Text>,
    },
    {
      id: 'conditions',
      header: 'When an event matches',
      // No single field backs this column — it reads whichever conditions
      // are set — so the accessor composes a flat string purely so the
      // grid's global search and column filter have something to match
      // against; `cell` still renders the rich prose.
      accessorFn: (rule: MappingRule) =>
        [
          rule.name_value,
          rule.category_value,
          rule.type_id != null ? typeById.get(rule.type_id)?.name : null
        ].filter(Boolean).join(' '),
      cell: ({ row }) => describe(row.original),
    },
    {
      id: 'target',
      header: 'Map to',
      accessorFn: (rule: MappingRule) => {
        const project = projectById.get(rule.project_id)
        const activity = rule.activity_id != null ? activityById.get(rule.activity_id) : null
        return [project?.code, project?.name, activity?.name ?? 'Project only'].filter(Boolean).join(' ')
      },
      cell: ({ row }) => {
        const record = row.original
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
      },
    },
    {
      accessorKey: 'is_active',
      header: 'Active',
      size: 80,
      meta: { columnType: 'yesNo' },
      // Explicit cell wins over the yesNo preset's plain-text one (see
      // column-types.ts's applyColumnType), while the preset still supplies
      // the sort/filter behaviour via its accessorFn.
      cell: ({ row }) => (
        <Text type={row.original.is_active ? 'success' : 'secondary'}>
          {row.original.is_active ? 'Yes' : 'No'}
        </Text>
      ),
    },
    {
      id: 'order',
      header: 'Order',
      size: 90,
      enableSorting: false,
      enableColumnFilter: false,
      enableGlobalFilter: false,
      cell: ({ row }) => {
        const record = row.original
        const index = record.priority - 1
        return (
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
    },
    createActionsColumn<MappingRule>({
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
  // whole section renders (matching the section title, or any rule by its
  // name/category/project).
  const matchesSearch = rules.some(rule => {
    const term = searchTerm.toLowerCase()
    return (
      (rule.name_value ?? '').toLowerCase().includes(term) ||
      (rule.category_value ?? '').toLowerCase().includes(term) ||
      (projectById.get(rule.project_id)?.name ?? '').toLowerCase().includes(term)
    )
  })

  const shouldShow =
    searchTerm === '' ||
    'mapping rules'.includes(searchTerm.toLowerCase()) ||
    matchesSearch

  if (!shouldShow) return null

  return (
    <Space orientation="vertical" style={{ width: '100%', marginBottom: 16 }}>
      <Flex justify="space-between" align="center">
        <Text strong>Mapping Rules</Text>
        <Space>
          <Button icon={<SyncOutlined />} onClick={() => setRunVisible(true)}>
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

      <DataGrid<MappingRule>
        data={rules}
        columns={columns}
        isLoading={loading}
        getRowId={row => String(row.id)}
        variant="advanced"
        persistStateKey="mapping-rules"
        csvFileName="mapping-rules"
        emptyMessage="No mapping rules yet."
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

      <Modal
        title="Re-run rules on all events"
        open={runVisible}
        onOk={handleReapply}
        onCancel={() => setRunVisible(false)}
        okText="Run"
        okButtonProps={{ loading: running }}
      >
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <Text>
            Every rule is tested against your events, in order, and the first one that matches
            decides the mapping.
          </Text>

          <Checkbox
            checked={overwriteExisting}
            onChange={e => setOverwriteExisting(e.target.checked)}
          >
            Replace mappings that already exist
          </Checkbox>

          {/* What the box actually changes, rather than a warning nobody
              reads: unticked can only add, ticked can take away. */}
          {overwriteExisting ? (
            <Alert
              type="warning"
              showIcon
              message="Mappings you made by hand can be moved"
              description="Where a rule matches, it replaces what is there and takes ownership of it. Mappings left behind by a rule that no longer matches are cleared. Anything no rule matches is left as it is."
            />
          ) : (
            <Alert
              type="info"
              showIcon
              message="Only events with no mapping will be touched"
              description="Nothing you have already mapped — by hand or by an earlier run — will change."
            />
          )}
        </Space>
      </Modal>

    </Space>
  )
}

/** A short, stable handle for accessible labels on the row buttons. */
function describeForLabel(rule: MappingRule): string {
  return rule.name_value ?? rule.category_value ?? `rule ${rule.id}`
}

export default MappingRulesSettings
