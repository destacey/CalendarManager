const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');
const Store = require('electron-store').default || require('electron-store');

let mainWindow;
let db;
let store;

function initStore() {
  const schema = {
    appRegistrationId: {
      type: ['string', 'null'],
      default: null
    },
    syncConfig: {
      type: 'object',
      properties: {
        startDate: { type: 'string' },
        endDate: { type: 'string' }
      },
      default: {
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0]
      }
    },
    syncMetadata: {
      type: 'object',
      properties: {
        deltaToken: { type: 'string' },
        lastEventModified: { type: 'string' }
      },
      default: {}
    },
    timezone: {
      type: ['string', 'null'],
      default: null
    }
  };

  store = new Store({
    schema,
    clearInvalidConfig: true
  });

  // Migrate existing localStorage data if any exists
  const legacyConfigKey = 'calendar-manager-config';
  if (typeof localStorage !== 'undefined') {
    try {
      const legacyConfig = localStorage.getItem(legacyConfigKey);
      if (legacyConfig) {
        const parsed = JSON.parse(legacyConfig);
        if (parsed.appRegistrationId) store.set('appRegistrationId', parsed.appRegistrationId);
        if (parsed.syncConfig) store.set('syncConfig', parsed.syncConfig);
        if (parsed.syncMetadata) store.set('syncMetadata', parsed.syncMetadata);
        if (parsed.timezone) store.set('timezone', parsed.timezone);
        localStorage.removeItem(legacyConfigKey);
      }
    } catch (error) {
      console.warn('Failed to migrate legacy config:', error);
    }
  }
}

function initDatabase() {
  const dbPath = path.join(__dirname, '..', 'calendar.db');
  db = new Database(dbPath);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      graph_id TEXT UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      start_date TEXT NOT NULL,
      end_date TEXT,
      is_all_day BOOLEAN DEFAULT 0,
      show_as TEXT DEFAULT 'busy',
      categories TEXT,
      location TEXT,
      organizer TEXT,
      attendees TEXT,
      is_meeting BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      synced_at DATETIME
    );
    
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#1890ff',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_events_graph_id ON events(graph_id);
    CREATE INDEX IF NOT EXISTS idx_events_start_date ON events(start_date);
  `);

  // Add migration for new columns (safe to run multiple times)
  try {
    db.exec(`
      ALTER TABLE events ADD COLUMN location TEXT;
    `);
  } catch (e) {
    // Column already exists, ignore error
  }
  
  try {
    db.exec(`
      ALTER TABLE events ADD COLUMN organizer TEXT;
    `);
  } catch (e) {
    // Column already exists, ignore error
  }
  
  try {
    db.exec(`
      ALTER TABLE events ADD COLUMN attendees TEXT;
    `);
  } catch (e) {
    // Column already exists, ignore error
  }
  
  try {
    db.exec(`
      ALTER TABLE events ADD COLUMN is_meeting BOOLEAN DEFAULT 0;
    `);
  } catch (e) {
    // Column already exists, ignore error
  }
  
  // Add event types table
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#1890ff',
      is_default BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // Add event type rules table
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_type_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      priority INTEGER NOT NULL,
      field_name TEXT NOT NULL,
      operator TEXT NOT NULL,
      value TEXT,
      target_type_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(target_type_id) REFERENCES event_types(id)
    );
  `);
  
  // Add event type columns to events table
  try {
    db.exec(`
      ALTER TABLE events ADD COLUMN type_id INTEGER REFERENCES event_types(id);
    `);
  } catch (e) {
    // Column already exists, ignore error
  }
  
  try {
    db.exec(`
      ALTER TABLE events ADD COLUMN type_manually_set BOOLEAN DEFAULT 0;
    `);
  } catch (e) {
    // Column already exists, ignore error
  }
  
  // Create default "Work" event type if none exist
  const existingTypes = db.prepare('SELECT COUNT(*) as count FROM event_types').get();
  if (existingTypes.count === 0) {
    db.prepare(`
      INSERT INTO event_types (name, color, is_default)
      VALUES (?, ?, ?)
    `).run('Work', '#52c41a', 1);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Set Content Security Policy
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          process.env.NODE_ENV === 'development' 
            ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:3000 ws://localhost:3000 https://login.microsoftonline.com https://login.live.com https://aadcdn.msauth.net https://aadcdn.msftauth.net; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:3000 https://login.microsoftonline.com https://login.live.com https://aadcdn.msauth.net https://aadcdn.msftauth.net; style-src 'self' 'unsafe-inline' https://aadcdn.msauth.net https://aadcdn.msftauth.net; img-src 'self' data: blob: https://aadcdn.msauth.net https://aadcdn.msftauth.net https://login.live.com; font-src 'self' data: https://aadcdn.msauth.net https://aadcdn.msftauth.net; connect-src 'self' ws://localhost:3000 https://login.microsoftonline.com https://graph.microsoft.com https://login.live.com;"
            : "default-src 'self' https://login.microsoftonline.com https://login.live.com https://aadcdn.msauth.net https://aadcdn.msftauth.net; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://login.microsoftonline.com https://login.live.com https://aadcdn.msauth.net https://aadcdn.msftauth.net; style-src 'self' 'unsafe-inline' https://aadcdn.msauth.net https://aadcdn.msftauth.net; img-src 'self' data: blob: https://aadcdn.msauth.net https://aadcdn.msftauth.net https://login.live.com; font-src 'self' data: https://aadcdn.msauth.net https://aadcdn.msftauth.net; connect-src 'self' https://login.microsoftonline.com https://graph.microsoft.com https://login.live.com;"
        ]
      }
    });
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  initStore();
  initDatabase();
  createWindow();
  setupWindowStateEvents();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers for database operations
ipcMain.handle('db:getEvents', () => {
  const stmt = db.prepare('SELECT * FROM events ORDER BY start_date');
  const events = stmt.all();
  // Convert SQLite integers to booleans for boolean fields
  return events.map(event => ({
    ...event,
    is_all_day: Boolean(event.is_all_day),
    is_meeting: Boolean(event.is_meeting),
    type_manually_set: Boolean(event.type_manually_set)
  }));
});

// Optimized handler for getting events within a date range
ipcMain.handle('db:getEventsInRange', (event, startDate, endDate) => {
  try {
    const stmt = db.prepare(`
      SELECT * FROM events 
      WHERE (
        -- Event starts within range
        (start_date >= ? AND start_date <= ?) OR
        -- Event ends within range  
        (end_date >= ? AND end_date <= ?) OR
        -- Event spans the entire range
        (start_date <= ? AND end_date >= ?)
      )
      ORDER BY start_date
    `);
    const results = stmt.all(startDate, endDate, startDate, endDate, startDate, endDate);
    // Convert SQLite integers to booleans for boolean fields
    return results.map(event => ({
      ...event,
      is_all_day: Boolean(event.is_all_day),
      is_meeting: Boolean(event.is_meeting),
      type_manually_set: Boolean(event.type_manually_set)
    }));
  } catch (error) {
    console.error('Database query error:', error);
    return [];
  }
});

ipcMain.handle('db:createEvent', (event, eventData) => {
  const stmt = db.prepare(`
    INSERT INTO events (graph_id, title, description, start_date, end_date, is_all_day, show_as, categories)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    eventData.graph_id, 
    eventData.title, 
    eventData.description, 
    eventData.start_date, 
    eventData.end_date, 
    eventData.is_all_day, 
    eventData.show_as, 
    eventData.categories
  );
  return { id: result.lastInsertRowid, ...eventData };
});

ipcMain.handle('db:updateEvent', (event, id, eventData) => {
  const stmt = db.prepare(`
    UPDATE events 
    SET title = ?, description = ?, start_date = ?, end_date = ?, is_all_day = ?, show_as = ?, categories = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(
    eventData.title, 
    eventData.description, 
    eventData.start_date, 
    eventData.end_date, 
    eventData.is_all_day, 
    eventData.show_as, 
    eventData.categories, 
    id
  );
  return { id, ...eventData };
});

ipcMain.handle('db:deleteEvent', (event, id) => {
  const stmt = db.prepare('DELETE FROM events WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
});

// Microsoft Graph sync functionality
ipcMain.handle('db:syncGraphEvents', (event, graphEvents) => {
  const checkExistingStmt = db.prepare('SELECT id, type_manually_set FROM events WHERE graph_id = ?');
  const insertStmt = db.prepare(`
    INSERT INTO events (graph_id, title, description, start_date, end_date, is_all_day, show_as, categories, location, organizer, attendees, is_meeting, type_id, type_manually_set, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const updateStmt = db.prepare(`
    UPDATE events 
    SET title = ?, description = ?, start_date = ?, end_date = ?, is_all_day = ?, show_as = ?, categories = ?, location = ?, organizer = ?, attendees = ?, is_meeting = ?, type_id = ?, synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE graph_id = ?
  `);
  const updateStmtWithoutType = db.prepare(`
    UPDATE events 
    SET title = ?, description = ?, start_date = ?, end_date = ?, is_all_day = ?, show_as = ?, categories = ?, location = ?, organizer = ?, attendees = ?, is_meeting = ?, synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE graph_id = ?
  `);

  let createdCount = 0;
  let updatedCount = 0;

  const transaction = db.transaction((events) => {
    for (const graphEvent of events) {
      const categories = graphEvent.categories ? graphEvent.categories.join(',') : '';
      const description = graphEvent.body ? graphEvent.body.content : '';
      const location = graphEvent.location ? graphEvent.location.displayName : '';
      const organizer = graphEvent.organizer ? JSON.stringify({
        name: graphEvent.organizer.emailAddress.name,
        email: graphEvent.organizer.emailAddress.address
      }) : '';
      const attendees = graphEvent.attendees ? JSON.stringify(
        graphEvent.attendees.map(att => ({
          name: att.emailAddress.name,
          email: att.emailAddress.address,
          response: att.status.response
        }))
      ) : '';
      const isMeeting = graphEvent.attendees && graphEvent.attendees.length > 0 ? 1 : 0;
      
      // Create event data for type evaluation
      const eventData = {
        title: graphEvent.subject || 'Untitled Event',
        is_all_day: graphEvent.isAllDay || false,
        show_as: graphEvent.showAs || 'busy',
        categories: categories
      };
      
      // Check if event already exists
      const existingEvent = checkExistingStmt.get(graphEvent.id);
      
      if (existingEvent) {
        // Update existing event - only update type if not manually set
        if (existingEvent.type_manually_set) {
          // Use the update statement without type change
          updateStmtWithoutType.run(
            graphEvent.subject || 'Untitled Event',
            description,
            graphEvent.start?.dateTime || new Date().toISOString(),
            graphEvent.end?.dateTime || new Date().toISOString(),
            graphEvent.isAllDay ? 1 : 0,
            graphEvent.showAs || 'busy',
            categories,
            location,
            organizer,
            attendees,
            isMeeting,
            graphEvent.id
          );
        } else {
          // Evaluate type and update
          const evaluatedTypeId = evaluateEventTypeSync(eventData);
          updateStmt.run(
            graphEvent.subject || 'Untitled Event',
            description,
            graphEvent.start?.dateTime || new Date().toISOString(),
            graphEvent.end?.dateTime || new Date().toISOString(),
            graphEvent.isAllDay ? 1 : 0,
            graphEvent.showAs || 'busy',
            categories,
            location,
            organizer,
            attendees,
            isMeeting,
            evaluatedTypeId,
            graphEvent.id
          );
        }
        updatedCount++;
      } else {
        // Insert new event with type evaluation
        const evaluatedTypeId = evaluateEventTypeSync(eventData);
        insertStmt.run(
          graphEvent.id,
          graphEvent.subject || 'Untitled Event',
          description,
          graphEvent.start?.dateTime || new Date().toISOString(),
          graphEvent.end?.dateTime || new Date().toISOString(),
          graphEvent.isAllDay ? 1 : 0,
          graphEvent.showAs || 'busy',
          categories,
          location,
          organizer,
          attendees,
          isMeeting,
          evaluatedTypeId,
          0 // type_manually_set = false for new events
        );
        createdCount++;
      }
    }
  });

  transaction(graphEvents);
  
  return { 
    synced: graphEvents.length,
    created: createdCount,
    updated: updatedCount
  };
});

// Categories management
ipcMain.handle('db:getCategories', () => {
  const stmt = db.prepare('SELECT * FROM categories ORDER BY name');
  return stmt.all();
});

ipcMain.handle('db:createCategory', (event, categoryData) => {
  const stmt = db.prepare(`
    INSERT INTO categories (name, color)
    VALUES (?, ?)
  `);
  const result = stmt.run(categoryData.name, categoryData.color);
  return { id: result.lastInsertRowid, ...categoryData };
});

// Event Types management
ipcMain.handle('db:getEventTypes', () => {
  const stmt = db.prepare('SELECT * FROM event_types ORDER BY name');
  const types = stmt.all();
  // Convert SQLite integers to booleans
  return types.map(type => ({
    ...type,
    is_default: Boolean(type.is_default)
  }));
});

ipcMain.handle('db:createEventType', (event, eventTypeData) => {
  const stmt = db.prepare(`
    INSERT INTO event_types (name, color, is_default)
    VALUES (?, ?, ?)
  `);
  const result = stmt.run(
    eventTypeData.name, 
    eventTypeData.color, 
    eventTypeData.is_default ? 1 : 0
  );
  return { 
    id: result.lastInsertRowid, 
    ...eventTypeData,
    is_default: Boolean(eventTypeData.is_default)
  };
});

ipcMain.handle('db:updateEventType', (event, id, eventTypeData) => {
  const stmt = db.prepare(`
    UPDATE event_types 
    SET name = ?, color = ?, is_default = ?
    WHERE id = ?
  `);
  const result = stmt.run(
    eventTypeData.name, 
    eventTypeData.color, 
    eventTypeData.is_default ? 1 : 0, 
    id
  );
  return result.changes > 0 ? { 
    id, 
    ...eventTypeData,
    is_default: Boolean(eventTypeData.is_default)
  } : null;
});

ipcMain.handle('db:deleteEventType', (event, id) => {
  const stmt = db.prepare('DELETE FROM event_types WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
});

// Event Type Rules management
ipcMain.handle('db:getEventTypeRules', () => {
  const stmt = db.prepare('SELECT * FROM event_type_rules ORDER BY priority ASC');
  return stmt.all();
});

ipcMain.handle('db:createEventTypeRule', (event, ruleData) => {
  const stmt = db.prepare(`
    INSERT INTO event_type_rules (name, priority, field_name, operator, value, target_type_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    ruleData.name, 
    ruleData.priority, 
    ruleData.field_name, 
    ruleData.operator, 
    ruleData.value, 
    ruleData.target_type_id
  );
  return { id: result.lastInsertRowid, ...ruleData };
});

ipcMain.handle('db:updateEventTypeRule', (event, id, ruleData) => {
  const stmt = db.prepare(`
    UPDATE event_type_rules 
    SET name = ?, priority = ?, field_name = ?, operator = ?, value = ?, target_type_id = ?
    WHERE id = ?
  `);
  const result = stmt.run(
    ruleData.name, 
    ruleData.priority, 
    ruleData.field_name, 
    ruleData.operator, 
    ruleData.value, 
    ruleData.target_type_id,
    id
  );
  return result.changes > 0 ? { id, ...ruleData } : null;
});

ipcMain.handle('db:deleteEventTypeRule', (event, id) => {
  const stmt = db.prepare('DELETE FROM event_type_rules WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
});

ipcMain.handle('db:updateRulePriorities', (event, ruleIds) => {
  const updateStmt = db.prepare('UPDATE event_type_rules SET priority = ? WHERE id = ?');
  const transaction = db.transaction((ruleIds) => {
    ruleIds.forEach((ruleId, index) => {
      updateStmt.run(index + 1, ruleId);
    });
  });
  try {
    transaction(ruleIds);
    return true;
  } catch (error) {
    console.error('Error updating rule priorities:', error);
    return false;
  }
});

// Event type assignment
ipcMain.handle('db:evaluateEventType', (event, eventData) => {
  // Get all rules ordered by priority
  const rulesStmt = db.prepare('SELECT * FROM event_type_rules ORDER BY priority ASC');
  const rules = rulesStmt.all();
  
  // Get default type
  const defaultTypeStmt = db.prepare('SELECT id FROM event_types WHERE is_default = 1 LIMIT 1');
  const defaultType = defaultTypeStmt.get();
  
  // Evaluate each rule in order
  for (const rule of rules) {
    if (evaluateRule(rule, eventData)) {
      return rule.target_type_id;
    }
  }
  
  // Return default type if no rules match
  return defaultType ? defaultType.id : null;
});

ipcMain.handle('db:setEventTypeManually', (event, eventId, typeId) => {
  const stmt = db.prepare(`
    UPDATE events 
    SET type_id = ?, type_manually_set = 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  const result = stmt.run(typeId, eventId);
  return result.changes > 0;
});

ipcMain.handle('db:reprocessEventTypes', () => {
  try {
    // Get all events that are not manually set
    const eventsStmt = db.prepare('SELECT * FROM events WHERE type_manually_set = 0 OR type_manually_set IS NULL');
    const events = eventsStmt.all();
    
    // Update statement for events
    const updateStmt = db.prepare(`
      UPDATE events 
      SET type_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    
    let processedCount = 0;
    let updatedCount = 0;
    
    const transaction = db.transaction((events) => {
      for (const event of events) {
        const eventData = {
          title: event.title || '',
          is_all_day: Boolean(event.is_all_day),
          show_as: event.show_as || '',
          categories: event.categories || ''
        };
        
        const newTypeId = evaluateEventTypeSync(eventData);
        processedCount++;
        
        // Only update if the type has actually changed
        if (newTypeId !== event.type_id) {
          updateStmt.run(newTypeId, event.id);
          updatedCount++;
        }
      }
    });
    
    transaction(events);
    
    return {
      success: true,
      processedCount,
      updatedCount,
      message: `Processed ${processedCount} events, updated ${updatedCount} event types`
    };
  } catch (error) {
    console.error('Error reprocessing event types:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to reprocess event types'
    };
  }
});

// Rule evaluation helper function
function evaluateRule(rule, eventData) {
  let fieldValue;
  
  switch (rule.field_name) {
    case 'title':
      fieldValue = eventData.title || '';
      break;
    case 'is_all_day':
      fieldValue = eventData.is_all_day ? 'true' : 'false';
      break;
    case 'show_as':
      fieldValue = eventData.show_as || '';
      break;
    case 'categories':
      fieldValue = eventData.categories || '';
      break;
    default:
      return false;
  }
  
  switch (rule.operator) {
    case 'equals':
      return fieldValue === (rule.value || '');
    case 'contains':
      return fieldValue.toLowerCase().includes((rule.value || '').toLowerCase());
    case 'is_empty':
      return !fieldValue || fieldValue.trim() === '';
    default:
      return false;
  }
}

// Synchronous version for use within transactions
function evaluateEventTypeSync(eventData) {
  try {
    // Get all rules ordered by priority
    const rulesStmt = db.prepare('SELECT * FROM event_type_rules ORDER BY priority ASC');
    const rules = rulesStmt.all();
    
    // Get default type
    const defaultTypeStmt = db.prepare('SELECT id FROM event_types WHERE is_default = 1 LIMIT 1');
    const defaultType = defaultTypeStmt.get();
    
    // Evaluate each rule in order
    for (const rule of rules) {
      const matches = evaluateRule(rule, eventData);
      
      if (matches) {
        return rule.target_type_id;
      }
    }
    
    // Return default type if no rules match
    const defaultId = defaultType ? defaultType.id : null;
    return defaultId;
  } catch (error) {
    console.warn('Failed to evaluate event type:', error);
    return null;
  }
}

// Window controls
ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.restore();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

ipcMain.handle('window:isMaximized', () => {
  return mainWindow?.isMaximized() || false;
});

// Configuration management with electron-store
ipcMain.handle('config:get', (event, key) => {
  return store.get(key);
});

ipcMain.handle('config:set', (event, key, value) => {
  store.set(key, value);
});

ipcMain.handle('config:clear', () => {
  store.clear();
});

// Window state change events
function setupWindowStateEvents() {
  if (mainWindow) {
    mainWindow.on('maximize', () => {
      mainWindow.webContents.send('window-state-change', true);
    });
    
    mainWindow.on('unmaximize', () => {
      mainWindow.webContents.send('window-state-change', false);
    });
  }
}