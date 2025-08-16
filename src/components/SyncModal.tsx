import React, { useState, useEffect } from 'react'
import { Modal, Button, Space, Card, Typography, Progress, Alert, Divider, Statistic, Row, Col, DatePicker, Form } from 'antd'
import { SyncOutlined, CloudOutlined, StopOutlined, CheckCircleOutlined, ExclamationCircleOutlined, SettingOutlined } from '@ant-design/icons'
import { calendarService, SyncProgress, SyncResult, SyncConfig } from '../services/calendar'
import SyncProgressComponent from './SyncProgress'
import dayjs from 'dayjs'

const { Title, Text } = Typography

interface SyncModalProps {
  visible: boolean
  onClose: () => void
}

const SyncModal: React.FC<SyncModalProps> = ({ visible, onClose }) => {
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null)
  const [lastResult, setLastResult] = useState<SyncResult | null>(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [customSyncConfig, setCustomSyncConfig] = useState<SyncConfig | null>(null)
  const [syncStatus, setSyncStatus] = useState(calendarService.getSyncStatus())
  
  // Form instance - always create but only use when visible
  const [form] = Form.useForm()

  useEffect(() => {
    // Set up online/offline detection
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Set up sync callbacks when modal is open
    if (visible) {
      // Refresh sync status when modal opens
      setSyncStatus(calendarService.getSyncStatus())
      
      calendarService.setSyncCallbacks(
        (progress) => setSyncProgress(progress),
        (result) => {
          setSyncProgress(null)
          setLastResult(result)
          // Refresh sync status after sync completes
          setSyncStatus(calendarService.getSyncStatus())
        }
      )
      
      // Initialize form with current sync config
      const currentConfig = calendarService.getCurrentSyncConfig()
      if (form) {
        form.setFieldsValue({
          startDate: dayjs(currentConfig.startDate),
          endDate: dayjs(currentConfig.endDate)
        })
      }
      setCustomSyncConfig(currentConfig)
    }

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [visible])

  const handleSync = async (forceFullSync = false) => {
    if (!isOnline) {
      return
    }

    if (calendarService.isSyncing()) {
      return
    }

    setLastResult(null)
    
    // Save custom sync config if it has been modified
    if (customSyncConfig) {
      try {
        calendarService.setSyncConfig(customSyncConfig)
      } catch (error) {
        console.error('Invalid sync config:', error)
        return
      }
    }
    
    try {
      await calendarService.syncEvents(forceFullSync)
    } catch (error) {
      console.error('Sync start error:', error)
    }
  }

  const handleConfigChange = (changedFields: any) => {
    // Convert dayjs objects to date strings
    const processedFields: any = {}
    if (changedFields.startDate) {
      processedFields.startDate = changedFields.startDate.format('YYYY-MM-DD')
    }
    if (changedFields.endDate) {
      processedFields.endDate = changedFields.endDate.format('YYYY-MM-DD')
    }
    
    const newConfig = { ...customSyncConfig, ...processedFields }
    setCustomSyncConfig(newConfig)
  }

  const handleCancelSync = () => {
    calendarService.cancelSync()
    setSyncProgress(null)
  }

  const renderSyncOptions = () => {
    return (
      <div>
        {/* Status Information */}
        <Card size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Statistic 
                title="Connection" 
                value={isOnline ? 'Online' : 'Offline'} 
                valueStyle={{ color: isOnline ? '#3f8600' : '#cf1322' }}
              />
            </Col>
            <Col span={12}>
              <Statistic 
                title="Last Sync" 
                value={syncStatus.lastSync ? dayjs(syncStatus.lastSync).format('MMM D, HH:mm') : 'Never'} 
              />
            </Col>
          </Row>
        </Card>

        {/* Date Range Configuration */}
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
          <Form
            form={form}
            layout="vertical"
            onValuesChange={handleConfigChange}
            size="small"
          >
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label="Start Date"
                  name="startDate"
                  rules={[
                    { required: true, message: 'Required' }
                  ]}
                >
                  <DatePicker
                    style={{ width: '100%' }}
                    format="YYYY-MM-DD"
                    value={customSyncConfig?.startDate ? dayjs(customSyncConfig.startDate) : null}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="End Date"
                  name="endDate"
                  rules={[
                    { required: true, message: 'Required' }
                  ]}
                >
                  <DatePicker
                    style={{ width: '100%' }}
                    format="YYYY-MM-DD"
                    value={customSyncConfig?.endDate ? dayjs(customSyncConfig.endDate) : null}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Text type="secondary" style={{ fontSize: '11px' }}>
              Total range: {customSyncConfig?.startDate && customSyncConfig?.endDate ? 
                dayjs(customSyncConfig.endDate).diff(dayjs(customSyncConfig.startDate), 'days') + 1 : 0} days
            </Text>
          </Form>
        </Card>

        {/* Sync Options */}
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {/* Show Quick Sync only if user has synced before */}
          {syncStatus.lastSync && (
            <div>
              <Button
                type="primary"
                size="large"
                onClick={() => handleSync(false)}
                disabled={!isOnline}
                block
              >
                Quick Sync (Changes Only)
              </Button>
              <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '4px', textAlign: 'center' }}>
                Syncs only events that have changed since your last sync. Fast and efficient.
              </Text>
            </div>
          )}

          <div>
            <Button
              type={syncStatus.lastSync ? undefined : "primary"}
              size="large"
              onClick={() => handleSync(true)}
              disabled={!isOnline}
              block
            >
              {syncStatus.lastSync ? "Full Sync (All Events)" : "Sync Calendar"}
            </Button>
            <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '4px', textAlign: 'center' }}>
              {syncStatus.lastSync 
                ? "Downloads all events in your configured date range. Use if you're having sync issues."
                : "Download your calendar events from Microsoft Graph for the first time."
              }
            </Text>
          </div>
        </Space>

        {!isOnline && (
          <Alert
            message="Offline"
            description="You're currently offline. Sync options will be available when you reconnect to the internet."
            type="warning"
            style={{ marginTop: 16 }}
            showIcon
          />
        )}
      </div>
    )
  }

  const renderSyncProgress = () => {
    if (!syncProgress) return null

    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Title level={4} style={{ margin: 0 }}>Syncing Calendar</Title>
          <Button
            danger
            icon={<StopOutlined />}
            onClick={handleCancelSync}
          >
            Cancel
          </Button>
        </div>

        <Card>
          <SyncProgressComponent 
            progress={syncProgress} 
            onCancel={handleCancelSync}
            compact={false}
          />
        </Card>

        <Alert
          message="Sync in Progress"
          description="You can continue using the app while the sync runs in the background. This modal will update with the results when complete."
          type="info"
          style={{ marginTop: 16 }}
          showIcon
        />
      </div>
    )
  }

  const renderSyncResult = () => {
    if (!lastResult) return null

    return (
      <div>
        <Title level={4}>Sync Complete</Title>
        
        <Alert
          message={lastResult.success ? "Sync Successful" : "Sync Failed"}
          description={lastResult.message}
          type={lastResult.success ? "success" : "error"}
          icon={lastResult.success ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
          style={{ marginBottom: 16 }}
          showIcon
        />

        {lastResult.success && (
          <Card title={`${lastResult.mode === 'differential' ? 'Differential' : 'Full'} Sync Results`} size="small">
            <Row gutter={16}>
              <Col span={6}>
                <Statistic title="Created" value={lastResult.stats.created} valueStyle={{ color: '#3f8600' }} />
              </Col>
              <Col span={6}>
                <Statistic title="Updated" value={lastResult.stats.updated} valueStyle={{ color: '#1890ff' }} />
              </Col>
              <Col span={6}>
                <Statistic title="Deleted" value={lastResult.stats.deleted} valueStyle={{ color: '#cf1322' }} />
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

        <Button
          type="primary"
          onClick={() => setLastResult(null)}
          style={{ marginTop: 16 }}
          block
        >
          Start New Sync
        </Button>
      </div>
    )
  }

  const getModalContent = () => {
    if (lastResult) {
      return renderSyncResult()
    } else if (syncProgress) {
      return renderSyncProgress()
    } else {
      return renderSyncOptions()
    }
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