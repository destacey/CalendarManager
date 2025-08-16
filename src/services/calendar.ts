import { authService } from './auth'
import { storageService } from './storage'
import { GraphEvent, Event } from '../types'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
dayjs.extend(timezone)

export interface SyncConfig {
  startDate: string
  endDate: string
}

export interface DateRange {
  start: string
  end: string
}

export interface SyncProgress {
  total: number
  completed: number
  stage: 'fetching' | 'processing' | 'saving' | 'cleaning'
  message: string
}

export interface SyncResult {
  success: boolean
  message: string
  mode: 'differential' | 'full'
  stats: {
    created: number
    updated: number
    deleted: number
    total: number
  }
  errors?: string[]
}

export interface SyncMetadata {
  lastSyncTime?: string | null
  deltaToken?: string
  lastEventModified?: string
}

export type SyncProgressCallback = (progress: SyncProgress) => void
export type SyncCompletionCallback = (result: SyncResult) => void

class CalendarService {
  private syncInProgress = false
  private syncController: AbortController | null = null
  private progressCallbacks: Set<SyncProgressCallback> = new Set()
  private completionCallbacks: Set<SyncCompletionCallback> = new Set()

  private defaultSyncConfig: SyncConfig = {
    startDate: dayjs().subtract(7, 'day').format('YYYY-MM-DD'),
    endDate: dayjs().format('YYYY-MM-DD')
  }

  // Check if currently syncing
  isSyncing(): boolean {
    return this.syncInProgress
  }

  // Cancel current sync operation
  cancelSync(): void {
    if (this.syncController) {
      this.syncController.abort()
      this.syncController = null
    }
    this.syncInProgress = false
  }

  // Add callbacks for progress and completion
  addSyncCallbacks(
    progressCallback?: SyncProgressCallback,
    completionCallback?: SyncCompletionCallback
  ) {
    if (progressCallback) {
      this.progressCallbacks.add(progressCallback)
    }
    if (completionCallback) {
      this.completionCallbacks.add(completionCallback)
    }
  }

  // Remove callbacks
  removeSyncCallbacks(
    progressCallback?: SyncProgressCallback,
    completionCallback?: SyncCompletionCallback
  ) {
    if (progressCallback) {
      this.progressCallbacks.delete(progressCallback)
    }
    if (completionCallback) {
      this.completionCallbacks.delete(completionCallback)
    }
  }

  // Legacy method for backward compatibility
  setSyncCallbacks(
    progressCallback?: SyncProgressCallback,
    completionCallback?: SyncCompletionCallback
  ) {
    this.progressCallbacks.clear()
    this.completionCallbacks.clear()
    if (progressCallback) {
      this.progressCallbacks.add(progressCallback)
    }
    if (completionCallback) {
      this.completionCallbacks.add(completionCallback)
    }
  }

  private updateProgress(progress: SyncProgress) {
    this.progressCallbacks.forEach(callback => {
      try {
        callback(progress)
      } catch (error) {
        console.error('Error in progress callback:', error)
      }
    })
  }

  private completeSync(result: SyncResult) {
    this.syncInProgress = false
    this.syncController = null
    this.completionCallbacks.forEach(callback => {
      try {
        callback(result)
      } catch (error) {
        console.error('Error in completion callback:', error)
      }
    })
  }

  private isOnline(): boolean {
    return navigator.onLine
  }

  // Get sync metadata from storage
  private async getSyncMetadata(): Promise<SyncMetadata | null> {
    return await storageService.getSyncMetadata()
  }

  // Save sync metadata to storage
  private async setSyncMetadata(metadata: SyncMetadata): Promise<void> {
    await storageService.setSyncMetadata(metadata)
  }

  // Simplified sync - only manages events within the specified date range
  async syncEvents(forceFullSync = false): Promise<void> {
    if (this.syncInProgress) {
      throw new Error('Sync already in progress')
    }

    if (!this.isOnline()) {
      this.completeSync({
        success: false,
        message: 'Unable to sync while offline. Please check your internet connection.',
        mode: 'full',
        stats: { created: 0, updated: 0, deleted: 0, total: 0 }
      })
      return
    }

    this.syncInProgress = true
    this.syncController = new AbortController()

    try {
      await this.performDateRangeSync()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.completeSync({
          success: false,
          message: 'Sync was cancelled',
          mode: 'full',
          stats: { created: 0, updated: 0, deleted: 0, total: 0 }
        })
      } else {
        console.error('Sync error:', error)
        this.completeSync({
          success: false,
          message: 'Sync failed. Please try again.',
          mode: 'full',
          stats: { created: 0, updated: 0, deleted: 0, total: 0 },
          errors: [error instanceof Error ? error.message : 'Unknown error']
        })
      }
    }
  }

  private async performDateRangeSync(): Promise<void> {
    const config = await storageService.getSyncConfig()
    const dateRange = await this.calculateDateRange(config)

    this.updateProgress({
      total: 0,
      completed: 0,
      stage: 'fetching',
      message: 'Fetching events for specified date range...'
    })

    // Fetch events from Graph API for the date range
    const graphEvents = await this.fetchAllEvents(dateRange)
    
    this.updateProgress({
      total: graphEvents.length,
      completed: 0,
      stage: 'processing',
      message: `Processing ${graphEvents.length} events...`
    })

    // Process events for the date range only
    await this.processSyncEventsForDateRange(graphEvents, dateRange)
  }

  private async performDifferentialSyncWithFallback(): Promise<void> {
    const metadata = await this.getSyncMetadata()
    
    if (!metadata || !metadata.deltaToken) {
      // No previous sync data, perform full sync
      await this.performFullSync()
      return
    }

    try {
      this.updateProgress({
        total: 0,
        completed: 0,
        stage: 'fetching',
        message: 'Checking for changes since last sync...'
      })

      const deltaResult = await this.fetchDeltaEvents(metadata.deltaToken)
      await this.processSyncEvents(deltaResult.events, 'differential')
      
      // Update metadata with new delta token
      await this.setSyncMetadata({
        lastSyncTime: new Date().toISOString(),
        deltaToken: deltaResult.deltaToken,
        lastEventModified: this.getLatestEventModified(deltaResult.events)
      })

    } catch (error) {
      this.updateProgress({
        total: 0,
        completed: 0,
        stage: 'fetching',
        message: 'Differential sync failed, performing full sync...'
      })
      await this.performFullSync()
    }
  }

  private async performFullSync(): Promise<void> {
    const config = await storageService.getSyncConfig()
    const dateRange = await this.calculateDateRange(config)

    this.updateProgress({
      total: 0,
      completed: 0,
      stage: 'fetching',
      message: 'Fetching all events...'
    })

    const result = await this.fetchAllEventsWithDeltaToken(dateRange)
    await this.processSyncEvents(result.events, 'full')

    // Save new sync metadata with delta token for next differential sync
    await this.setSyncMetadata({
      lastSyncTime: new Date().toISOString(),
      deltaToken: result.deltaToken,
      lastEventModified: this.getLatestEventModified(result.events)
    })
  }

  private async fetchDeltaEvents(deltaToken: string): Promise<{ events: GraphEvent[], deltaToken?: string }> {
    const graphClient = await authService.getGraphClient()
    
    // Use delta token to get only changed events
    const response = await graphClient
      .api('/me/calendar/events/delta')
      .query({ $deltatoken: deltaToken })
      .get()

    return {
      events: response.value || [],
      deltaToken: this.extractDeltaToken(response)
    }
  }

  private async fetchAllEventsWithDeltaToken(dateRange: DateRange): Promise<{ events: GraphEvent[], deltaToken?: string }> {
    const graphClient = await authService.getGraphClient()
    const allEvents: GraphEvent[] = []
    let nextLink: string | undefined
    let deltaToken: string | undefined
    
    // Use calendarView for the full sync (which doesn't support delta)
    // Initial request
    let response = await graphClient
      .api('/me/calendar/calendarView')
      .query({
        startDateTime: dateRange.start,
        endDateTime: dateRange.end,
        $select: 'id,subject,start,end,isAllDay,showAs,categories,body,location,organizer,attendees,lastModifiedDateTime',
        $orderby: 'lastModifiedDateTime desc',
        $top: 500
      })
      .get()

    // Add first batch of events
    if (response.value) {
      allEvents.push(...response.value)
    }

    // Continue fetching if there are more pages
    nextLink = response['@odata.nextLink']
    
    while (nextLink) {
      this.updateProgress({
        total: 0, // We don't know total yet
        completed: allEvents.length,
        stage: 'fetching',
        message: `Fetching events... (${allEvents.length} so far)`
      })

      // Extract just the path and query from the nextLink (remove base URL)
      const url = new URL(nextLink)
      const relativePath = url.pathname.replace('/v1.0', '') + url.search
      
      response = await graphClient
        .api(relativePath)
        .get()

      if (response.value) {
        allEvents.push(...response.value)
      }

      nextLink = response['@odata.nextLink']
    }

    // Initialize delta sync to get baseline delta token
    try {
      const deltaResponse = await graphClient
        .api('/me/calendar/events/delta')
        .get()
      
      // Process all delta pages to get to the end and obtain the delta link
      let deltaNextLink = deltaResponse['@odata.nextLink']
      let currentDeltaResponse = deltaResponse
      
      while (deltaNextLink) {
        const url = new URL(deltaNextLink)
        const relativePath = url.pathname.replace('/v1.0', '') + url.search
        const nextDeltaResponse = await graphClient.api(relativePath).get()
        deltaNextLink = nextDeltaResponse['@odata.nextLink']
        currentDeltaResponse = nextDeltaResponse
      }
      
      deltaToken = this.extractDeltaToken(currentDeltaResponse)
    } catch (error) {
      console.warn('Could not obtain delta token:', error.message)
    }

    return { events: allEvents, deltaToken }
  }

  private async fetchAllEvents(dateRange: DateRange): Promise<GraphEvent[]> {
    const graphClient = await authService.getGraphClient()
    const allEvents: GraphEvent[] = []
    let nextLink: string | undefined
    
    // Initial request
    let response = await graphClient
      .api('/me/calendar/calendarView')
      .query({
        startDateTime: dateRange.start,
        endDateTime: dateRange.end,
        $select: 'id,subject,start,end,isAllDay,showAs,categories,body,location,organizer,attendees,lastModifiedDateTime',
        $orderby: 'lastModifiedDateTime desc',
        $top: 500
      })
      .get()

    // Add first batch of events
    if (response.value) {
      allEvents.push(...response.value)
    }

    // Continue fetching if there are more pages
    nextLink = response['@odata.nextLink']
    
    while (nextLink) {
      this.updateProgress({
        total: 0, // We don't know total yet
        completed: allEvents.length,
        stage: 'fetching',
        message: `Fetching events... (${allEvents.length} so far)`
      })

      // Extract just the path and query from the nextLink (remove base URL)
      const url = new URL(nextLink)
      const relativePath = url.pathname.replace('/v1.0', '') + url.search
      
      response = await graphClient
        .api(relativePath)
        .get()

      if (response.value) {
        allEvents.push(...response.value)
      }

      nextLink = response['@odata.nextLink']
    }

    return allEvents
  }

  private async processSyncEventsForDateRange(graphEvents: GraphEvent[], dateRange: DateRange): Promise<void> {
    this.updateProgress({
      total: graphEvents.length,
      completed: 0,
      stage: 'saving',
      message: 'Saving events to database...'
    })

    // Sync with database via Electron API
    if (!window.electronAPI) {
      throw new Error('Electron API not available')
    }

    const syncResult = await window.electronAPI.syncGraphEvents(graphEvents)

    this.updateProgress({
      total: graphEvents.length,
      completed: graphEvents.length,
      stage: 'cleaning',
      message: 'Cleaning up outdated events in date range...'
    })
    
    // Only delete events within the sync date range that are no longer in Graph
    const deletedCount = await this.cleanupEventsInDateRange(graphEvents, dateRange)

    // If no breakdown is provided (likely first sync), assume all events are created
    const hasBreakdown = (syncResult.created || 0) + (syncResult.updated || 0) > 0
    const createdCount = hasBreakdown ? (syncResult.created || 0) : syncResult.synced
    const updatedCount = hasBreakdown ? (syncResult.updated || 0) : 0

    this.completeSync({
      success: true,
      message: `Successfully synced ${syncResult.synced} events for the specified date range.`,
      mode: 'full',
      stats: {
        created: createdCount,
        updated: updatedCount,
        deleted: deletedCount,
        total: syncResult.synced
      }
    })
  }

  private async processSyncEvents(graphEvents: GraphEvent[], mode: 'differential' | 'full'): Promise<void> {
    if (graphEvents.length === 0) {
      this.completeSync({
        success: true,
        message: mode === 'differential' ? 'No changes since last sync.' : 'No events found in date range.',
        mode,
        stats: { created: 0, updated: 0, deleted: 0, total: 0 }
      })
      return
    }

    this.updateProgress({
      total: graphEvents.length,
      completed: 0,
      stage: 'processing',
      message: `Processing ${graphEvents.length} events...`
    })

    // Separate deleted events from valid events
    const deletedEvents = graphEvents.filter(event => event['@removed'])
    const validEvents = graphEvents.filter(event => {
      if (event['@removed']) {
        return false
      }
      if (!event.subject && !event.start && !event.end) {
        console.log('Skipping invalid event:', event)
        return false
      }
      return true
    })

    // Handle deleted events in differential sync
    let deletedCount = 0
    if (mode === 'differential' && deletedEvents.length > 0) {
      for (const deletedEvent of deletedEvents) {
        try {
          // Find the local event by graph_id and delete it
          const localEvents = await this.getLocalEvents()
          const localEvent = localEvents.find(event => event.graph_id === deletedEvent.id)
          if (localEvent && localEvent.id && window.electronAPI) {
            await window.electronAPI.deleteEvent(localEvent.id)
            deletedCount++
          }
        } catch (error) {
          console.error('Failed to delete event:', deletedEvent.id, error)
        }
      }
    }
    
    this.updateProgress({
      total: validEvents.length,
      completed: 0,
      stage: 'saving',
      message: 'Saving events to database...'
    })

    // Sync with database via Electron API
    if (!window.electronAPI) {
      throw new Error('Electron API not available')
    }

    const syncResult = await window.electronAPI.syncGraphEvents(validEvents)

    // Handle deletions for full sync
    if (mode === 'full') {
      this.updateProgress({
        total: validEvents.length,
        completed: validEvents.length,
        stage: 'cleaning',
        message: 'Cleaning up deleted events...'
      })
      
      const fullSyncDeletedCount = await this.cleanupDeletedEvents(validEvents)
      deletedCount += fullSyncDeletedCount
    }

    this.completeSync({
      success: true,
      message: `Successfully synced ${syncResult.synced} events.`,
      mode,
      stats: {
        created: syncResult.created || 0,
        updated: syncResult.updated || 0,
        deleted: deletedCount,
        total: syncResult.synced
      }
    })
  }

  private async cleanupEventsInDateRange(currentGraphEvents: GraphEvent[], dateRange: DateRange): Promise<number> {
    try {
      const localEvents = await this.getLocalEvents()
      const graphIds = new Set(currentGraphEvents.map(e => e.id))
      
      // Only consider local events that fall within the sync date range
      const eventsInRangeToDelete = localEvents.filter(event => {
        // Check if event is in the date range
        const eventStart = dayjs(event.start_date)
        const rangeStart = dayjs(dateRange.start)
        const rangeEnd = dayjs(dateRange.end)
        
        const isInRange = eventStart.isBetween(rangeStart, rangeEnd, null, '[]')
        
        // Only delete if: in range, has graph_id, and not in current graph events
        return isInRange && event.graph_id && !graphIds.has(event.graph_id)
      })

      let deletedCount = 0
      for (const event of eventsInRangeToDelete) {
        if (event.id && window.electronAPI) {
          await window.electronAPI.deleteEvent(event.id)
          deletedCount++
        }
      }

      return deletedCount
    } catch (error) {
      console.error('Error cleaning up events in date range:', error)
      return 0
    }
  }

  private async cleanupDeletedEvents(currentGraphEvents: GraphEvent[]): Promise<number> {
    try {
      const localEvents = await this.getLocalEvents()
      const graphIds = new Set(currentGraphEvents.map(e => e.id))
      
      const eventsToDelete = localEvents.filter(event => 
        event.graph_id && !graphIds.has(event.graph_id)
      )

      let deletedCount = 0
      for (const event of eventsToDelete) {
        if (event.id && window.electronAPI) {
          await window.electronAPI.deleteEvent(event.id)
          deletedCount++
        }
      }

      return deletedCount
    } catch (error) {
      console.error('Error cleaning up deleted events:', error)
      return 0
    }
  }

  private async calculateDateRange(config: SyncConfig): Promise<DateRange> {
    const userTimezone = await storageService.getTimezone()
    const start = dayjs.tz(config.startDate, userTimezone).startOf('day')
    const end = dayjs.tz(config.endDate, userTimezone).endOf('day')
    
    return {
      start: start.toISOString(),
      end: end.toISOString()
    }
  }

  private transformGraphEventToLocal(graphEvent: GraphEvent): Event {
    return {
      graph_id: graphEvent.id,
      title: graphEvent.subject || 'Untitled Event',
      description: graphEvent.body?.content || '',
      start_date: graphEvent.start?.dateTime || new Date().toISOString(),
      end_date: graphEvent.end?.dateTime || new Date().toISOString(),
      is_all_day: graphEvent.isAllDay || false,
      show_as: graphEvent.showAs || 'busy',
      categories: graphEvent.categories?.join(',') || '',
      synced_at: new Date().toISOString()
    }
  }

  private extractDeltaToken(response: any): string | undefined {
    // Extract delta token from @odata.deltaLink
    const deltaLink = response['@odata.deltaLink']
    if (deltaLink) {
      const url = new URL(deltaLink)
      return url.searchParams.get('$deltatoken') || undefined
    }
    return undefined
  }

  private getLatestEventModified(events: GraphEvent[]): string | undefined {
    if (events.length === 0) return undefined
    
    // Events should already be sorted by lastModifiedDateTime desc from Graph
    const latestEvent = events.find(event => event['lastModifiedDateTime'])
    return latestEvent?.['lastModifiedDateTime'] || new Date().toISOString()
  }

  // Utility methods
  async getLocalEvents(): Promise<Event[]> {
    try {
      if (window.electronAPI) {
        return await window.electronAPI.getEvents()
      } else {
        throw new Error('Electron API not available')
      }
    } catch (error) {
      console.error('Error fetching local events:', error)
      return []
    }
  }

  async getCurrentSyncConfig(): Promise<SyncConfig> {
    const stored = await storageService.getSyncConfig()
    // Always use current defaults to ensure dates are relative to today
    return this.getDefaultSyncConfig()
  }

  async setSyncConfig(config: SyncConfig): Promise<void> {
    if (this.validateSyncConfig(config)) {
      await storageService.setSyncConfig(config)
    } else {
      throw new Error('Invalid sync configuration')
    }
  }

  getDefaultSyncConfig(): SyncConfig {
    return { ...this.defaultSyncConfig }
  }

  validateSyncConfig(config: SyncConfig): boolean {
    const startDate = dayjs(config.startDate)
    const endDate = dayjs(config.endDate)
    
    return (
      typeof config.startDate === 'string' &&
      typeof config.endDate === 'string' &&
      startDate.isValid() &&
      endDate.isValid() &&
      startDate.isBefore(endDate) &&
      endDate.diff(startDate, 'days') <= 365 // Max 365 day range
    )
  }

  async getSyncStatus(): Promise<{
    isActive: boolean
    lastSync?: string
    canSync: boolean
  }> {
    const metadata = await this.getSyncMetadata()
    const lastSync = metadata?.lastSyncTime && 
                     metadata.lastSyncTime !== null && 
                     metadata.lastSyncTime.trim() !== '' ? metadata.lastSyncTime : undefined
    return {
      isActive: this.syncInProgress,
      lastSync,
      canSync: this.isOnline() && !this.syncInProgress
    }
  }
}

export const calendarService = new CalendarService()