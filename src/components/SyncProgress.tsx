import React from 'react'
import { Progress, Tooltip, Button, Space, Flex } from 'antd'
import { LoadingOutlined, CloseOutlined } from '@ant-design/icons'
import { SyncProgress as SyncProgressType } from '../services/calendar'

interface SyncProgressProps {
  progress: SyncProgressType
  onCancel?: () => void
  compact?: boolean
}

const SyncProgress: React.FC<SyncProgressProps> = ({ 
  progress, 
  onCancel, 
  compact = false 
}) => {
  const getStageIcon = (stage: string) => {
    switch (stage) {
      case 'fetching':
        return <LoadingOutlined spin />
      case 'processing':
        return <LoadingOutlined spin />
      case 'saving':
        return <LoadingOutlined spin />
      case 'cleaning':
        return <LoadingOutlined spin />
      default:
        return <LoadingOutlined spin />
    }
  }

  const getStageColor = (stage: string) => {
    switch (stage) {
      case 'fetching':
        return '#1890ff'
      case 'processing':
        return '#faad14'
      case 'saving':
        return '#52c41a'
      case 'cleaning':
        return '#722ed1'
      default:
        return '#1890ff'
    }
  }

  const progressPercent = progress.total > 0 
    ? Math.round((progress.completed / progress.total) * 100)
    : 0

  if (compact) {
    return (
      <Flex 
        align="center" 
        gap={8}
        style={{ minWidth: '200px' }}
      >
        <Tooltip title={progress.message}>
          <Flex align="center" gap={4}>
            {getStageIcon(progress.stage)}
            <span style={{ fontSize: '12px', color: '#666' }}>
              {progress.total > 0 ? `${progress.completed}/${progress.total}` : 'Syncing...'}
            </span>
          </Flex>
        </Tooltip>
        
        {progress.total > 0 && (
          <Progress
            percent={progressPercent}
            size="small"
            strokeColor={getStageColor(progress.stage)}
            style={{ flex: 1, minWidth: '80px' }}
            showInfo={false}
          />
        )}
        
        {onCancel && (
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={onCancel}
            style={{ width: '20px', height: '20px', minWidth: '20px' }}
            title="Cancel sync"
          />
        )}
      </Flex>
    )
  }

  return (
    <div style={{ width: '100%', maxWidth: '400px' }}>
      <Flex 
        justify="space-between" 
        align="center"
        style={{ marginBottom: '8px' }}
      >
        <Space>
          {getStageIcon(progress.stage)}
          <span style={{ fontWeight: 500 }}>
            {progress.message}
          </span>
        </Space>
        
        {onCancel && (
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={onCancel}
            title="Cancel sync"
          >
            Cancel
          </Button>
        )}
      </Flex>
      
      {progress.total > 0 && (
        <>
          <Progress
            percent={progressPercent}
            strokeColor={getStageColor(progress.stage)}
            format={(percent) => `${progress.completed} of ${progress.total}`}
          />
          <Flex 
            justify="space-between"
            style={{ 
              fontSize: '12px',
              color: '#666',
              marginTop: '4px'
            }}
          >
            <span>Progress: {progressPercent}%</span>
            <span>Stage: {progress.stage}</span>
          </Flex>
        </>
      )}
    </div>
  )
}

export default SyncProgress