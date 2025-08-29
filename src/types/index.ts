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
  is_meeting?: boolean
  type_id?: number
  type_manually_set?: boolean
  created_at?: string
  updated_at?: string
  synced_at?: string
}

// Enhanced event with multi-day rendering metadata
export interface CalendarEvent extends Event {
  _isStart?: boolean    // Is this the start day of a multi-day event?
  _isEnd?: boolean      // Is this the end day of a multi-day event?
  _isMiddle?: boolean   // Is this a middle day of a multi-day event?
  _spanDays?: number    // How many days does this event span?
}

export interface Category {
  id?: number
  name: string
  color: string
  created_at?: string
}

export interface EventType {
  id?: number
  name: string
  color: string
  is_default?: boolean
  is_billable: boolean
  created_at?: string
}

export interface EventTypeRule {
  id?: number
  name: string
  priority: number
  field_name: 'title' | 'is_all_day' | 'show_as' | 'categories'
  operator: 'equals' | 'contains' | 'is_empty'
  value?: string
  target_type_id: number
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
  
  // Event type management
  getEventTypes: () => Promise<EventType[]>
  createEventType: (eventTypeData: EventType) => Promise<EventType>
  updateEventType: (id: number, eventTypeData: EventType) => Promise<EventType>
  deleteEventType: (id: number) => Promise<boolean>
  setDefaultEventType: (id: number) => Promise<boolean>
  
  // Event type rule management
  getEventTypeRules: () => Promise<EventTypeRule[]>
  createEventTypeRule: (ruleData: EventTypeRule) => Promise<EventTypeRule>
  updateEventTypeRule: (id: number, ruleData: EventTypeRule) => Promise<EventTypeRule>
  deleteEventTypeRule: (id: number) => Promise<boolean>
  updateRulePriorities: (ruleIds: number[]) => Promise<boolean>
  
  // Event type assignment
  evaluateEventType: (eventData: Event) => Promise<number | null>
  setEventTypeManually: (eventId: number, typeId: number) => Promise<boolean>
  reprocessEventTypes: () => Promise<{
    success: boolean
    processedCount?: number
    updatedCount?: number
    message: string
    error?: string
  }>
  
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