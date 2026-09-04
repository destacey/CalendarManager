import React, { useState, useEffect } from 'react'
import { Typography, Space, Button, Table, Modal, Form, Input, Switch, Popconfirm, Flex } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { Project } from '../../types'
import { useMessage } from '../../contexts/MessageContext'
import {
  getProjects,
  createProject,
  updateProject,
  deleteProject,
  DuplicateProjectCodeError
} from '../../api/projects'

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

  const handleDelete = async (project: Project) => {
    try {
      await deleteProject(project.id!)
      messageApi.success('Project deleted')
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
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          Add Project
        </Button>
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
