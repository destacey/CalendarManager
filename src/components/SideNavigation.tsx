import React from 'react'
import { Layout, Menu } from 'antd'
import { HomeOutlined, CalendarOutlined, SettingOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { useTheme } from '../contexts/ThemeContext'

const { Sider } = Layout

interface SideNavigationProps {
  collapsed: boolean
  selectedKey?: string
  onMenuSelect?: (key: string) => void
}

type MenuItem = Required<MenuProps>['items'][number]

const menuItems: MenuItem[] = [
  {
    key: 'home',
    icon: <HomeOutlined />,
    label: 'Home',
  },
  {
    key: 'calendar',
    icon: <CalendarOutlined />,
    label: 'Calendar',
  },
  {
    key: 'settings',
    icon: <SettingOutlined />,
    label: 'Settings',
  },
]

const SideNavigation: React.FC<SideNavigationProps> = ({
  collapsed,
  selectedKey = 'home',
  onMenuSelect
}) => {
  const { themeMode } = useTheme()
  
  const handleMenuClick = ({ key }: { key: string }) => {
    onMenuSelect?.(key)
  }

  const sideNavColors = {
    background: themeMode === 'dark' ? '#141414' : '#fff',
    border: themeMode === 'dark' ? '#434343' : '#f0f0f0'
  }

  return (
    <Sider
      collapsed={collapsed}
      style={{
        background: sideNavColors.background,
        borderRight: `1px solid ${sideNavColors.border}`,
        height: 'calc(100vh - 32px)',
        position: 'fixed',
        left: 0,
        top: '32px',
        zIndex: 100,
      }}
      width={200}
      collapsedWidth={50}
      collapsible={false}
    >
      <Menu
        mode="inline"
        selectedKeys={[selectedKey]}
        items={menuItems}
        onClick={handleMenuClick}
        style={{ 
          borderRight: 0,
          height: '100%',
          overflow: 'auto'
        }}
      />
    </Sider>
  )
}

export default SideNavigation