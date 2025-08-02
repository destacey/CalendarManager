const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');

let mainWindow;
let db;

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
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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
            ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:3000 ws://localhost:3000; img-src 'self' data: blob:; font-src 'self' data:;"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';"
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
  initDatabase();
  createWindow();
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
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO events (graph_id, title, description, start_date, end_date, is_all_day, show_as, categories, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const transaction = db.transaction((events) => {
    for (const graphEvent of events) {
      const categories = graphEvent.categories ? graphEvent.categories.join(',') : '';
      const description = graphEvent.body ? graphEvent.body.content : '';
      
      insertStmt.run(
        graphEvent.id,
        graphEvent.subject,
        description,
        graphEvent.start.dateTime,
        graphEvent.end.dateTime,
        graphEvent.isAllDay ? 1 : 0,
        graphEvent.showAs,
        categories
      );
    }
  });

  transaction(graphEvents);
  return { synced: graphEvents.length };
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