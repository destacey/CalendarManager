import React, { useState, useEffect } from 'react'
import { Card, Input, Typography, Space, Alert, Button } from 'antd'
import { AppstoreOutlined, CheckOutlined, CopyOutlined } from '@ant-design/icons'
import { storageService } from '../../services/storage'

const { Title, Text, Paragraph } = Typography

interface MicrosoftGraphSettingsProps {
  searchTerm?: string
}

const MicrosoftGraphSettings: React.FC<MicrosoftGraphSettingsProps> = ({ searchTerm = '' }) => {
  const [clientId, setClientId] = useState<string>('')
  const [storedClientId, setStoredClientId] = useState<string>('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadClientId = async () => {
      try {
        setLoading(true)
        const appRegistrationId = await storageService.getAppRegistrationId()
        const id = appRegistrationId || ''
        setClientId(id)
        setStoredClientId(id)
      } catch (error) {
        console.error('Error loading client ID:', error)
      } finally {
        setLoading(false)
      }
    }
    loadClientId()
  }, [])

  const handleClientIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setClientId(e.target.value)
    setSaved(false)
  }

  const handleSave = async () => {
    try {
      await storageService.setAppRegistrationId(clientId)
      setStoredClientId(clientId)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (error) {
      console.error('Error saving client ID:', error)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(clientId)
  }

  const hasUnsavedChanges = clientId !== storedClientId

  // Filter based on search term
  const isVisible = !searchTerm || 
    'client id microsoft graph application registration'.toLowerCase().includes(searchTerm.toLowerCase()) ||
    clientId.toLowerCase().includes(searchTerm.toLowerCase())

  if (!isVisible) return null

  return (
    <div style={{ marginBottom: '32px' }}>
      <Title level={4} style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
        <AppstoreOutlined style={{ marginRight: '8px' }} />
        Microsoft Graph
      </Title>
      
      <Card size="small" style={{ marginBottom: '16px' }}>
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Text strong>Application Registration ID</Text>
            <Paragraph type="secondary" style={{ marginBottom: '8px', marginTop: '4px' }}>
              The Client ID from your Microsoft Azure App Registration. This is used to authenticate with Microsoft Graph API for calendar access.
            </Paragraph>
            <Space.Compact style={{ display: 'flex', width: '100%' }}>
              <Input
                value={clientId}
                onChange={handleClientIdChange}
                placeholder="Enter your Microsoft Graph Client ID..."
                style={{ flex: 1 }}
                disabled={loading}
              />
              {clientId && (
                <Button 
                  icon={<CopyOutlined />} 
                  onClick={handleCopy}
                  title="Copy to clipboard"
                />
              )}
            </Space.Compact>
          </div>

          {hasUnsavedChanges && (
            <Button
              type="primary"
              icon={saved ? <CheckOutlined /> : undefined}
              onClick={handleSave}
              disabled={saved || !clientId.trim()}
              size="small"
              style={{ alignSelf: 'flex-end' }}
            >
              {saved ? 'Saved!' : 'Save Changes'}
            </Button>
          )}

          {saved && (
            <Alert
              title="Client ID updated successfully!"
              description="You may need to restart the application for changes to take effect."
              type="success"
              showIcon
              closable
            />
          )}
        </Space>
      </Card>
    </div>
  )
}

export default MicrosoftGraphSettings