import React, { useState } from 'react'
import { Tabs, Typography, Input, Space } from 'antd'
import { SettingOutlined, AppstoreOutlined, ClockCircleOutlined, SearchOutlined } from '@ant-design/icons'
import MicrosoftGraphSettings from './settings/MicrosoftGraphSettings'
import TimezoneSettings from './settings/TimezoneSettings'

const { Title } = Typography
const { Search } = Input

interface SettingsProps {}

const Settings: React.FC<SettingsProps> = () => {
  const [searchTerm, setSearchTerm] = useState('')

  const tabItems = [
    {
      key: 'general',
      label: (
        <span>
          <SettingOutlined />
          General
        </span>
      ),
      children: (
        <div style={{ maxWidth: '800px' }}>
          <MicrosoftGraphSettings searchTerm={searchTerm} />
          <TimezoneSettings searchTerm={searchTerm} />
        </div>
      ),
    },
    // Future tabs can be added here
    // {
    //   key: 'sync',
    //   label: (
    //     <span>
    //       <SyncOutlined />
    //       Sync
    //     </span>
    //   ),
    //   children: <SyncSettings searchTerm={searchTerm} />,
    // },
  ]

  return (
    <div style={{ padding: '24px', height: '100%', overflow: 'auto' }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Title level={2} style={{ marginBottom: '8px' }}>
            Settings
          </Title>
          <Search
            placeholder="Search settings..."
            prefix={<SearchOutlined />}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ maxWidth: '400px' }}
            allowClear
          />
        </div>
        
        <Tabs
          defaultActiveKey="general"
          items={tabItems}
          tabPosition="top"
          style={{ width: '100%' }}
        />
      </Space>
    </div>
  )
}

export default Settings