import React, { useState, useEffect } from 'react'
import { Card, Button, Typography, Space, Statistic, Row, Col, Modal, Alert, Divider } from 'antd'
import { DeleteOutlined, ExclamationCircleOutlined, ReloadOutlined, DatabaseOutlined } from '@ant-design/icons'
import { calendarService } from '../services/calendar'
import { storageService } from '../services/storage'
import { useTheme } from '../contexts/ThemeContext'
import { useMessage } from '../contexts/MessageContext'

const { Title, Text, Paragraph } = Typography

const DataManagement: React.FC = () => {
  const [eventCount, setEventCount] = useState<number>(0)
  const [syncStatus, setSyncStatus] = useState<{ hasMetadata: boolean }>({ hasMetadata: false })
  const [loading, setLoading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearDataModalVisible, setClearDataModalVisible] = useState(false)
  const [clearSyncModalVisible, setClearSyncModalVisible] = useState(false)
  const { antdTheme } = useTheme()
  const messageApi = useMessage()

  useEffect(() => {
    loadEventCount()
    loadSyncStatus()
  }, [])

  const loadEventCount = async () => {
    try {
      setLoading(true)
      const events = await calendarService.getLocalEvents()
      setEventCount(events.length)
    } catch (error) {
      console.error('Error loading event count:', error)
      messageApi.error('Failed to load event count')
    } finally {
      setLoading(false)
    }
  }

  const loadSyncStatus = async () => {
    try {
      const status = await getSyncStatus()
      setSyncStatus(status)
    } catch (error) {
      console.error('Error loading sync status:', error)
    }
  }

  const handleClearAllData = () => {
    setClearDataModalVisible(true)
  }

  const performClearAllData = async () => {
    try {
      setClearing(true)
      setClearDataModalVisible(false)
      
      if (!window.electronAPI) {
        throw new Error('Electron API not available')
      }

      // Since deleteAllEvents might not be implemented yet, 
      // we'll use the existing API to delete events one by one
      const events = await window.electronAPI.getEvents()
      let deletedCount = 0
      
      for (const event of events) {
        if (event.id) {
          const success = await window.electronAPI.deleteEvent(event.id)
          if (success) {
            deletedCount++
          }
        }
      }
      
      // Clear sync metadata since data is no longer in sync
      storageService.setSyncMetadata({
        deltaToken: undefined,
        lastEventModified: undefined
      })
      
      messageApi.success(`Successfully deleted ${deletedCount} calendar events and reset sync data`)
      await loadEventCount() // Refresh count
      await loadSyncStatus() // Refresh sync status
      
    } catch (error) {
      console.error('Error clearing calendar data:', error)
      messageApi.error('Failed to clear calendar data')
    } finally {
      setClearing(false)
    }
  }

  const handleClearSyncData = () => {
    setClearSyncModalVisible(true)
  }

  const performClearSyncData = async () => {
    try {
      setClearSyncModalVisible(false)
      
      // Clear sync metadata
      storageService.setSyncMetadata({
        deltaToken: undefined,
        lastEventModified: undefined
      })
      
      messageApi.success('Sync metadata cleared successfully')
      await loadSyncStatus() // Refresh sync status
      
    } catch (error) {
      console.error('Error clearing sync data:', error)
      messageApi.error('Failed to clear sync data')
    }
  }

  const getSyncStatus = async () => {
    const metadata = await storageService.getSyncMetadata()
    return {
      hasMetadata: !!(metadata?.deltaToken || metadata?.lastEventModified)
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <Title level={4}>
          <DatabaseOutlined style={{ marginRight: 8 }} />
          Data Overview
        </Title>
        
        <Row gutter={24}>
          <Col span={12}>
            <Statistic 
              title="Calendar Events" 
              value={eventCount} 
              loading={loading}
              suffix="events"
            />
          </Col>
          <Col span={12}>
            <Statistic 
              title="Sync Status" 
              value={syncStatus.hasMetadata ? 'Configured' : 'Not Set Up'} 
              valueStyle={{ color: syncStatus.hasMetadata ? '#3f8600' : '#cf1322' }}
            />
          </Col>
        </Row>

        <Button 
          icon={<ReloadOutlined />} 
          onClick={() => { loadEventCount(); loadSyncStatus(); }}
          loading={loading}
          style={{ marginTop: 16 }}
        >
          Refresh Stats
        </Button>
      </Card>

      <Card>
        <Title level={4} type="danger">
          <DeleteOutlined style={{ marginRight: 8 }} />
          Data Management
        </Title>
        
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Title level={5}>Clear All Calendar Events</Title>
            <Paragraph type="secondary">
              Permanently delete all calendar events from the local database. 
              You can re-sync from Microsoft Graph to restore your data.
            </Paragraph>
            <Button 
              danger
              icon={<DeleteOutlined />}
              onClick={handleClearAllData}
              loading={clearing}
              disabled={eventCount === 0}
            >
              Clear All Calendar Data ({eventCount} events)
            </Button>
          </div>

          <Divider />

          <div>
            <Title level={5}>Clear Sync Metadata</Title>
            <Paragraph type="secondary">
              Reset sync history and tokens. This will force a full sync next time, 
              but won't delete your existing calendar events.
            </Paragraph>
            <Button 
              icon={<DeleteOutlined />}
              onClick={handleClearSyncData}
              disabled={!syncStatus.hasMetadata}
            >
              Clear Sync Data
            </Button>
          </div>
        </Space>
      </Card>

      {/* Clear All Data Modal */}
      <Modal
        title={
          <span>
            <ExclamationCircleOutlined style={{ color: '#ff4d4f', marginRight: 8 }} />
            Clear All Calendar Data
          </span>
        }
        open={clearDataModalVisible}
        onCancel={() => setClearDataModalVisible(false)}
        onOk={performClearAllData}
        okText="Yes, Clear All Data"
        okType="danger"
        cancelText="Cancel"
        confirmLoading={clearing}
        width={500}
      >
        <Paragraph>
          This will permanently delete all calendar events from your local database. 
          This action cannot be undone.
        </Paragraph>
        <Alert
          message="Warning"
          description="You will need to sync again from Microsoft Graph to restore your calendar data."
          type="warning"
          showIcon
          style={{ marginTop: 16 }}
        />
      </Modal>

      {/* Clear Sync Data Modal */}
      <Modal
        title={
          <span>
            <ExclamationCircleOutlined style={{ color: '#1890ff', marginRight: 8 }} />
            Clear Sync Metadata
          </span>
        }
        open={clearSyncModalVisible}
        onCancel={() => setClearSyncModalVisible(false)}
        onOk={performClearSyncData}
        okText="Yes, Clear Sync Data"
        cancelText="Cancel"
        width={500}
      >
        <Paragraph>
          This will clear your sync history and settings. Your calendar events will remain, 
          but the next sync will be treated as a first-time sync.
        </Paragraph>
        <Alert
          message="Info"
          description="This will reset sync tokens and force a full sync next time."
          type="info"
          showIcon
          style={{ marginTop: 16 }}
        />
      </Modal>
    </Space>
  )
}

export default DataManagement