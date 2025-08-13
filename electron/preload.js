const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Database operations
  getEvents: () => ipcRenderer.invoke('db:getEvents'),
  createEvent: (eventData) => ipcRenderer.invoke('db:createEvent', eventData),
  updateEvent: (id, eventData) => ipcRenderer.invoke('db:updateEvent', id, eventData),
  deleteEvent: (id) => ipcRenderer.invoke('db:deleteEvent', id),
  
  // Microsoft Graph sync
  syncGraphEvents: (events) => ipcRenderer.invoke('db:syncGraphEvents', events),
  
  // Category management
  getCategories: () => ipcRenderer.invoke('db:getCategories'),
  createCategory: (categoryData) => ipcRenderer.invoke('db:createCategory', categoryData),
  
  // File operations
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (content) => ipcRenderer.invoke('dialog:saveFile', content),
  onMenuAction: (callback) => ipcRenderer.on('menu-action', callback),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onWindowStateChange: (callback) => ipcRenderer.on('window-state-change', callback)
});