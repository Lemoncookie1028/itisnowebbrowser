const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browser', {
  resolveRoute:   (url) => ipcRenderer.invoke('route:resolve', url),

  torStatus:      ()    => ipcRenderer.invoke('tor:status'),
  torRestart:     ()    => ipcRenderer.invoke('tor:restart'),
  onTorStatus:    (cb)  => ipcRenderer.on('tor:status',    (_e, s) => cb(s)),

  psiphonStatus:  ()    => ipcRenderer.invoke('psiphon:status'),
  psiphonStart:   ()    => ipcRenderer.invoke('psiphon:start'),
  psiphonStop:    ()    => ipcRenderer.invoke('psiphon:stop'),
  onPsiphonStatus:(cb)  => ipcRenderer.on('psiphon:status', (_e, s) => cb(s)),

  getPrefs:       ()    => ipcRenderer.invoke('prefs:get'),
  setPrefs:       (p)   => ipcRenderer.invoke('prefs:set', p),

  getVpnConfig:   ()    => ipcRenderer.invoke('vpn:getConfig'),
  setVpnConfig:   (cfg) => ipcRenderer.invoke('vpn:setConfig', cfg),
  listVpnSites:   ()    => ipcRenderer.invoke('vpn:listSites'),
  addVpnSite:     (d)   => ipcRenderer.invoke('vpn:addSite', d),
  removeVpnSite:  (d)   => ipcRenderer.invoke('vpn:removeSite', d),

  getTheme:       ()    => ipcRenderer.invoke('theme:get'),
  setTheme:       (t)   => ipcRenderer.invoke('theme:set', t),

  showContextMenu:     (p)  => ipcRenderer.send('context-menu:show', p),
  onContextMenuAction: (cb) => ipcRenderer.on('context-menu:action', (_e, a) => cb(a)),

  onOpenNewTab:   (cb)  => ipcRenderer.on('tab:openNewTab', (_e, url) => cb(url)),
  onNavigate:     (cb)  => ipcRenderer.on('navigate:url',   (_e, d)   => cb(d)),

  navigateNewWindow: (url) => ipcRenderer.send('navigate:newWindow', url),
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close:    () => ipcRenderer.send('win:close')
});
