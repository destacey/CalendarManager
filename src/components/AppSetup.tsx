import React, { useState } from 'react';
import { Card, Input, Button, Typography, Form, Alert, Space } from 'antd';
import { KeyOutlined } from '@ant-design/icons';

const { Title, Paragraph } = Typography;

interface AppSetupProps {
  onSetupComplete: (appRegistrationId: string) => void;
}

const AppSetup: React.FC<AppSetupProps> = ({ onSetupComplete }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (values: { appRegistrationId: string }) => {
    setLoading(true);
    try {
      const { appRegistrationId } = values;
      if (appRegistrationId.trim()) {
        onSetupComplete(appRegistrationId.trim());
      }
    } catch (error) {
      console.error('Error during setup:', error);
    } finally {
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
      <Card style={{ maxWidth: 500, width: '100%' }}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <KeyOutlined style={{ fontSize: '48px', color: '#1890ff', marginBottom: '16px' }} />
            <Title level={2}>Setup Microsoft Graph Integration</Title>
            <Paragraph type="secondary">
              To connect to Microsoft Graph, you'll need to provide the App Registration ID 
              from your Azure AD application registration.
            </Paragraph>
          </div>

          <Alert
            message="Contact your IT administrator"
            description="If you don't have an App Registration ID, please contact your IT administrator to set up an Azure AD application registration for this Calendar Manager app."
            type="info"
            showIcon
          />

          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            autoComplete="off"
          >
            <Form.Item
              label="App Registration ID (Client ID)"
              name="appRegistrationId"
              rules={[
                { required: true, message: 'Please enter the App Registration ID' },
                { 
                  pattern: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
                  message: 'Please enter a valid GUID format (e.g., 12345678-1234-1234-1234-123456789012)'
                }
              ]}
            >
              <Input
                placeholder="e.g., 12345678-1234-1234-1234-123456789012"
                size="large"
              />
            </Form.Item>

            <Form.Item>
              <Button 
                type="primary" 
                htmlType="submit" 
                size="large" 
                loading={loading}
                block
              >
                Save and Continue
              </Button>
            </Form.Item>
          </Form>
        </Space>
      </Card>
    </div>
  );
};

export default AppSetup;