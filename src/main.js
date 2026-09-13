const { app, BrowserWindow, session, ipcMain, Menu, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const torManager     = require('./tor-manager');
const psiphonManager = require('./psiphon-manager');

// ── Config paths ──────────────────────────────────────────────────────────────
const VPN_SITES_FILE  = () => path.join(app.getPath('userData'), 'vpn-sites.json');
const VPN_CONFIG_FILE = () => path.join(app.getPath('userData'), 'vpn-config.json');
const THEME_FILE      = () => path.join(app.getPath('userData'), 'theme-config.json');
const PREFS_FILE      = () => path.join(app.getPath('userData'), 'prefs.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (_) { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function loadVpnSites()  { return readJson(VPN_SITES_FILE(),  { sites: [] }).sites; }
function loadVpnConfig() { return readJson(VPN_CONFIG_FILE(), { enabled: false, host: '', port: '', user: '', pass: '', protocol: 'socks5' }); }
function loadTheme()     { return readJson(THEME_FILE(),      { theme: 'dark' }); }
function loadPrefs()     { return readJson(PREFS_FILE(),      { torAll: false, psiphonEnabled: false }); }

function isOnion(hostname)   { return hostname.endsWith('.onion'); }
function isVpnOnly(hostname) { return loadVpnSites().some(d => hostname === d || hostname.endsWith('.' + d)); }

// ── Sessions ──────────────────────────────────────────────────────────────────
async function configureSession(mode) {
  const vpnCfg = loadVpnConfig();
  const prefs  = loadPrefs();
  const ses    = session.fromPartition(`persist:${mode}`);

  if (mode === 'tor' || mode === 'vpn+tor') {
    await ses.setProxy({ proxyRules: torManager.socksProxy });
  } else if (mode === 'vpn') {
    if (vpnCfg.enabled && vpnCfg.host && vpnCfg.port) {
      await ses.setProxy({ proxyRules: `${vpnCfg.protocol}://${vpnCfg.host}:${vpnCfg.port}` });
    } else {
      await ses.setProxy({ proxyRules: 'direct://' });
    }
  } else if (mode === 'clearnet') {
    // tor-all: route clearnet through Tor
    if (prefs.torAll && torManager.running) {
      await ses.setProxy({ proxyRules: torManager.socksProxy });
    // psiphon: route clearnet through Psiphon
    } else if (prefs.psiphonEnabled && psiphonManager.running && psiphonManager.socksProxy) {
      await ses.setProxy({ proxyRules: psiphonManager.socksProxy });
    } else {
      await ses.setProxy({ proxyRules: 'direct://' });
    }
  }
}

async function reconfigureAllSessions() {
  await Promise.all(['clearnet','tor','vpn','vpn+tor'].map(configureSession));
}

// ── Window factory ────────────────────────────────────────────────────────────
let windowCount = 0;
const windows = new Set();

function broadcast(channel, data) {
  windows.forEach(w => { try { w.webContents.send(channel, data); } catch (_) {} });
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1400, height: 860, minWidth: 900, minHeight: 600,
    frame: false, backgroundColor: '#0a0c10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, webviewTag: true
    },
    show: false
  });
  windowCount++; windows.add(win);
  win.loadFile(path.join(__dirname, '..', 'index.html'));
  win.once('ready-to-show', () => { win.show(); if (url) win.webContents.send('tab:openNewTab', url); });
  win.on('closed', () => {
    windows.delete(win); windowCount--;
    if (windowCount === 0 && process.platform !== 'darwin') {
      torManager.stop(); psiphonManager.stop(); app.quit();
    }
  });
  return win;
}

// ── App ready ─────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  await reconfigureAllSessions();

  torManager.start(app);
  torManager.on('status', async (s) => {
    broadcast('tor:status', s);
    // Reconfigure clearnet session when Tor connects/disconnects (tor-all mode)
    await configureSession('clearnet');
  });

  psiphonManager.on('status', async (s) => {
    broadcast('psiphon:status', s);
    await configureSession('clearnet');
  });

  // Start Psiphon if it was enabled last session
  if (loadPrefs().psiphonEnabled) psiphonManager.start(app);

  // Intercept new-window from webviews → new tab
  app.on('web-contents-created', (_evt, contents) => {
    if (contents.getType() === 'webview') {
      contents.setWindowOpenHandler(({ url }) => {
        const owner = contents.getOwnerBrowserWindow();
        if (owner && !owner.isDestroyed()) owner.webContents.send('tab:openNewTab', url);
        return { action: 'deny' };
      });
    }
  });

  createWindow();
});

app.on('window-all-closed', () => {
  torManager.stop(); psiphonManager.stop();
  if (process.platform !== 'darwin') app.quit();
});

// ── Window controls ───────────────────────────────────────────────────────────
ipcMain.on('win:minimize', e => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.on('win:maximize', e => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.isMaximized() ? w.unmaximize() : w.maximize(); });
ipcMain.on('win:close',    e => BrowserWindow.fromWebContents(e.sender)?.close());

// ── Navigation ────────────────────────────────────────────────────────────────
ipcMain.on('navigate:newWindow', (_evt, url) => createWindow(url));

// ── Routing ───────────────────────────────────────────────────────────────────
ipcMain.handle('route:resolve', async (_evt, urlString) => {
  let hostname;
  try { hostname = new URL(urlString).hostname; } catch (_) { return { ok: false, error: 'invalid_url' }; }

  const onion    = isOnion(hostname);
  const vpnOnly  = isVpnOnly(hostname);
  const vpnCfg   = loadVpnConfig();
  const prefs    = loadPrefs();
  const vpnReady = vpnCfg.enabled && vpnCfg.host && vpnCfg.port;

  let mode;
  if (onion && vpnOnly)  mode = 'vpn+tor';
  else if (onion)        mode = 'tor';
  else if (vpnOnly)      mode = 'vpn';
  else                   mode = 'clearnet';

  if ((mode === 'vpn' || mode === 'vpn+tor') && !vpnReady)
    return { ok: false, error: 'vpn_required', hostname, mode };

  if ((mode === 'tor' || mode === 'vpn+tor') && !torManager.running)
    return { ok: false, error: 'tor_not_ready', bootstrap: torManager.bootstrapPct, hostname, mode };

  // tor-all: show mode as tor even for clearnet sites
  let displayMode = mode;
  if (mode === 'clearnet' && prefs.torAll && torManager.running)
    displayMode = 'tor-all';
  else if (mode === 'clearnet' && prefs.psiphonEnabled && psiphonManager.running)
    displayMode = 'psiphon';

  if (mode === 'vpn' || mode === 'vpn+tor') await configureSession(mode);

  return { ok: true, mode, displayMode, partition: `persist:${mode}`, hostname };
});

// ── Tor ───────────────────────────────────────────────────────────────────────
ipcMain.handle('tor:status',  ()     => torManager.getStatus());
ipcMain.handle('tor:restart', async () => { torManager.stop(); setTimeout(() => torManager.start(app), 800); return true; });

// ── Psiphon ───────────────────────────────────────────────────────────────────
ipcMain.handle('psiphon:status',  ()         => psiphonManager.getStatus());
ipcMain.handle('psiphon:start',   async ()   => { psiphonManager.start(app); return true; });
ipcMain.handle('psiphon:stop',    ()         => { psiphonManager.stop(); return true; });

// ── Prefs (tor-all, psiphon toggle) ──────────────────────────────────────────
ipcMain.handle('prefs:get', () => loadPrefs());
ipcMain.handle('prefs:set', async (_evt, patch) => {
  const prefs = { ...loadPrefs(), ...patch };
  writeJson(PREFS_FILE(), prefs);

  // Start/stop Psiphon based on toggle
  if (patch.psiphonEnabled !== undefined) {
    if (patch.psiphonEnabled && !psiphonManager.running) psiphonManager.start(app);
    else if (!patch.psiphonEnabled) psiphonManager.stop();
  }

  await configureSession('clearnet');
  return prefs;
});

// ── VPN ───────────────────────────────────────────────────────────────────────
ipcMain.handle('vpn:getConfig', () => loadVpnConfig());
ipcMain.handle('vpn:setConfig', async (_evt, cfg) => {
  writeJson(VPN_CONFIG_FILE(), cfg); await configureSession('vpn'); await configureSession('vpn+tor'); return cfg;
});
ipcMain.handle('vpn:listSites',  () => loadVpnSites());
ipcMain.handle('vpn:addSite', (_evt, domain) => {
  const sites = loadVpnSites();
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (clean && !sites.includes(clean)) sites.push(clean);
  writeJson(VPN_SITES_FILE(), { sites }); return sites;
});
ipcMain.handle('vpn:removeSite', (_evt, domain) => {
  const sites = loadVpnSites().filter(s => s !== domain);
  writeJson(VPN_SITES_FILE(), { sites }); return sites;
});

// ── Theme ─────────────────────────────────────────────────────────────────────
ipcMain.handle('theme:get', () => loadTheme());
ipcMain.handle('theme:set', (_evt, theme) => { writeJson(THEME_FILE(), { theme }); return { theme }; });

// ── Context menu ──────────────────────────────────────────────────────────────
ipcMain.on('context-menu:show', (event, params) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const items = [];

  if (params.linkURL) items.push(
    { label: 'Open link in new tab',    click: () => event.sender.send('context-menu:action', { action: 'open-tab',    url: params.linkURL }) },
    { label: 'Open link in new window', click: () => event.sender.send('context-menu:action', { action: 'open-window', url: params.linkURL }) },
    { label: 'Copy link address',       click: () => clipboard.writeText(params.linkURL) },
    { type: 'separator' }
  );
  if (params.srcURL && params.mediaType === 'image') items.push(
    { label: 'Copy image address',      click: () => clipboard.writeText(params.srcURL) },
    { label: 'Open image in new tab',   click: () => event.sender.send('context-menu:action', { action: 'open-tab', url: params.srcURL }) },
    { type: 'separator' }
  );
  if (params.selectionText?.trim()) items.push(
    { label: 'Copy',                    click: () => clipboard.writeText(params.selectionText) },
    { label: `Search "${params.selectionText.substring(0,20)}${params.selectionText.length>20?'…':''}"`,
      click: () => event.sender.send('context-menu:action', { action: 'open-tab', url: `https://duckduckgo.com/?q=${encodeURIComponent(params.selectionText)}` }) },
    { type: 'separator' }
  );
  if (params.isEditable) items.push(
    { label: 'Cut', role: 'cut' }, { label: 'Copy', role: 'copy' },
    { label: 'Paste', role: 'paste' }, { label: 'Select all', role: 'selectAll' },
    { type: 'separator' }
  );
  items.push(
    { label: 'Back',    click: () => event.sender.send('context-menu:action', { action: 'back' }) },
    { label: 'Forward', click: () => event.sender.send('context-menu:action', { action: 'forward' }) },
    { label: 'Reload',  click: () => event.sender.send('context-menu:action', { action: 'reload' }) },
    { type: 'separator' },
    { label: 'Open page in new tab',    click: () => event.sender.send('context-menu:action', { action: 'open-tab',    url: params.pageURL }) },
    { label: 'Open page in new window', click: () => event.sender.send('context-menu:action', { action: 'open-window', url: params.pageURL }) },
    { label: 'Copy page URL',           click: () => clipboard.writeText(params.pageURL) },
    { type: 'separator' },
    { label: 'Inspect element', click: () => event.sender.send('context-menu:action', { action: 'inspect', x: params.x, y: params.y }) }
  );
  Menu.buildFromTemplate(items).popup({ window: win });
});
