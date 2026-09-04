import React, { useState, useEffect } from 'react'
import { Modal, Button, Card, Typography, Spin, Alert, Statistic, Row, Col, DatePicker, Form } from 'antd'
import { StopOutlined, CheckCircleOutlined, ExclamationCircleOutlined, SettingOutlined } from '@ant-design/icons'
import {
  startSync,
  cancelSync,
  getSyncStatus,
  getCurrentSyncConfig,
  getDefaultSyncConfig,
  setSyncConfig,
  onSyncStatus,
  onSyncComplete,
  SyncConfig,
  SyncResult,
} from '../services/calendar'
import type { SyncStatus } from '../api/sync'
import dayjs from 'dayjs'

const { Title, Text } = Typography

interface SyncModalProps {
  visible: boolean
  onClose: () => void
}

const SyncModal: React.FC<SyncModalProps> = ({ visible, onClose }) => {
  const [isSyncing, setIsSyncing] = useState(false)
  const [canSync, setCanSync] = useState(true)
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [lastResult, setLastResult] = useState<SyncResult | null>(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [customSyncConfig, setCustomSyncConfig] = useState<SyncConfig | null>(null)

  // Form instance - always create but only use when visible
  const [form] = Form.useForm()

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    if (!visible) return

    let cancelled = false

    getSyncStatus().then((status) => {
      if (cancelled) return
      setIsSyncing(status.isActive)
      setCanSync(status.canSync)
    }).catch((error) => console.warn('Could not read sync status:', error))

    const initializeForm = async () => {
      try {
        const currentConfig = await getCurrentSyncConfig()
        form.setFieldsValue({
          startDate: dayjs(currentConfig.startDate),
          endDate: dayjs(currentConfig.endDate),
        })
        if (!cancelled) setCustomSyncConfig(currentConfig)
      } catch (error) {
        console.error('Error loading sync config:', error)
        const defaultConfig = getDefaultSyncConfig()
        form.setFieldsValue({
          startDate: dayjs(defaultConfig.startDate),
          endDate: dayjs(defaultConfig.endDate),
        })
        if (!cancelled) setCustomSyncConfig(defaultConfig)
      }
    }
    initializeForm()

    let unlistenStatus: (() => void) | undefined
    let unlistenComplete: (() => void) | undefined

    onSyncStatus((status) => {
      if (cancelled) return
      setIsSyncing(true)
      setSyncStatus(status)
    }).then((unlisten) => {
      if (cancelled) unlisten()
      else unlistenStatus = unlisten
    })

    onSyncComplete((result) => {
      if (cancelled) return
      setIsSyncing(false)
      setSyncStatus(null)
      setLastResult(result)
      getSyncStatus().then((status) => setCanSync(status.canSync)).catch(() => {})
    }).then((unlisten) => {
      if (cancelled) unlisten()
      else unlistenComplete = unlisten
    })

    return () => {
      cancelled = true
      unlistenStatus?.()
      unlistenComplete?.()
    }
  }, [visible, form])

  const handleSync = async () => {
    if (!isOnline || isSyncing || !canSync) return

    setLastResult(null)

    if (customSyncConfig) {
      try {
        await setSyncConfig(customSyncConfig)
      } catch (error) {
        console.error('Invalid sync config:', error)
        return
      }
    }

    try {
      await startSync()
      setIsSyncing(true)
    } catch (error) {
      console.error('Sync start error:', error)
    }
  }

  const handleConfigChange = (changedFields: any) => {
    const processedFields: any = {}
    if (changedFields.startDate) {
      processedFields.startDate = changedFields.startDate.format('YYYY-MM-DD')
    }
    if (changedFields.endDate) {
      processedFields.endDate = changedFields.endDate.format('YYYY-MM-DD')
    }
    const currentConfig = customSyncConfig || getDefaultSyncConfig()
    setCustomSyncConfig({ ...currentConfig, ...processedFields })
  }

  const handleCancelSync = () => {
    cancelSync().catch((error) => console.error('Cancel sync error:', error))
  }

  const renderSyncOptions = () => (
    <div>
      <Card
        title={
          <span>
            <SettingOutlined style={{ marginRight: 8 }} />
            Sync Date Range
            {customSyncConfig && (
              <Text type="secondary" style={{ marginLeft: 8 }}>
                ({dayjs(customSyncConfig.startDate).format('MMM D')} - {dayjs(customSyncConfig.endDate).format('MMM D, YYYY')})
              </Text>
            )}
          </span>
        }
        size="small"
        style={{ marginBottom: 16 }}
      >
        <Form form={form} layout="vertical" onValuesChange={handleConfigChange} size="small">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Start Date" name="startDate" rules={[{ required: true, message: 'Required' }]}>
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="End Date" name="endDate" rules={[{ required: true, message: 'Required' }]}>
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
          </Row>
          <Text type="secondary" style={{ fontSize: '11px' }}>
            Total range: {customSyncConfig?.startDate && customSyncConfig?.endDate ?
              dayjs(customSyncConfig.endDate).diff(dayjs(customSyncConfig.startDate), 'days') + 1 : 0} days
          </Text>
        </Form>
      </Card>

      <Button type="primary" size="large" onClick={handleSync} disabled={!isOnline || !canSync} block>
        Sync Calendar
      </Button>
      <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '4px', textAlign: 'center' }}>
        Downloads all events in your configured date range from Microsoft Graph.
      </Text>

      {!isOnline && (
        <Alert
          title="Offline"
          description="You're currently offline. Sync options will be available when you reconnect to the internet."
          type="warning"
          style={{ marginTop: 16 }}
          showIcon
        />
      )}
    </div>
  )

  // Deliberately modest: the old progress bar jumped 0% straight to 100%
  // (fetched is the only count the backend can report mid-sync — there's no
  // known total until the last page arrives) and its four stage icons all
  // rendered the same spinner. This just says what's true: a spinner, the
  // running count, the phase, and a way to stop.
  const renderSyncProgress = () => (
    <div style={{ textAlign: 'center', padding: '24px 0' }}>
      <Spin size="large" />
      <Title level={4} style={{ marginTop: 16 }}>
        {syncStatus ? `${syncStatus.fetched} events fetched…` : 'Starting sync…'}
      </Title>
      {syncStatus && <Text type="secondary">{syncStatus.phase}</Text>}
      <div style={{ marginTop: 24 }}>
        <Button danger icon={<StopOutlined />} onClick={handleCancelSync}>
          Cancel
        </Button>
      </div>
    </div>
  )

  const renderSyncResult = () => {
    if (!lastResult) return null
    return (
      <div>
        <Title level={4}>Sync Complete</Title>
        <Alert
          title={lastResult.success ? 'Sync Successful' : 'Sync Failed'}
          description={lastResult.message}
          type={lastResult.success ? 'success' : 'error'}
          icon={lastResult.success ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
          style={{ marginBottom: 16 }}
          showIcon
        />

        {lastResult.success && (
          <Card title="Sync Results" size="small">
            <Row gutter={16}>
              <Col span={6}>
                <Statistic title="Created" value={lastResult.stats.created} styles={{ content: { color: '#3f8600' } }} />
              </Col>
              <Col span={6}>
                <Statistic title="Updated" value={lastResult.stats.updated} styles={{ content: { color: '#1890ff' } }} />
              </Col>
              <Col span={6}>
                <Statistic title="Deleted" value={lastResult.stats.deleted} styles={{ content: { color: '#cf1322' } }} />
              </Col>
              <Col span={6}>
                <Statistic title="Total" value={lastResult.stats.total} />
              </Col>
            </Row>
          </Card>
        )}

        {lastResult.errors && lastResult.errors.length > 0 && (
          <Card title="Errors" size="small" style={{ marginTop: 16 }}>
            {lastResult.errors.map((error, index) => (
              <Text key={index} type="danger" style={{ display: 'block' }}>
                {error}
              </Text>
            ))}
          </Card>
        )}

        <Button type="primary" onClick={() => setLastResult(null)} style={{ marginTop: 16 }} block>
          Start New Sync
        </Button>
      </div>
    )
  }

  const getModalContent = () => {
    if (lastResult) return renderSyncResult()
    if (isSyncing) return renderSyncProgress()
    return renderSyncOptions()
  }

  if (!visible) {
    return null
  }

  return (
    <Modal
      title="Calendar Synchronization"
      open={visible}
      onCancel={onClose}
      footer={null}
      width={500}
      destroyOnHidden={true}
    >
      {getModalContent()}
    </Modal>
  )
}

export default SyncModal
