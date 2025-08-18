import { useState, useEffect } from 'react'
import { ConfigProvider, Layout, App as AntApp, Modal, Grid } from 'antd'
import CalendarViewer from './components/calendar/CalendarViewer'
import AppSetup from './components/AppSetup'
import Login from './components/Login'
import TitleBar from './components/TitleBar'
import LoadingScreen from './components/LoadingScreen'
import SideNavigation from './components/SideNavigation'
import DataManagement from './components/DataManagement'
import Settings from './components/Settings'
import { ThemeProvider, useTheme } from './contexts/ThemeContext'
import { storageService } from './services/storage'
import { authService } from './services/auth'
import './App.css'

const { Content } = Layout
const { useBreakpoint } = Grid

type AppState = 'loading' | 'setup' | 'login' | 'dashboard'

function AppContent() {
  const [appState, setAppState] = useState<AppState>('loading')
  const [sideNavCollapsed, setSideNavCollapsed] = useState(false)
  const [selectedNavKey, setSelectedNavKey] = useState('home')
  const [dataManagementVisible, setDataManagementVisible] = useState(false)
  const screens = useBreakpoint()

  // Use mobile navigation on small screens (sm and below)
  const isMobile = !screens.md // md breakpoint is 768px, so this covers screens < 768px
  const showSideNav = !isMobile
  
  // Auto-collapse sidebar on medium screens
  useEffect(() => {
    if (!isMobile && screens.md && !screens.lg) {
      setSideNavCollapsed(true)
    } else if (!isMobile && screens.lg) {
      setSideNavCollapsed(false)
    }
  }, [screens, isMobile])

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const appRegistrationId = await storageService.getAppRegistrationId()
        
        if (!appRegistrationId) {
          setAppState('setup')
          return
        }

        // Only initialize auth service if we have a valid client ID
        await authService.initialize(appRegistrationId)
        
        // Give MSAL a moment to fully initialize before handling redirects
        if (window.location.hash.includes('code=') || window.location.hash.includes('error=')) {
          // Small delay to ensure MSAL is fully ready
          await new Promise(resolve => setTimeout(resolve, 100))
          await authService.handleRedirectPromise()
        }
        
        if (authService.isLoggedIn()) {
          setAppState('dashboard')
        } else {
          setAppState('login')
        }
      } catch (error) {
        console.error('Error initializing app:', error)
        setAppState('setup')
      }
    }

    initializeApp()
  }, [])

  const handleSetupComplete = async (appRegistrationId: string) => {
    try {
      await storageService.setAppRegistrationId(appRegistrationId)
      await authService.initialize(appRegistrationId)
      setAppState('login')
    } catch (error) {
      console.error('Error completing setup:', error)
      setAppState('setup')
    }
  }

  const handleLoginSuccess = () => {
    setAppState('dashboard')
  }

  const handleLoginError = (error: string) => {
    console.error('Login failed:', error)
  }

  const handleLogout = () => {
    setAppState('login')
  }

  const handleNavMenuSelect = (key: string) => {
    setSelectedNavKey(key)
  }

  const handleMenuToggle = () => {
    setSideNavCollapsed(!sideNavCollapsed)
  }

  const handleDataManagement = () => {
    setDataManagementVisible(true)
  }

  const renderMainContent = () => {
    switch (selectedNavKey) {
      case 'home':
        return (
          <div className="side-nav-content">
            <h1>Welcome to Calendar Manager</h1>
            <p>Select Calendar from the sidebar to view your events, or Settings to configure the application.</p>
          </div>
        )
      case 'calendar':
        return <CalendarViewer />
      case 'settings':
        return <Settings />
      default:
        return <CalendarViewer />
    }
  }

  const renderContent = () => {
    switch (appState) {
      case 'loading':
        return <LoadingScreen />
      case 'setup':
        return (
          <div>
            <TitleBar showUserMenu={false} />
            <AppSetup onSetupComplete={handleSetupComplete} />
          </div>
        )
      case 'login':
        return (
          <div>
            <TitleBar showUserMenu={false} />
            <Login onLoginSuccess={handleLoginSuccess} onLoginError={handleLoginError} />
          </div>
        )
      case 'dashboard':
        return (
          <Layout style={{ minHeight: '100vh', height: '100vh', display: 'flex', flexDirection: 'column' }}>
            <TitleBar 
              showUserMenu={true} 
              onLogout={handleLogout}
              showMenuToggle={showSideNav}
              onMenuToggle={handleMenuToggle}
              sideNavCollapsed={sideNavCollapsed}
              isMobile={isMobile}
              selectedNavKey={selectedNavKey}
              onNavSelect={handleNavMenuSelect}
              onDataManagement={handleDataManagement}
            />
            <Layout style={{ 
              display: 'flex',
              flexDirection: 'row',
              height: 'calc(100vh - 32px)'
            }}>
              {showSideNav && (
                <SideNavigation
                  collapsed={sideNavCollapsed}
                  selectedKey={selectedNavKey}
                  onMenuSelect={handleNavMenuSelect}
                />
              )}
              <Layout style={{ 
                marginLeft: showSideNav ? (sideNavCollapsed ? 50 : 200) : 0,
                transition: 'margin-left 0.2s',
                display: 'flex',
                flexDirection: 'column',
                height: '100%'
              }}>
                <Content 
                  className="app-content"
                  style={{ 
                    flex: 1,
                    padding: '16px', 
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                    overflow: 'auto'
                  }}>
                  {renderMainContent()}
                </Content>
              </Layout>
            </Layout>
            
            {/* Data Management Modal */}
            <Modal
              title="Data Management"
              open={dataManagementVisible}
              onCancel={() => setDataManagementVisible(false)}
              footer={null}
              width={800}
              destroyOnHidden
            >
              <DataManagement />
            </Modal>
          </Layout>
        )
      default:
        return null
    }
  }

  return renderContent()
}

function ThemedAppContent() {
  const { antdTheme } = useTheme()
  
  return (
    <ConfigProvider theme={antdTheme}>
      <AntApp>
        <AppContent />
      </AntApp>
    </ConfigProvider>
  )
}

function App() {
  return (
    <ThemeProvider>
      <ThemedAppContent />
    </ThemeProvider>
  )
}

export default App