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
  /** Where this event's time is booked. A project with no activity is valid. */
  project_id?: number | null
  activity_id?: number | null
  /** Set when a human mapped it, which stops any rule moving it again. */
  mapping_manually_set?: boolean
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
  /** Hours one day of an all-day event of this type is worth; 0 means it doesn't count. */
  all_day_hours: number
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

export interface Activity {
  id?: number
  name: string
  color: string
  is_active: boolean
  created_at?: string
}


export interface Project {
  id?: number
  name: string
  code: string
  program?: string | null
  is_active: boolean
  created_at?: string
}

export interface MappingRule {
  id?: number
  priority: number
  /** null when the rule does not test the name at all. */
  name_operator?: 'is' | 'contains' | null
  name_value?: string | null
  category_value?: string | null
  type_id?: number | null
  project_id: number
  /** null means "this project, no activity" — a real answer, not a gap. */
  activity_id?: number | null
  is_active: boolean
  created_at?: string
}
