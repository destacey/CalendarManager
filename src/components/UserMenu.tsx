import React, { useState, useEffect } from 'react';
import { Dropdown, Avatar, Typography, Space, Button } from 'antd';
import { UserOutlined, LogoutOutlined, LoadingOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { authService } from '../services/auth';

const { Text } = Typography;

interface UserMenuProps {
  onLogout: () => void;
}

interface UserInfo {
  displayName: string;
  mail: string;
  givenName: string;
  surname: string;
}

const UserMenu: React.FC<UserMenuProps> = ({ onLogout }) => {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUserInfo = async () => {
      try {
        if (authService.isLoggedIn()) {
          const graphClient = await authService.getGraphClient();
          const user = await graphClient.api('/me').get();
          setUserInfo({
            displayName: user.displayName || 'Unknown User',
            mail: user.mail || user.userPrincipalName || '',
            givenName: user.givenName || '',
            surname: user.surname || ''
          });
        }
      } catch (error) {
        console.error('Error fetching user info:', error);
        setUserInfo({
          displayName: 'Unknown User',
          mail: '',
          givenName: '',
          surname: ''
        });
      } finally {
        setLoading(false);
      }
    };

    fetchUserInfo();
  }, []);

  const handleLogout = async () => {
    try {
      await authService.logout();
      onLogout();
    } catch (error) {
      console.error('Logout failed:', error);
      onLogout(); // Still redirect even if logout fails
    }
  };

  const menuItems: MenuProps['items'] = [
    {
      key: 'profile',
      label: (
        <div style={{ padding: '8px 0', minWidth: '200px' }}>
          <Text strong>{userInfo?.displayName || 'Loading...'}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: '12px' }}>
            {userInfo?.mail || ''}
          </Text>
        </div>
      ),
      disabled: true,
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      label: (
        <Space>
          <LogoutOutlined />
          Sign Out
        </Space>
      ),
      onClick: handleLogout,
    },
  ];

  if (loading) {
    return (
      <Button type="text" icon={<LoadingOutlined />}>
        Loading...
      </Button>
    );
  }

  const getInitials = (name: string): string => {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <Dropdown
      menu={{ items: menuItems }}
      trigger={['click']}
      placement="bottomRight"
    >
      <Button type="text" style={{ height: '24px', padding: '0 6px', fontSize: '12px' }}>
        <Space size={4}>
          <Avatar 
            size={20} 
            icon={<UserOutlined />}
            style={{ backgroundColor: '#1890ff', fontSize: '10px' }}
          >
            {userInfo?.displayName ? getInitials(userInfo.displayName) : <UserOutlined />}
          </Avatar>
          <Text style={{ color: '#666', fontSize: '12px' }}>
            {userInfo?.givenName || userInfo?.displayName || 'User'}
          </Text>
        </Space>
      </Button>
    </Dropdown>
  );
};

export default UserMenu;