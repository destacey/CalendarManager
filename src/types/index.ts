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
  // Read operations
  getEvents: () => Promise<Event[]>
  getCategories: () => Promise<Category[]>
  
  // Microsoft Graph sync
  syncGraphEvents: (events: GraphEvent[]) => Promise<void>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}