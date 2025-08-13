import React from 'react';
import { Spin, Typography, Space } from 'antd';
import { CalendarOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

const LoadingScreen: React.FC = () => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: '20px',
      }}
    >
      <Space direction="vertical" size="large" style={{ textAlign: 'center' }}>
        {/* Logo/Icon */}
        <div
          style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
          }}
        >
          <CalendarOutlined 
            style={{ 
              fontSize: '36px', 
              color: '#fff',
              animation: 'pulse 2s infinite'
            }} 
          />
        </div>

        {/* App Title */}
        <Title 
          level={2} 
          style={{ 
            color: '#fff', 
            margin: 0, 
            fontWeight: 300,
            letterSpacing: '1px'
          }}
        >
          Calendar Manager
        </Title>

        {/* Loading Spinner */}
        <Spin 
          size="large" 
          style={{ 
            color: '#fff',
            filter: 'invert(1)'
          }} 
        />

        {/* Loading Text */}
        <Text 
          style={{ 
            color: 'rgba(255, 255, 255, 0.8)', 
            fontSize: '16px',
            fontWeight: 300
          }}
        >
          Initializing your workspace...
        </Text>
      </Space>

      <style>{`
        @keyframes pulse {
          0% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.05);
            opacity: 0.8;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
};

export default LoadingScreen;