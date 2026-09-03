import React, { useState, useEffect } from 'react';
import { Button, Space, Tooltip, Dropdown, MenuProps, Flex, Typography, theme } from 'antd';
import { MinusOutlined, BorderOutlined, CloseOutlined, BlockOutlined, MenuFoldOutlined, MenuUnfoldOutlined, CloudSyncOutlined, MenuOutlined, HomeOutlined, CalendarOutlined, SettingOutlined } from '@ant-design/icons';
import UserMenu from './UserMenu';
import SyncProgress from './SyncProgress';
import SyncModal from './SyncModal';
import { calendarService, SyncProgress as SyncProgressType } from '../services/calendar';
import {
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  isWindowMaximized,
  onWindowResized,
} from '../api/window';

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
  const { token } = theme.useToken();

  useEffect(() => {
    let unlistenResize: (() => void) | undefined;
    let cancelled = false;

    const setUpWindowState = async () => {
      try {
        const maximized = await isWindowMaximized();
        if (!cancelled) setIsMaximized(maximized);
      } catch (error) {
        console.warn('Could not get window state:', error);
      }

      try {
        const unlisten = await onWindowResized((maximized) => {
          if (!cancelled) setIsMaximized(maximized);
        });
        if (cancelled) {
          unlisten();
        } else {
          unlistenResize = unlisten;
        }
      } catch (error) {
        console.warn('Could not subscribe to window resize:', error);
      }
    };

    setUpWindowState();

    // Set up sync progress tracking
    calendarService.setSyncCallbacks(
      (progress) => setSyncProgress(progress),
      () => setSyncProgress(null)
    );

    return () => {
      cancelled = true;
      unlistenResize?.();
      // Clean up sync callbacks
      calendarService.setSyncCallbacks();
    };
  }, []);

  const handleMinimize = () => {
    minimizeWindow().catch((error) => console.warn('Minimize failed:', error));
  };

  const handleMaximize = () => {
    // Optimistic flip keeps the icon responsive; onWindowResized corrects it
    setIsMaximized((previous) => !previous);
    toggleMaximizeWindow().catch((error) => console.warn('Maximize failed:', error));
  };

  const handleClose = () => {
    closeWindow().catch((error) => console.warn('Close failed:', error));
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
      data-tauri-drag-region
      justify="space-between"
      align="center"
      style={{
        height: '32px',
        background: token.colorBgContainer,
        padding: '0 12px',
        borderBottom: `1px solid ${token.colorBorder}`,
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
            title={sideNavCollapsed ? 'Expand menu' : 'Collapse menu'}
          />
        )}
        <Text data-tauri-drag-region style={{ fontSize: '14px', fontWeight: 500 }}>
          {isMobile ? 'CM' : 'Calendar Manager'}
        </Text>
        
      </Flex>
      
      {/* Sync section in the middle */}
      <Flex 
        justify="center"
        align="center"
        style={{
          flex: 1,
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
            />
          </Tooltip>
        )}
      </Flex>
      
      <Flex align="center">
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
                height: '32px'
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
                height: '32px'
              }}
            />
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined style={{ fontSize: '12px' }} />}
              onClick={handleClose}
              style={{ 
                width: '32px', 
                height: '32px'
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