/* ── Tab state ───────────────────────────────────────────────────────────── */
let tabs = [];
let activeId = null;
let tabCounter = 0;
let currentTheme = 'dark';

const MODE_COLORS = {
  clearnet: 'var(--accent)',
  tor: 'var(--purple)',
  vpn: 'var(--amber)',
  'vpn+tor': 'var(--red)'
};
const MODE_LABELS = {
  clearnet: 'NORMAL',
  tor: 'TOR',
  vpn: 'VPN',
  'vpn+tor': 'VPN+TOR'
};

/* ── DOM refs ────────────────────────────────────────────────────────────── */
const tabbar      = document.getElementById('tabbar');
const newTabBtn   = document.getElementById('newTab');
const content     = document.getElementById('content');
const addrInput   = document.getElementById('addrInput');
const modePill    = document.getElementById('modePill');
const btnBack     = document.getElementById('btnBack');
const btnFwd      = document.getElementById('btnFwd');
const btnRefresh  = document.getElementById('btnRefresh');
const btnNewWindow = document.getElementById('btnNewWindow');
const torPill     = document.getElementById('torPill');
const torLabel    = document.getElementById('torLabel');
const torProgress = document.getElementById('torProgress');
const vpnPill     = document.getElementById('vpnPill');
const vpnLabel    = document.getElementById('vpnLabel');
const stripMsg    = document.getElementById('stripMsg');
const gate        = document.getElementById('gate');
const gateIcon    = document.getElementById('gateIcon');
const gateTitle   = document.getElementById('gateTitle');
const gateMsg     = document.getElementById('gateMsg');
const gateDismiss = document.getElementById('gateDismiss');
const gateAction  = document.getElementById('gateAction');
const settingsBtn = document.getElementById('settingsBtn');
const settingsEl  = document.getElementById('settings');
const settingsClose = document.getElementById('settingsClose');

/* ── Theme functions ────────────────────────────────────────────────────── */
function applyTheme(themeName) {
  if (!themeName) return;
  currentTheme = themeName;
  document.documentElement.setAttribute('data-theme', themeName);
  
  document.querySelectorAll('.theme-option').forEach(el => {
    el.classList.toggle('active', el.dataset.theme === themeName);
  });
}

async function loadTheme() {
  try {
    const config = await window.browser.getTheme();
    if (config && config.theme) {
      applyTheme(config.theme);
    } else {
      applyTheme('dark');
    }
  } catch (_) {
    applyTheme('dark');
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function normalizeUrl(input) {
  const val = input.trim();
  if (!val) return null;
  if (/^https?:\/\//i.test(val)) return val;
  if (val.endsWith('.onion') || val.includes('.onion/')) return 'http://' + val;
  if (val.includes(' ') || !val.includes('.')) return 'https://duckduckgo.com/?q=' + encodeURIComponent(val);
  return 'https://' + val;
}

function getTab(id) { return tabs.find(t => t.id === id); }

function setStripMsg(msg) { stripMsg.textContent = msg || ''; }

/* ── Open in new window ──────────────────────────────────────────────────── */
function openInNewWindow(url) {
  window.browser.navigateNewWindow(url);
}

/* ── Tab rendering ───────────────────────────────────────────────────────── */
function renderTabs() {
  document.querySelectorAll('.tab').forEach(e => e.remove());

  tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeId ? ' active' : '');
    el.dataset.id = tab.id;

    const modeDot = document.createElement('span');
    modeDot.className = 'tab-mode';
    modeDot.style.background = MODE_COLORS[tab.mode] || 'var(--dimmer)';
    el.appendChild(modeDot);

    if (tab.loading) {
      const spinner = document.createElement('div');
      spinner.className = 'tab-spinner';
      el.appendChild(spinner);
    }

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || 'New Tab';
    el.appendChild(title);

    const close = document.createElement('span');
    close.className = 'tab-close';
    close.textContent = '✕';
    close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });
    el.appendChild(close);

    el.addEventListener('click', () => switchTab(tab.id));

    tabbar.insertBefore(el, newTabBtn);
  });
}

function renderContent() {
  tabs.forEach(tab => {
    if (tab.webview) {
      tab.webview.style.display = tab.id === activeId ? 'flex' : 'none';
    }
    if (tab.ntp) {
      tab.ntp.style.display = tab.id === activeId ? 'flex' : 'none';
    }
  });
}

function updateNavbar() {
  const tab = getTab(activeId);
  if (!tab) return;
  addrInput.value = tab.url || '';
  const mode = tab.mode || 'clearnet';
  modePill.textContent = MODE_LABELS[mode];
  modePill.style.color = MODE_COLORS[mode];
  modePill.style.borderColor = MODE_COLORS[mode];
  
  if (tab.webview) {
    try {
      btnBack.disabled = !tab.webview.canGoBack();
      btnFwd.disabled  = !tab.webview.canGoForward();
    } catch (_) {
      btnBack.disabled = true;
      btnFwd.disabled = true;
    }
  } else {
    btnBack.disabled = true;
    btnFwd.disabled = true;
  }
}

/* ── Create tab ──────────────────────────────────────────────────────────── */
function createTab(url) {
  const id = ++tabCounter;

  const ntp = document.createElement('div');
  ntp.className = 'ntp';
  ntp.innerHTML = `
    <div class="ntp-logo">ITIS<span>NOW</span></div>
    <div class="ntp-search">
      <input type="text" placeholder="Search or type a URL…" id="ntp-${id}" autocomplete="off" />
      <button id="ntpGo-${id}">Go</button>
    </div>
    <div class="ntp-hint">.onion addresses route through Tor automatically</div>
  `;
  content.insertBefore(ntp, gate);

  const tab = { 
    id, 
    title: 'New Tab', 
    url: '', 
    mode: 'clearnet', 
    loading: false, 
    webview: null, 
    ntp 
  };
  tabs.push(tab);

  const ntpInput = ntp.querySelector(`#ntp-${id}`);
  const ntpGo    = ntp.querySelector(`#ntpGo-${id}`);
  const doNtpNav = () => {
    const u = normalizeUrl(ntpInput.value);
    if (u) {
      // Navigate in current tab
      navigate(id, u);
    }
  };
  ntpGo.addEventListener('click', doNtpNav);
  ntpInput.addEventListener('keydown', e => { if (e.key === 'Enter') doNtpNav(); });

  switchTab(id);

  if (url) navigate(id, url);

  return id;
}

/* ── Close tab ───────────────────────────────────────────────────────────── */
function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  const tab = tabs[idx];
  if (tab.webview) tab.webview.remove();
  if (tab.ntp)     tab.ntp.remove();
  tabs.splice(idx, 1);

  if (tabs.length === 0) {
    createTab();
  } else if (activeId === id) {
    switchTab(tabs[Math.min(idx, tabs.length - 1)].id);
  } else {
    renderTabs();
    renderContent();
  }
}

/* ── Switch tab ──────────────────────────────────────────────────────────── */
function switchTab(id) {
  activeId = id;
  renderTabs();
  renderContent();
  updateNavbar();
  setStripMsg('');
}

/* ── Navigate in tab ────────────────────────────────────────────────────── */
async function navigate(tabId, rawUrl) {
  const tab = getTab(tabId);
  if (!tab) return;

  const url = normalizeUrl(rawUrl);
  if (!url) return;

  gate.classList.remove('show');

  const result = await window.browser.resolveRoute(url);

  if (!result.ok) {
    if (result.error === 'vpn_required') {
      showGate('🔒', 'VPN required', `<b>${result.hostname}</b> is a VPN-only site. Configure your VPN proxy in Settings to continue.`, true);
    } else if (result.error === 'tor_not_ready') {
      const pct = result.bootstrap;
      showGate('🧅', 'Tor is connecting', `Tor is ${pct < 1 ? 'starting up' : `${pct}% bootstrapped`}. Wait a moment and try again. If Tor never connects, check Settings.`, false);
    } else {
      showGate('⚠', 'Navigation error', result.error, false);
    }
    return;
  }

  tab.url = url;
  tab.mode = result.mode;
  tab.loading = true;

  if (!tab.webview) {
    const wv = document.createElement('webview');
    wv.setAttribute('partition', result.partition);
    wv.setAttribute('allowpopups', '');
    wv.style.cssText = 'position:absolute;inset:0;display:none;width:100%;height:100%;';
    content.insertBefore(wv, gate);
    tab.webview = wv;

    wv.addEventListener('did-start-loading', () => {
      tab.loading = true;
      tab.title = 'Loading…';
      renderTabs();
    });
    
    wv.addEventListener('did-stop-loading', () => {
      tab.loading = false;
      try { tab.title = wv.getTitle() || tab.url; } catch (_) {}
      if (tabId === activeId) updateNavbar();
      renderTabs();
    });
    
    wv.addEventListener('did-navigate', (e) => {
      tab.url = e.url;
      if (tabId === activeId) {
        addrInput.value = e.url;
        updateNavbar();
      }
    });
    
    wv.addEventListener('did-navigate-in-page', (e) => {
      tab.url = e.url;
      if (tabId === activeId) addrInput.value = e.url;
    });
    
    wv.addEventListener('page-title-updated', (e) => {
      tab.title = e.title;
      renderTabs();
    });
    
    // Open links that request a new window as a new tab instead
    wv.addEventListener('new-window', (e) => {
      if (e.url) createTab(e.url);
    });
  } else {
    tab.webview.setAttribute('partition', result.partition);
  }

  // Hide NTP, show webview
  tab.ntp.style.display = 'none';
  tab.webview.style.display = 'flex';

  renderTabs();
  if (tabId === activeId) {
    renderContent();
    updateNavbar();
  }

  // Defer loadURL until webview is attached (dom-ready). On first navigation
  // the webview element has just been inserted into the DOM and calling loadURL
  // immediately is a silent no-op in Electron — dom-ready guarantees it's ready.
  const doLoad = () => {
    try {
      if (typeof tab.webview.loadURL === 'function') {
        tab.webview.loadURL(url);
      } else {
        tab.webview.src = url;
      }
    } catch (_) {
      tab.webview.src = url;
    }
  };

  try {
    // getURL() throws if not yet ready, so we use it as a readiness probe
    tab.webview.getURL();
    doLoad();
  } catch (_) {
    tab.webview.addEventListener('dom-ready', doLoad, { once: true });
  }
}

/* ── Gate overlay ────────────────────────────────────────────────────────── */
function showGate(icon, title, msg, showSettingsBtn) {
  gateIcon.textContent = icon;
  gateTitle.textContent = title;
  gateMsg.innerHTML = msg;
  gateAction.style.display = showSettingsBtn ? 'inline-block' : 'none';
  gate.classList.add('show');
}

gateDismiss.addEventListener('click', () => gate.classList.remove('show'));
gateAction.addEventListener('click', () => { gate.classList.remove('show'); openSettings(); });

/* ── Address bar events ──────────────────────────────────────────────────── */
addrInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const url = normalizeUrl(addrInput.value);
    if (url && activeId) {
      // Navigate in current tab
      navigate(activeId, url);
    }
  }
});
addrInput.addEventListener('focus', () => addrInput.select());

btnBack.addEventListener('click', () => {
  const tab = getTab(activeId);
  if (tab && tab.webview) {
    try { if (tab.webview.canGoBack()) tab.webview.goBack(); } catch (_) {}
  }
});
btnFwd.addEventListener('click', () => {
  const tab = getTab(activeId);
  if (tab && tab.webview) {
    try { if (tab.webview.canGoForward()) tab.webview.goForward(); } catch (_) {}
  }
});
btnRefresh.addEventListener('click', () => {
  const tab = getTab(activeId);
  if (tab && tab.webview) {
    try { tab.webview.reload(); } catch (_) {}
  }
});

/* ── New Window button ───────────────────────────────────────────────────── */
btnNewWindow.addEventListener('click', () => {
  // Opens a completely new application window
  window.browser.navigateNewWindow('');
});

/* ── Tabs ────────────────────────────────────────────────────────────────── */
newTabBtn.addEventListener('click', () => createTab());

/* ── Window controls ─────────────────────────────────────────────────────── */
document.getElementById('winMin').addEventListener('click', () => window.browser.minimize());
document.getElementById('winMax').addEventListener('click', () => window.browser.maximize());
document.getElementById('winClose').addEventListener('click', () => window.browser.close());

/* ── Tor status strip ────────────────────────────────────────────────────── */
function updateTorStrip(status) {
  const { running, bootstrap, starting, error } = status;
  if (running) {
    torPill.className = 'pill on-tor';
    torLabel.textContent = 'TOR ON';
    torProgress.textContent = '';
  } else if (starting || (bootstrap > 0 && bootstrap < 100)) {
    torPill.className = 'pill starting';
    torLabel.textContent = `TOR ${bootstrap}%`;
    torProgress.textContent = '';
  } else {
    torPill.className = 'pill';
    torLabel.textContent = error === 'not_found' ? 'TOR N/A' : 'TOR OFF';
  }
  updateSettingsTorStatus(status);
}

window.browser.onTorStatus(updateTorStrip);

/* ── VPN strip ───────────────────────────────────────────────────────────── */
async function updateVpnStrip() {
  const cfg = await window.browser.getVpnConfig();
  if (cfg.enabled && cfg.host) {
    vpnPill.className = 'pill on-vpn';
    vpnLabel.textContent = `VPN ${cfg.protocol.toUpperCase()}`;
  } else {
    vpnPill.className = 'pill';
    vpnLabel.textContent = 'VPN OFF';
  }
}

/* ── Settings panel ──────────────────────────────────────────────────────── */
function openSettings() { settingsEl.classList.add('open'); }
settingsBtn.addEventListener('click', () => settingsEl.classList.toggle('open'));
settingsClose.addEventListener('click', () => settingsEl.classList.remove('open'));

// Tor section
const sTorDot   = document.getElementById('sTorDot');
const sTorTitle = document.getElementById('sTorTitle');
const sTorSub   = document.getElementById('sTorSub');
const sTorPBar  = document.getElementById('sTorPBar');
const sTorFill  = document.getElementById('sTorFill');
document.getElementById('torRestartBtn').addEventListener('click', async () => {
  sTorSub.textContent = 'Restarting…';
  await window.browser.torRestart();
});
document.getElementById('torDownloadLink').addEventListener('click', (e) => {
  e.preventDefault();
  // Open Tor download in a new window
  openInNewWindow('https://www.torproject.org/download/tor/');
});

function updateSettingsTorStatus(status) {
  const { running, bootstrap, starting, error } = status;
  if (running) {
    sTorDot.className = 'dot on';
    sTorTitle.textContent = 'Tor connected';
    sTorSub.textContent = 'Onion routing active. .onion URLs load automatically.';
    sTorPBar.style.display = 'none';
  } else if (starting || (bootstrap > 0)) {
    sTorDot.className = 'dot starting';
    sTorTitle.textContent = `Connecting… ${bootstrap}%`;
    sTorSub.textContent = 'Building circuits through the Tor network.';
    sTorPBar.style.display = 'block';
    sTorFill.style.width = bootstrap + '%';
  } else if (error === 'not_found') {
    sTorDot.className = 'dot off';
    sTorTitle.textContent = 'Tor not found';
    sTorSub.textContent = 'Place tor.exe in the tor-bin/ folder or install system Tor.';
    sTorPBar.style.display = 'none';
  } else {
    sTorDot.className = 'dot off';
    sTorTitle.textContent = 'Tor not running';
    sTorSub.textContent = 'Will start automatically on next launch.';
    sTorPBar.style.display = 'none';
  }
}

// VPN section
const vpnProtocol = document.getElementById('vpnProtocol');
const vpnHost     = document.getElementById('vpnHost');
const vpnPort     = document.getElementById('vpnPort');
const vpnUser     = document.getElementById('vpnUser');
const vpnPass     = document.getElementById('vpnPass');

async function loadVpnForm() {
  const cfg = await window.browser.getVpnConfig();
  vpnProtocol.value = cfg.protocol || 'socks5';
  vpnHost.value     = cfg.host     || '';
  vpnPort.value     = cfg.port     || '';
  vpnUser.value     = cfg.user     || '';
  vpnPass.value     = cfg.pass     || '';
}

document.getElementById('vpnSaveBtn').addEventListener('click', async () => {
  const cfg = {
    enabled: true,
    protocol: vpnProtocol.value,
    host: vpnHost.value.trim(),
    port: vpnPort.value.trim(),
    user: vpnUser.value.trim(),
    pass: vpnPass.value
  };
  if (!cfg.host || !cfg.port) { setStripMsg('Enter a host and port.'); return; }
  await window.browser.setVpnConfig(cfg);
  await updateVpnStrip();
  setStripMsg('VPN proxy saved and enabled.');
  setTimeout(() => setStripMsg(''), 3000);
});

document.getElementById('vpnDisableBtn').addEventListener('click', async () => {
  const cfg = await window.browser.getVpnConfig();
  cfg.enabled = false;
  await window.browser.setVpnConfig(cfg);
  await updateVpnStrip();
  setStripMsg('VPN proxy disabled.');
  setTimeout(() => setStripMsg(''), 3000);
});

// VPN-only sites
const sSiteList   = document.getElementById('sSiteList');
const siteAddInput = document.getElementById('siteAddInput');

async function refreshSiteList() {
  const sites = await window.browser.listVpnSites();
  sSiteList.innerHTML = '';
  if (sites.length === 0) {
    sSiteList.innerHTML = '<li style="color:var(--dimmer);border-color:transparent;background:transparent">No sites added yet.</li>';
    return;
  }
  sites.forEach(d => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${d}</span>`;
    const rm = document.createElement('button');
    rm.textContent = '✕';
    rm.title = 'Remove';
    rm.addEventListener('click', async () => {
      await window.browser.removeVpnSite(d);
      refreshSiteList();
    });
    li.appendChild(rm);
    sSiteList.appendChild(li);
  });
}

document.getElementById('siteAddBtn').addEventListener('click', async () => {
  const val = siteAddInput.value.trim();
  if (!val) return;
  await window.browser.addVpnSite(val);
  siteAddInput.value = '';
  refreshSiteList();
});
siteAddInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('siteAddBtn').click();
});

// Theme selector
document.querySelectorAll('.theme-option').forEach(el => {
  el.addEventListener('click', async () => {
    const theme = el.dataset.theme;
    applyTheme(theme);
    await window.browser.setTheme(theme);
  });
});

/* ── Navigation from main (when opening new window with URL) ───────────── */
window.browser.onNavigate((data) => {
  if (data && data.url) {
    createTab(data.url);
  }
});

/* ── New-window push from main process (webview setWindowOpenHandler) ─── */
// Primary intercept: main catches window.open() in webviews and sends the URL
// here so we open it as a tab rather than spawning a new BrowserWindow.
window.browser.onOpenUrl((url) => {
  if (url) createTab(url);
});

/* ── Init ────────────────────────────────────────────────────────────────── */
(async () => {
  // Load theme first
  await loadTheme();
  
  // Seed first tab
  createTab();

  // Load settings forms
  await loadVpnForm();
  await refreshSiteList();
  await updateVpnStrip();

  // Get current Tor status
  const torStatus = await window.browser.torStatus();
  updateTorStrip(torStatus);
})();