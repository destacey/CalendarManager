/// <reference types="vitest/globals" />

// Extend Window interface for electronAPI mock
declare global {
  interface Window {
    electronAPI: {
      getEvents: () => Promise<any[]>
      syncGraphEvents: (events: any[]) => Promise<void>
      getConfig: (key: string) => Promise<any>
      setConfig: (key: string, value: any) => Promise<void>
      clearConfig: (key: string) => Promise<void>
      [key: string]: any
    }
  }
}