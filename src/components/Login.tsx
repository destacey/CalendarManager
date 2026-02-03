import React, { useState } from 'react';
import { Card, Button, Typography, Alert, Space, Spin } from 'antd';
import { LoginOutlined, UserOutlined } from '@ant-design/icons';

const { Title, Paragraph } = Typography;

interface LoginProps {
  onLoginSuccess: () => void;
  onLoginError: (error: string) => void;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess: _onLoginSuccess, onLoginError }) => {
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      const { authService } = await import('../services/auth');
      await authService.login();
      // Note: loginRedirect will cause a page navigation, so onLoginSuccess won't be called immediately
    } catch (error) {
      console.error('Login failed:', error);
      onLoginError(error instanceof Error ? error.message : 'Login failed');
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center', 
      minHeight: '100vh',
      padding: '24px'
    }}>
      <Card style={{ maxWidth: 400, width: '100%' }}>
        <Space orientation="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <UserOutlined style={{ fontSize: '48px', color: '#1890ff', marginBottom: '16px' }} />
            <Title level={2}>Sign In</Title>
            <Paragraph type="secondary">
              Sign in with your Microsoft account to access your calendar.
            </Paragraph>
          </div>

          <Alert
            title="Microsoft Account Required"
            description="You'll need to sign in with your Microsoft work or school account to access Microsoft Graph services."
            type="info"
            showIcon
          />

          <div style={{ textAlign: 'center' }}>
            <Button 
              type="primary" 
              size="large"
              icon={loading ? <Spin size="small" /> : <LoginOutlined />}
              onClick={handleLogin}
              loading={loading}
              block
            >
              Sign in with Microsoft
            </Button>
          </div>
        </Space>
      </Card>
    </div>
  );
};

export default Login;