import React from 'react'
import { ConfigProvider, Layout, theme } from 'antd'
import CalendarView from './components/CalendarView'
import './App.css'

const { Header, Content } = Layout

function App() {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1890ff',
        },
      }}
    >
      <Layout style={{ minHeight: '100vh' }}>
        <Header style={{ 
          display: 'flex', 
          alignItems: 'center',
          background: '#fff',
          borderBottom: '1px solid #d9d9d9'
        }}>
          <h1 style={{ margin: 0, color: '#1890ff' }}>Calendar Manager</h1>
        </Header>
        <Content style={{ padding: '24px' }}>
          <CalendarView />
        </Content>
      </Layout>
    </ConfigProvider>
  )
}

export default App