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
  return stmt.all();
});

// Optimized handler for getting events within a date range
ipcMain.handle('db:getEventsInRange', (event, startDate, endDate) => {
  try {
    console.log('Database query: getEventsInRange', startDate, 'to', endDate);
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
    console.log('Database query returned', results.length, 'events');
    return results;
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
  const checkExistingStmt = db.prepare('SELECT id FROM events WHERE graph_id = ?');
  const insertStmt = db.prepare(`
    INSERT INTO events (graph_id, title, description, start_date, end_date, is_all_day, show_as, categories, location, organizer, attendees, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const updateStmt = db.prepare(`
    UPDATE events 
    SET title = ?, description = ?, start_date = ?, end_date = ?, is_all_day = ?, show_as = ?, categories = ?, location = ?, organizer = ?, attendees = ?, synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
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
      
      // Check if event already exists
      const existingEvent = checkExistingStmt.get(graphEvent.id);
      
      if (existingEvent) {
        // Update existing event
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
          graphEvent.id
        );
        updatedCount++;
      } else {
        // Insert new event
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
          attendees
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