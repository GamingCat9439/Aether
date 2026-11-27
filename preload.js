'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel) {
  return (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('api', {
  askAssistant: request => ipcRenderer.invoke('assistant:ask', request),
  cancelAssistant: () => ipcRenderer.invoke('assistant:cancel'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config) => ipcRenderer.invoke('config:set', config),
  resetConfig: () => ipcRenderer.invoke('config:reset'),

  getSession: () => ipcRenderer.invoke('session:get'),
  setSession: (session) => ipcRenderer.invoke('session:set', session),

  getScripts: () => ipcRenderer.invoke('scripts:get'),
  setScripts: (scripts) => ipcRenderer.invoke('scripts:set', scripts),

  getUser: () => ipcRenderer.invoke('user:get'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  openDataFolder: () => ipcRenderer.invoke('app:open-data'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-updates'),
  downloadUpdate: () => ipcRenderer.invoke('app:download-update'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),

  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),

  fetchHub: (request) => ipcRenderer.invoke('hub:fetch', request),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),

  run: (payload) => ipcRenderer.invoke('exec:run', payload),

  getBridge: () => ipcRenderer.invoke('bridge:get'),
  getLoader: (port) => ipcRenderer.invoke('bridge:loader', port),
  setBridge: (settings) => ipcRenderer.invoke('bridge:set', settings),
  disconnectClient: (id) => ipcRenderer.invoke('bridge:disconnect', id),
  disconnectAll: () => ipcRenderer.invoke('bridge:disconnect-all'),

  minimize: () => ipcRenderer.send('win:min'),
  maximize: () => ipcRenderer.send('win:max'),
  close: () => ipcRenderer.send('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:is-maximized'),

  onClients: subscribe('bridge:clients'),
  onLog: subscribe('bridge:log'),
  onBridgeState: subscribe('bridge:state'),
  onWindowState: subscribe('win:state'),
  onUpdateStatus: subscribe('app:update-status'),
});
