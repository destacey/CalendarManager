import React, { useState } from 'react';
import { Card, Button, Typography, Alert, Space, Spin } from 'antd';
import { LoginOutlined, UserOutlined } from '@ant-design/icons';

const { Title, Paragraph } = Typography;

interface LoginProps {
  onLoginSuccess: () => void;
  onLoginError: (error: string) => void;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess, onLoginError }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const { authService } = await import('../services/auth');
      await authService.login();
      onLoginSuccess();
    } catch (caught) {
      // Rust rejects with a plain, readable string, so it is worth showing
      // rather than only logging — the likeliest failure here is Entra's
      // AADSTS7000218, which names its own fix.
      const message = typeof caught === 'string' ? caught : 'Login failed';
      console.error('Login failed:', caught);
      setError(message);
      onLoginError(message);
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    const { authService } = await import('../services/auth');
    await authService.cancelLogin();
    // The pending login() rejects with 'Login was cancelled', which clears
    // the loading state through the catch above.
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
            description="Your browser will open so you can sign in with your Microsoft work or school account."
            type="info"
            showIcon
          />

          {error && (
            <Alert
              title="Sign-in failed"
              description={error}
              type="error"
              showIcon
              closable
              onClose={() => setError(null)}
            />
          )}

          <div style={{ textAlign: 'center' }}>
            <Button 
              type="primary" 
              size="large"
              icon={loading ? <Spin size="small" /> : <LoginOutlined />}
              onClick={handleLogin}
              loading={loading}
              block
            >
              {loading ? 'Waiting for your browser…' : 'Sign in with Microsoft'}
            </Button>
            {loading && (
              <Button type="link" onClick={handleCancel} style={{ marginTop: 8 }}>
                Cancel
              </Button>
            )}
          </div>
        </Space>
      </Card>
    </div>
  );
};

export default Login;