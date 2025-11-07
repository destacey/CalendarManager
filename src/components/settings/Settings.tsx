import React, { useState } from "react";
import { Tabs, Typography, Input, Space } from "antd";
import { SearchOutlined, TagOutlined } from "@ant-design/icons";
import MicrosoftGraphSettings from "./MicrosoftGraphSettings";
import TimezoneSettings from "./TimezoneSettings";
import EventTypesSettings from "./EventTypesSettings";
import EventTypeRulesSettings from "./EventTypeRulesSettings";

const { Title } = Typography;
const { Search } = Input;

interface SettingsProps {
  onEventsUpdated?: () => void;
}

const Settings: React.FC<SettingsProps> = ({ onEventsUpdated }) => {
  const [searchTerm, setSearchTerm] = useState("");

  const tabItems = [
    {
      key: "general",
      label: "General",
      children: (
        <div style={{ maxWidth: "800px" }}>
          <MicrosoftGraphSettings searchTerm={searchTerm} />
          <TimezoneSettings searchTerm={searchTerm} />

          <div style={{ marginBottom: "32px" }}>
            <Title
              level={4}
              style={{
                display: "flex",
                alignItems: "center",
                marginBottom: "16px",
              }}
            >
              <TagOutlined style={{ marginRight: "8px" }} />
              Event Types
            </Title>
            <EventTypesSettings searchTerm={searchTerm} />
            <EventTypeRulesSettings
              searchTerm={searchTerm}
              onEventsUpdated={onEventsUpdated}
            />
          </div>
        </div>
      ),
    },
    // Future tabs can be added here
    // {
    //   key: 'sync',
    //   label: (
    //     <span>
    //       <SyncOutlined />
    //       Sync
    //     </span>
    //   ),
    //   children: <SyncSettings searchTerm={searchTerm} />,
    // },
  ];

  return (
    <div style={{ padding: "24px", height: "100%", overflow: "auto" }}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <div>
          <Title level={2} style={{ marginBottom: "8px" }}>
            Settings
          </Title>
          <Search
            placeholder="Search settings..."
            prefix={<SearchOutlined />}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ maxWidth: "400px" }}
            allowClear
          />
        </div>

        <Tabs
          defaultActiveKey="general"
          items={tabItems}
          tabPosition="top"
          style={{ width: "100%" }}
        />
      </Space>
    </div>
  );
};

export default Settings;
