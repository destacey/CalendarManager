import React, { useState, useEffect } from 'react';
import { Button, Space } from 'antd';
import { MinusOutlined, BorderOutlined, CloseOutlined, BlockOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import UserMenu from './UserMenu';
import { useTheme } from '../contexts/ThemeContext';

interface TitleBarProps {
  showUserMenu?: boolean;
  onLogout?: () => void;
  showMenuToggle?: boolean;
  onMenuToggle?: () => void;
  sideNavCollapsed?: boolean;
}

const TitleBar: React.FC<TitleBarProps> = ({ 
  showUserMenu = false, 
  onLogout, 
  showMenuToggle = false, 
  onMenuToggle,
  sideNavCollapsed = false 
}) => {
  const [isMaximized, setIsMaximized] = useState(false);
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

    return () => {
      if (window.electronAPI?.removeAllListeners) {
        window.electronAPI.removeAllListeners('window-state-change');
      }
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

  const titleBarColors = {
    background: themeMode === 'dark' ? '#141414' : '#f5f5f5',
    border: themeMode === 'dark' ? '#434343' : '#d9d9d9',
    text: themeMode === 'dark' ? 'rgba(255, 255, 255, 0.85)' : '#666',
    buttonText: themeMode === 'dark' ? 'rgba(255, 255, 255, 0.65)' : '#666'
  };

  return (
    <div
      style={{
        height: '32px',
        background: titleBarColors.background,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        borderBottom: `1px solid ${titleBarColors.border}`,
        WebkitAppRegion: 'drag',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {showMenuToggle && (
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
        <div style={{ fontSize: '14px', fontWeight: 500, color: titleBarColors.text }}>
          Calendar Manager
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', WebkitAppRegion: 'no-drag' }}>
        <Space size={8}>
          {showUserMenu && onLogout && (
            <div style={{ marginRight: '8px' }}>
              <UserMenu onLogout={onLogout} />
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
      </div>
    </div>
  );
};

export default TitleBar;