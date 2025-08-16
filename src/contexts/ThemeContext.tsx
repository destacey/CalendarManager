import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { theme } from 'antd'

export type ThemeMode = 'light' | 'dark'

interface ThemeContextType {
  themeMode: ThemeMode
  toggleTheme: () => void
  antdTheme: any
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

interface ThemeProviderProps {
  children: ReactNode
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [themeMode, setThemeMode] = useState<ThemeMode>('light')

  useEffect(() => {
    const savedTheme = localStorage.getItem('calendar-manager-theme') as ThemeMode
    if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark')) {
      setThemeMode(savedTheme)
    }
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode)
  }, [themeMode])

  const toggleTheme = () => {
    const newTheme = themeMode === 'light' ? 'dark' : 'light'
    setThemeMode(newTheme)
    localStorage.setItem('calendar-manager-theme', newTheme)
  }

  const antdTheme = {
    algorithm: themeMode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    components: {
      Calendar: {
        cellHoverBg: themeMode === 'dark' ? 'rgba(177, 186, 194, 0.06)' : 'rgba(24, 144, 255, 0.06)',
        itemActiveBg: themeMode === 'dark' ? '#177ddc' : '#1890ff',
        cellActiveWithRangeBg: themeMode === 'dark' ? 'rgba(177, 186, 194, 0.06)' : 'rgba(24, 144, 255, 0.06)',
        cellRangeBorderColor: themeMode === 'dark' ? '#177ddc' : '#1890ff',
        cellBgDisabled: themeMode === 'dark' ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)',
      },
    },
  }

  return (
    <ThemeContext.Provider value={{ themeMode, toggleTheme, antdTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}