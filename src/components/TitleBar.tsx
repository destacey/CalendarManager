import React, { useState, useEffect } from 'react';
import { Button, Space, Tooltip, Dropdown, MenuProps, Flex, Typography } from 'antd';
import { MinusOutlined, BorderOutlined, CloseOutlined, BlockOutlined, MenuFoldOutlined, MenuUnfoldOutlined, CloudSyncOutlined, MenuOutlined, HomeOutlined, CalendarOutlined, SettingOutlined } from '@ant-design/icons';
import UserMenu from './UserMenu';
import SyncProgress from './SyncProgress';
import SyncModal from './SyncModal';
import { useTheme } from '../contexts/ThemeContext';
import { calendarService, SyncProgress as SyncProgressType } from '../services/calendar';

interface TitleBarProps {
  showUserMenu?: boolean;
  onLogout?: () => void;
  showMenuToggle?: boolean;
  onMenuToggle?: () => void;
  sideNavCollapsed?: boolean;
  isMobile?: boolean;
  selectedNavKey?: string;
  onNavSelect?: (key: string) => void;
  onDataManagement?: () => void;
}

const { Text } = Typography

const TitleBar: React.FC<TitleBarProps> = ({ 
  showUserMenu = false, 
  onLogout, 
  showMenuToggle = false, 
  onMenuToggle,
  sideNavCollapsed = false,
  isMobile = false,
  selectedNavKey = 'home',
  onNavSelect,
  onDataManagement
}) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgressType | null>(null);
  const [syncModalVisible, setSyncModalVisible] = useState(false);
  const [modalKey, setModalKey] = useState(Date.now());
  const { themeMode } = useTheme();

  useEffect(() => {
    // Check initial window state
    const checkWindowState = async () => {
      if (window.electronAPI) {
        try {
          const maximized = await window.electronAPI.isWindowMaximized();
          setIsMaximized(maximized);
        } catch (error) {
          console.warn('Could not get window state:', error);
        }
      }
    };

    checkWindowState();

    // Listen for window state changes
    const handleWindowStateChange = (event: any, maximized: boolean) => {
      setIsMaximized(maximized);
    };

    if (window.electronAPI?.onWindowStateChange) {
      window.electronAPI.onWindowStateChange(handleWindowStateChange);
    }

    // Set up sync progress tracking
    calendarService.setSyncCallbacks(
      (progress) => setSyncProgress(progress),
      () => setSyncProgress(null)
    );

    return () => {
      if (window.electronAPI?.removeAllListeners) {
        window.electronAPI.removeAllListeners('window-state-change');
      }
      // Clean up sync callbacks
      calendarService.setSyncCallbacks();
    };
  }, []);

  const handleMinimize = () => {
    if (window.electronAPI) {
      window.electronAPI.minimizeWindow();
    }
  };

  const handleMaximize = () => {
    if (window.electronAPI) {
      window.electronAPI.maximizeWindow();
      // Toggle the state immediately for responsive UI
      setIsMaximized(!isMaximized);
    }
  };

  const handleClose = () => {
    if (window.electronAPI) {
      window.electronAPI.closeWindow();
    }
  };

  const handleCancelSync = () => {
    calendarService.cancelSync();
    setSyncProgress(null);
  };

  const handleSyncButtonClick = () => {
    setModalKey(Date.now()); // Force re-render with new key
    setSyncModalVisible(true);
  };

  const handleProgressClick = () => {
    setModalKey(Date.now()); // Force re-render with new key
    setSyncModalVisible(true);
  };

  const titleBarColors = {
    background: themeMode === 'dark' ? '#141414' : '#f5f5f5',
    border: themeMode === 'dark' ? '#434343' : '#d9d9d9',
    text: themeMode === 'dark' ? 'rgba(255, 255, 255, 0.85)' : '#666',
    buttonText: themeMode === 'dark' ? 'rgba(255, 255, 255, 0.65)' : '#666'
  };

  const mobileMenuItems: MenuProps['items'] = [
    {
      key: 'home',
      label: 'Home',
      icon: <HomeOutlined />,
    },
    {
      key: 'calendar',
      label: 'Calendar',
      icon: <CalendarOutlined />,
    },
    {
      key: 'settings',
      label: 'Settings',
      icon: <SettingOutlined />,
    },
  ];

  const handleMobileMenuClick = ({ key }: { key: string }) => {
    onNavSelect?.(key);
  };

  return (
    <Flex
      justify="space-between"
      align="center"
      style={{
        height: '32px',
        background: titleBarColors.background,
        padding: '0 12px',
        borderBottom: `1px solid ${titleBarColors.border}`,
        WebkitAppRegion: 'drag',
        userSelect: 'none',
      }}
    >
      <Flex align="center" gap={12}>
        {isMobile ? (
          <Dropdown
            menu={{
              items: mobileMenuItems,
              onClick: handleMobileMenuClick,
              selectedKeys: [selectedNavKey]
            }}
            trigger={['click']}
            placement="bottomLeft"
          >
            <Button
              type="text"
              size="small"
              icon={<MenuOutlined style={{ fontSize: '14px' }} />}
              style={{ 
                WebkitAppRegion: 'no-drag',
                color: titleBarColors.buttonText,
                border: 'none'
              }}
              title="Navigation menu"
            />
          </Dropdown>
        ) : showMenuToggle && (
          <Button
            type="text"
            size="small"
            icon={sideNavCollapsed ? 
              <MenuUnfoldOutlined style={{ fontSize: '14px' }} /> : 
              <MenuFoldOutlined style={{ fontSize: '14px' }} />
            }
            onClick={onMenuToggle}
            style={{ 
              WebkitAppRegion: 'no-drag',
              color: titleBarColors.buttonText,
              border: 'none'
            }}
            title={sideNavCollapsed ? 'Expand menu' : 'Collapse menu'}
          />
        )}
        <Text style={{ fontSize: '14px', fontWeight: 500, color: titleBarColors.text }}>
          {isMobile ? 'CM' : 'Calendar Manager'}
        </Text>
        
      </Flex>
      
      {/* Sync section in the middle */}
      <Flex 
        justify="center"
        align="center"
        style={{ 
          flex: 1, 
          WebkitAppRegion: 'no-drag',
          maxWidth: '300px'
        }}
      >
        {syncProgress ? (
          <div 
            onClick={handleProgressClick}
            style={{ cursor: 'pointer', width: '100%' }}
          >
            <SyncProgress 
              progress={syncProgress} 
              onCancel={handleCancelSync}
              compact={true}
            />
          </div>
        ) : (
          <Tooltip title="Open sync options">
            <Button
              type="text"
              icon={<CloudSyncOutlined />}
              onClick={handleSyncButtonClick}
              style={{
                color: titleBarColors.buttonText,
                border: 'none'
              }}
            />
          </Tooltip>
        )}
      </Flex>
      
      <Flex align="center" style={{ WebkitAppRegion: 'no-drag' }}>
        <Space size={8}>
          {showUserMenu && onLogout && (
            <div style={{ marginRight: '8px' }}>
              <UserMenu onLogout={onLogout} showName={!isMobile} onDataManagement={onDataManagement} />
            </div>
          )}
          <Space size={0}>
            <Button
              type="text"
              size="small"
              icon={<MinusOutlined style={{ fontSize: '12px' }} />}
              onClick={handleMinimize}
              style={{ 
                width: '32px', 
                height: '32px',
                border: 'none',
                color: titleBarColors.buttonText
              }}
            />
            <Button
              type="text"
              size="small"
              icon={isMaximized ? 
                <BlockOutlined style={{ fontSize: '12px' }} /> : 
                <BorderOutlined style={{ fontSize: '12px' }} />
              }
              onClick={handleMaximize}
              title={isMaximized ? 'Restore' : 'Maximize'}
              style={{ 
                width: '32px', 
                height: '32px',
                border: 'none',
                color: titleBarColors.buttonText
              }}
            />
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined style={{ fontSize: '12px' }} />}
              onClick={handleClose}
              style={{ 
                width: '32px', 
                height: '32px',
                border: 'none',
                color: titleBarColors.buttonText
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#ff4d4f';
                e.currentTarget.style.color = '#fff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = titleBarColors.buttonText;
              }}
            />
          </Space>
        </Space>
      </Flex>
      
      {/* Sync Modal */}
      <SyncModal
        key={modalKey}
        visible={syncModalVisible}
        onClose={() => setSyncModalVisible(false)}
      />
    </Flex>
  );
};

export default TitleBar;