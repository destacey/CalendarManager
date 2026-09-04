import React, { useState, useEffect } from 'react'
import { Typography, Space, Button, Table, Modal, Form, Input, Switch, Popconfirm, Flex, Alert } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, UploadOutlined } from '@ant-design/icons'
import { Project } from '../../types'
import { useMessage } from '../../contexts/MessageContext'
import {
  getProjects,
  createProject,
  updateProject,
  deleteProject,
  DuplicateProjectCodeError
} from '../../api/projects'
import {
  pickProjectCsv,
  previewProjectImport,
  commitProjectImport,
  ProjectImportPreview
} from '../../api/projectImport'

const { Text } = Typography

interface ProjectsSettingsProps {
  searchTerm?: string
}

const ProjectsSettings: React.FC<ProjectsSettingsProps> = ({ searchTerm = '' }) => {
  const messageApi = useMessage()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [form] = Form.useForm()
  const [importPreview, setImportPreview] = useState<ProjectImportPreview | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    loadProjects()
  }, [])

  const loadProjects = async () => {
    try {
      setLoading(true)
      setProjects(await getProjects())
    } catch (error) {
      console.error('Error loading projects:', error)
      messageApi.error('Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditingProject(null)
    form.resetFields()
    form.setFieldsValue({ name: '', code: '', program: '', is_active: true })
    setModalVisible(true)
  }

  const handleEdit = (project: Project) => {
    setEditingProject(project)
    // `program` is nullable on the backend but an antd Input needs a string,
    // so null becomes '' going in and blank collapses back to null on save.
    form.setFieldsValue({ ...project, program: project.program ?? '' })
    setModalVisible(true)
  }

  /* Import is create-only and deliberately two-phase: pick a file, see
     exactly what will be created and what will be skipped, then confirm.
     Nothing is written until the confirm, because there is no undo. */
  const handleChooseImportFile = async () => {
    try {
      const path = await pickProjectCsv()
      if (!path) return // cancelled

      const preview = await previewProjectImport(path)
      setImportPreview(preview)
    } catch (error) {
      console.error('Error reading the import file:', error)
      // The backend's messages here are already user-facing prose (a missing
      // file, a CSV without Name/Code headers), so show them rather than a
      // generic failure that would leave the user with nothing to act on.
      messageApi.error(typeof error === 'string' ? error : 'Could not read that CSV')
    }
  }

  const handleConfirmImport = async () => {
    if (!importPreview) return

    try {
      setImporting(true)
      const outcome = await commitProjectImport(importPreview.toCreate)
      messageApi.success(
        `Imported ${outcome.created} project${outcome.created === 1 ? '' : 's'}`
      )
      setImportPreview(null)
      loadProjects()
    } catch (error) {
      console.error('Error importing projects:', error)
      messageApi.error('Failed to import projects')
    } finally {
      setImporting(false)
    }
  }

  const handleDelete = async (project: Project) => {
    try {
      const outcome = await deleteProject(project.id!)
      // A bare "deleted" would hide that time came unmapped and rules went
      // with it — both are things the user needs to know happened.
      const consequences: string[] = []
      if (outcome.eventsUnmapped > 0) {
        consequences.push(
          `${outcome.eventsUnmapped.toLocaleString()} event${outcome.eventsUnmapped === 1 ? '' : 's'} unmapped`
        )
      }
      if (outcome.rulesRemoved > 0) {
        consequences.push(`${outcome.rulesRemoved} rule${outcome.rulesRemoved === 1 ? '' : 's'} removed`)
      }
      messageApi.success(
        consequences.length > 0
          ? `Project deleted — ${consequences.join(', ')}`
          : 'Project deleted'
      )
      loadProjects()
    } catch (error) {
      console.error('Error deleting project:', error)
      messageApi.error('Failed to delete project')
    }
  }

  const handleSave = async () => {
    let values
    try {
      values = await form.validateFields()
    } catch {
      return // antd already marks the invalid fields
    }

    const payload = {
      name: values.name,
      code: values.code,
      program: values.program?.trim() ? values.program.trim() : null,
      is_active: values.is_active ?? true
    }

    try {
      if (editingProject) {
        await updateProject(editingProject.id!, payload)
        messageApi.success('Project updated')
      } else {
        await createProject(payload)
        messageApi.success('Project created')
      }
      setModalVisible(false)
      loadProjects()
    } catch (error) {
      console.error('Error saving project:', error)
      // A duplicate code is the one failure with a message worth showing
      // verbatim; it is already user-facing prose from src/api/projects.ts.
      if (error instanceof DuplicateProjectCodeError) {
        messageApi.error(error.message)
      } else {
        messageApi.error('Failed to save project')
      }
    }
  }

  const columns = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Project) => (
        <Text type={record.is_active ? undefined : 'secondary'}>{text}</Text>
      )
    },
    {
      title: 'Code',
      dataIndex: 'code',
      key: 'code',
      width: 140,
      render: (code: string) => <Text code>{code}</Text>
    },
    {
      title: 'Program',
      dataIndex: 'program',
      key: 'program',
      render: (program: string | null) =>
        program ? <Text>{program}</Text> : <Text type="secondary">—</Text>
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
      render: (_: unknown, record: Project) => (
        <Space>
          <Button
            icon={<EditOutlined />}
            size="small"
            title="Edit"
            aria-label={`Edit ${record.name}`}
            onClick={() => handleEdit(record)}
          />
          <Popconfirm
            title="Delete this project?"
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

  // Name, code and program are all searchable — a code is often what someone
  // actually remembers about a project.
  const term = searchTerm.toLowerCase()
  const filteredProjects = projects.filter(
    project =>
      project.name.toLowerCase().includes(term) ||
      project.code.toLowerCase().includes(term) ||
      (project.program ?? '').toLowerCase().includes(term)
  )

  const shouldShow =
    searchTerm === '' || 'projects'.includes(term) || filteredProjects.length > 0

  if (!shouldShow) return null

  return (
    <Space orientation="vertical" style={{ width: '100%', marginBottom: 16 }}>
      <Flex justify="space-between" align="center">
        <Text strong>Projects</Text>
        <Space>
          <Button icon={<UploadOutlined />} onClick={handleChooseImportFile}>
            Import CSV
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            Add Project
          </Button>
        </Space>
      </Flex>

      <Text type="secondary">
        The projects work is booked against. Inactive projects are kept for history but hidden from
        future pickers.
      </Text>

      <Table
        columns={columns}
        dataSource={filteredProjects}
        loading={loading}
        rowKey="id"
        pagination={false}
        size="small"
      />

      {/* Import preview. Deliberately shows the skips as prominently as the
          creates: the whole reason for a confirm step is that the user can
          see what they are NOT getting before committing. */}
      <Modal
        title="Import projects from CSV"
        open={importPreview !== null}
        onOk={handleConfirmImport}
        onCancel={() => setImportPreview(null)}
        okText={
          importPreview && importPreview.toCreate.length > 0
            ? `Import ${importPreview.toCreate.length} project${importPreview.toCreate.length === 1 ? '' : 's'}`
            : 'Import'
        }
        okButtonProps={{
          disabled: !importPreview || importPreview.toCreate.length === 0,
          loading: importing
        }}
        width={720}
      >
        {importPreview && (
          <Space orientation="vertical" style={{ width: '100%' }} size="middle">
            {importPreview.skipped.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message={`${importPreview.skipped.length} row${importPreview.skipped.length === 1 ? '' : 's'} will be skipped`}
                description={
                  <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                    {importPreview.skipped.map(row => (
                      <div key={row.line} data-testid="skipped-row">
                        <Text type="secondary">
                          Line {row.line}: {row.name || row.code || '(blank)'} — {row.reason}
                        </Text>
                      </div>
                    ))}
                  </div>
                }
              />
            )}

            {importPreview.toCreate.length === 0 ? (
              <Alert
                type="info"
                showIcon
                message="Nothing to import"
                description="Every row in this file was skipped. Existing projects are never changed by an import."
              />
            ) : (
              <>
                <Text>
                  {importPreview.toCreate.length} new project
                  {importPreview.toCreate.length === 1 ? '' : 's'} will be created. Existing
                  projects are never changed.
                </Text>
                <Table
                  columns={[
                    { title: 'Line', dataIndex: 'line', key: 'line', width: 70 },
                    { title: 'Name', dataIndex: 'name', key: 'name' },
                    {
                      title: 'Code',
                      dataIndex: 'code',
                      key: 'code',
                      width: 140,
                      render: (code: string) => <Text code>{code}</Text>
                    },
                    {
                      title: 'Program',
                      dataIndex: 'program',
                      key: 'program',
                      render: (program: string | null) =>
                        program ? <Text>{program}</Text> : <Text type="secondary">—</Text>
                    },
                    {
                      title: 'Active',
                      dataIndex: 'isActive',
                      key: 'isActive',
                      width: 80,
                      render: (isActive: boolean) => (
                        <Text type={isActive ? 'success' : 'secondary'}>
                          {isActive ? 'Yes' : 'No'}
                        </Text>
                      )
                    }
                  ]}
                  dataSource={importPreview.toCreate}
                  rowKey="line"
                  pagination={false}
                  size="small"
                  scroll={{ y: 260 }}
                />
              </>
            )}
          </Space>
        )}
      </Modal>

      <Modal
        title={editingProject ? 'Edit Project' : 'Create Project'}
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
            <Input placeholder="e.g., Website Rebuild" />
          </Form.Item>

          <Form.Item
            label="Code"
            name="code"
            rules={[{ required: true, message: 'Please enter a code' }]}
          >
            <Input placeholder="e.g., PRJ-001" />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: '12px' }}>
            Must be unique. This is how a project is identified.
          </Text>

          <Form.Item label="Program" name="program" style={{ marginTop: 16 }}>
            <Input placeholder="e.g., Platform (optional)" />
          </Form.Item>

          <Form.Item label="Active" name="is_active" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: '12px' }}>
            Inactive projects stay in the list but will not be offered when booking work.
          </Text>
        </Form>
      </Modal>
    </Space>
  )
}

export default ProjectsSettings
