const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Database operations
  getEvents: () => ipcRenderer.invoke('db:getEvents'),
  getEventsInRange: (startDate, endDate) => ipcRenderer.invoke('db:getEventsInRange', startDate, endDate),
  createEvent: (eventData) => ipcRenderer.invoke('db:createEvent', eventData),
  updateEvent: (id, eventData) => ipcRenderer.invoke('db:updateEvent', id, eventData),
  deleteEvent: (id) => ipcRenderer.invoke('db:deleteEvent', id),
  
  // Microsoft Graph sync
  syncGraphEvents: (events) => ipcRenderer.invoke('db:syncGraphEvents', events),
  
  // Category management
  getCategories: () => ipcRenderer.invoke('db:getCategories'),
  createCategory: (categoryData) => ipcRenderer.invoke('db:createCategory', categoryData),
  
  // Event type management
  getEventTypes: () => ipcRenderer.invoke('db:getEventTypes'),
  createEventType: (eventTypeData) => ipcRenderer.invoke('db:createEventType', eventTypeData),
  updateEventType: (id, eventTypeData) => ipcRenderer.invoke('db:updateEventType', id, eventTypeData),
  deleteEventType: (id) => ipcRenderer.invoke('db:deleteEventType', id),
  
  // Event type rule management
  getEventTypeRules: () => ipcRenderer.invoke('db:getEventTypeRules'),
  createEventTypeRule: (ruleData) => ipcRenderer.invoke('db:createEventTypeRule', ruleData),
  updateEventTypeRule: (id, ruleData) => ipcRenderer.invoke('db:updateEventTypeRule', id, ruleData),
  deleteEventTypeRule: (id) => ipcRenderer.invoke('db:deleteEventTypeRule', id),
  updateRulePriorities: (ruleIds) => ipcRenderer.invoke('db:updateRulePriorities', ruleIds),
  
  // Event type assignment
  evaluateEventType: (eventData) => ipcRenderer.invoke('db:evaluateEventType', eventData),
  setEventTypeManually: (eventId, typeId) => ipcRenderer.invoke('db:setEventTypeManually', eventId, typeId),
  reprocessEventTypes: () => ipcRenderer.invoke('db:reprocessEventTypes'),
  
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
  onWindowStateChange: (callback) => ipcRenderer.on('window-state-change', callback),
  
  // Configuration management
  getConfig: (key) => ipcRenderer.invoke('config:get', key),
  setConfig: (key, value) => ipcRenderer.invoke('config:set', key, value),
  clearConfig: () => ipcRenderer.invoke('config:clear')
});