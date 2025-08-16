// Microsoft Graph Calendar Event structure
export interface GraphDateTime {
  dateTime: string
  timeZone: string
}

export interface GraphEvent {
  '@odata.etag'?: string
  id: string
  categories: string[]
  subject: string
  isAllDay: boolean
  showAs: 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere'
  start: GraphDateTime
  end: GraphDateTime
  body?: {
    contentType: 'text' | 'html'
    content: string
  }
  location?: {
    displayName: string
  }
  organizer?: {
    emailAddress: {
      name: string
      address: string
    }
  }
  attendees?: Array<{
    emailAddress: {
      name: string
      address: string
    }
    status: {
      response: 'none' | 'tentative' | 'accepted' | 'declined'
      time: string
    }
  }>
}

// Local database event structure
export interface Event {
  id?: number
  graph_id?: string
  title: string
  description?: string
  start_date: string
  end_date?: string
  is_all_day: boolean
  show_as: string
  categories: string
  location?: string
  organizer?: string // JSON string containing organizer info
  attendees?: string // JSON string containing attendees array
  created_at?: string
  updated_at?: string
  synced_at?: string
}

export interface Category {
  id?: number
  name: string
  color: string
  created_at?: string
}

export interface ElectronAPI {
  // Database operations
  getEvents: () => Promise<Event[]>
  createEvent: (eventData: Event) => Promise<Event>
  updateEvent: (id: number, eventData: Event) => Promise<Event>
  deleteEvent: (id: number) => Promise<boolean>
  deleteAllEvents: () => Promise<{ deleted: number }>
  
  // Category management
  getCategories: () => Promise<Category[]>
  createCategory: (categoryData: Category) => Promise<Category>
  
  // Microsoft Graph sync
  syncGraphEvents: (events: GraphEvent[]) => Promise<{ synced: number }>
  
  // File operations
  openFile: () => Promise<any>
  saveFile: (content: string) => Promise<any>
  onMenuAction: (callback: (event: any, action: string) => void) => void
  removeAllListeners: (channel: string) => void
  
  // Window controls
  minimizeWindow: () => Promise<void>
  maximizeWindow: () => Promise<void>
  closeWindow: () => Promise<void>
  isWindowMaximized: () => Promise<boolean>
  onWindowStateChange: (callback: (event: any, maximized: boolean) => void) => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

// Extend CSSProperties to include Webkit properties for Electron
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}