/* ══════════════════════════════════════════════════════════════════════════
   STATE
   ══════════════════════════════════════════════════════════════════════════ */
let tabs = [];
let activeId = null;
let tabCounter = 0;
let currentTheme = 'dark';
let renderTabsScheduled = false;

const MODE_COLORS = {
  clearnet:  'var(--accent)',
  tor:       'var(--purple)',
  'tor-all': 'var(--purple)',
  psiphon:   'var(--green)',
  vpn:       'var(--amber)',
  'vpn+tor': 'var(--red)'
};
const MODE_LABELS = {
  clearnet:  'NORMAL',
  tor:       'TOR',
  'tor-all': 'TOR ALL',
  psiphon:   'PSIPHON',
  vpn:       'VPN',
  'vpn+tor': 'VPN+TOR'
};

/* ══════════════════════════════════════════════════════════════════════════
   DOM REFS
   ══════════════════════════════════════════════════════════════════════════ */
const tabbar       = document.getElementById('tabbar');
const newTabBtn    = document.getElementById('newTab');
const content      = document.getElementById('content');
const addrInput    = document.getElementById('addrInput');
const modePill     = document.getElementById('modePill');
const btnBack      = document.getElementById('btnBack');
const btnFwd       = document.getElementById('btnFwd');
const btnRefresh   = document.getElementById('btnRefresh');
const btnNewWindow = document.getElementById('btnNewWindow');
const torPill      = document.getElementById('torPill');
const torLabel     = document.getElementById('torLabel');
const torProgress  = document.getElementById('torProgress');
const vpnPill      = document.getElementById('vpnPill');
const vpnLabel     = document.getElementById('vpnLabel');
const stripMsg     = document.getElementById('stripMsg');
const gate         = document.getElementById('gate');
const gateIcon     = document.getElementById('gateIcon');
const gateTitle    = document.getElementById('gateTitle');
const gateMsg      = document.getElementById('gateMsg');
const gateDismiss  = document.getElementById('gateDismiss');
const gateAction   = document.getElementById('gateAction');
const settingsBtn  = document.getElementById('settingsBtn');
const settingsEl   = document.getElementById('settings');
const settingsClose= document.getElementById('settingsClose');
const sTorDot      = document.getElementById('sTorDot');
const sTorTitle    = document.getElementById('sTorTitle');
const sTorSub      = document.getElementById('sTorSub');
const sTorPBar     = document.getElementById('sTorPBar');
const sTorFill     = document.getElementById('sTorFill');
const vpnProtocol  = document.getElementById('vpnProtocol');
const vpnHost      = document.getElementById('vpnHost');
const vpnPort      = document.getElementById('vpnPort');
const vpnUser      = document.getElementById('vpnUser');
const vpnPass      = document.getElementById('vpnPass');
const sSiteList    = document.getElementById('sSiteList');
const siteAddInput = document.getElementById('siteAddInput');

/* ══════════════════════════════════════════════════════════════════════════
   THEME
   ══════════════════════════════════════════════════════════════════════════ */
function applyTheme(name) {
  if (!name) return;
  currentTheme = name;
  document.documentElement.setAttribute('data-theme', name);
  document.querySelectorAll('.theme-option').forEach(el =>
    el.classList.toggle('active', el.dataset.theme === name));
}
async function loadTheme() {
  try { const c = await window.browser.getTheme(); applyTheme(c?.theme || 'dark'); }
  catch (_) { applyTheme('dark'); }
}

/* ══════════════════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════════════════════ */
function normalizeUrl(input) {
  const v = input.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (v.endsWith('.onion') || v.includes('.onion/')) return 'http://' + v;
  if (v.includes(' ') || !v.includes('.')) return 'https://duckduckgo.com/?q=' + encodeURIComponent(v);
  return 'https://' + v;
}
function getTab(id) { return tabs.find(t => t.id === id); }
function setStripMsg(msg, ttl = 0) {
  stripMsg.textContent = msg || '';
  if (ttl) setTimeout(() => { if (stripMsg.textContent === msg) stripMsg.textContent = ''; }, ttl);
}
function openInNewWindow(url) { window.browser.navigateNewWindow(url || ''); }

/* ══════════════════════════════════════════════════════════════════════════
   TAB RENDERING  — reuse DOM nodes; only patch text/class each frame
   ══════════════════════════════════════════════════════════════════════════ */
const tabEls = new Map(); // tab.id → <div.tab>

function renderTabs() {
  // Remove stale nodes
  for (const [id, el] of tabEls) {
    if (!getTab(id)) { el.remove(); tabEls.delete(id); }
  }

  tabs.forEach((tab, i) => {
    let el = tabEls.get(tab.id);

    if (!el) {
      el = document.createElement('div');
      el.className = 'tab';

      const dot = document.createElement('span');
      dot.className = 'tab-mode';
      el.appendChild(dot);

      const sp = document.createElement('div');
      sp.className = 'tab-spinner';
      sp.style.display = 'none';
      el.appendChild(sp);

      const ttl = document.createElement('span');
      ttl.className = 'tab-title';
      el.appendChild(ttl);

      const x = document.createElement('span');
      x.className = 'tab-close';
      x.textContent = '✕';
      x.addEventListener('click', e => { e.stopPropagation(); closeTab(tab.id); });
      el.appendChild(x);

      el.addEventListener('click', () => switchTab(tab.id));
      tabEls.set(tab.id, el);
    }

    el.classList.toggle('active', tab.id === activeId);
    el.querySelector('.tab-mode').style.background   = MODE_COLORS[tab.mode] || 'var(--dimmer)';
    el.querySelector('.tab-spinner').style.display   = tab.loading ? 'block' : 'none';
    el.querySelector('.tab-title').textContent       = tab.title || 'New Tab';

    // Maintain order without full rebuild
    if (tabbar.children[i] !== el) tabbar.insertBefore(el, newTabBtn);
  });
}

function scheduleRenderTabs() {
  if (renderTabsScheduled) return;
  renderTabsScheduled = true;
  requestAnimationFrame(() => { renderTabsScheduled = false; renderTabs(); });
}

/* ══════════════════════════════════════════════════════════════════════════
   CONTENT + NAVBAR
   ══════════════════════════════════════════════════════════════════════════ */
function renderContent() {
  tabs.forEach(tab => {
    // webview takes priority; only show NTP if no webview yet for this tab
    if (tab.webview) tab.webview.style.display = tab.id === activeId ? 'flex' : 'none';
    if (tab.ntp)     tab.ntp.style.display     = (!tab.webview && tab.id === activeId) ? 'flex' : 'none';
  });
}

function updateNavbar() {
  const tab = getTab(activeId);
  if (!tab) return;
  addrInput.value            = tab.url || '';
  const mode                 = tab.mode || 'clearnet';
  modePill.textContent       = MODE_LABELS[mode];
  modePill.style.color       = MODE_COLORS[mode];
  modePill.style.borderColor = MODE_COLORS[mode];
  try {
    btnBack.disabled = !tab.webview?.canGoBack();
    btnFwd.disabled  = !tab.webview?.canGoForward();
  } catch (_) { btnBack.disabled = btnFwd.disabled = true; }
}

/* ══════════════════════════════════════════════════════════════════════════
   TAB LIFECYCLE
   ══════════════════════════════════════════════════════════════════════════ */
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

  const tab = { id, title: 'New Tab', url: '', mode: 'clearnet', loading: false, webview: null, ntp };
  tabs.push(tab);

  const ni = ntp.querySelector(`#ntp-${id}`);
  const ng = ntp.querySelector(`#ntpGo-${id}`);
  const go = () => { const u = normalizeUrl(ni.value); if (u) navigate(id, u); };
  ng.addEventListener('click', go);
  ni.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });

  switchTab(id);
  if (url) navigate(id, url);
  return id;
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = tabs[idx];
  tabEls.get(id)?.remove(); tabEls.delete(id);
  tab.webview?.remove();
  tab.ntp?.remove();
  tabs.splice(idx, 1);
  if (!tabs.length) { createTab(); return; }
  if (activeId === id) switchTab(tabs[Math.min(idx, tabs.length - 1)].id);
  else { renderTabs(); renderContent(); }
}

function switchTab(id) {
  activeId = id;
  renderTabs();
  renderContent();
  updateNavbar();
  setStripMsg('');
}

/* ══════════════════════════════════════════════════════════════════════════
   NAVIGATE
   ══════════════════════════════════════════════════════════════════════════ */
async function navigate(tabId, rawUrl) {
  const tab = getTab(tabId);
  if (!tab) return;

  const url = normalizeUrl(rawUrl);
  if (!url) return;

  gate.classList.remove('show');

  const result = await window.browser.resolveRoute(url);

  if (!result.ok) {
    if (result.error === 'vpn_required')
      showGate('🔒', 'VPN required',
        `<b>${result.hostname}</b> is a VPN-only site. Configure your VPN proxy in Settings to continue.`, true);
    else if (result.error === 'tor_not_ready')
      showGate('🧅', 'Tor is connecting',
        `Tor is ${result.bootstrap < 1 ? 'starting up' : `${result.bootstrap}% bootstrapped`}. Wait a moment and try again.`, false);
    else
      showGate('⚠', 'Navigation error', result.error, false);
    return;
  }

  tab.url     = url;
  tab.mode    = result.displayMode || result.mode;
  tab.loading = true;

  if (!tab.webview) {
    // ── FIRST NAVIGATION: create the webview ─────────────────────────────
    // Set `src` as an ATTRIBUTE before inserting into the DOM.
    // Electron reads `src` when the element attaches and starts the load
    // automatically — no need for loadURL(), which isn't safe to call until
    // the webview process is fully initialised (which isn't yet).
    const wv = document.createElement('webview');
    wv.setAttribute('partition', result.partition);
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('src', url);   // ← the actual fix
    wv.style.cssText = 'position:absolute;inset:0;display:none;width:100%;height:100%;';
    content.insertBefore(wv, gate);
    tab.webview = wv;

    wv.addEventListener('did-start-loading', () => {
      tab.loading = true; tab.title = 'Loading…'; scheduleRenderTabs();
    });
    wv.addEventListener('did-stop-loading', () => {
      tab.loading = false;
      try { tab.title = wv.getTitle() || tab.url; } catch (_) { tab.title = tab.url; }
      if (tabId === activeId) updateNavbar();
      scheduleRenderTabs();
    });
    wv.addEventListener('did-navigate', e => {
      tab.url = e.url;
      if (tabId === activeId) { addrInput.value = e.url; updateNavbar(); }
    });
    wv.addEventListener('did-navigate-in-page', e => {
      tab.url = e.url;
      if (tabId === activeId) addrInput.value = e.url;
    });
    wv.addEventListener('page-title-updated', e => {
      tab.title = e.title; scheduleRenderTabs();
    });
    wv.addEventListener('context-menu', e => {
      // Send context params to main process to build and show a native Menu
      window.browser.showContextMenu({
        linkURL:       e.params?.linkURL   || '',
        srcURL:        e.params?.srcURL    || '',
        mediaType:     e.params?.mediaType || '',
        pageURL:       e.params?.pageURL   || tab.url,
        selectionText: e.params?.selectionText || '',
        isEditable:    e.params?.isEditable || false,
        x:             e.params?.x || 0,
        y:             e.params?.y || 0
      });
    });

    // Inject middle-click handler into every page after it loads.
    // Middle-clicking a link calls window.open() which setWindowOpenHandler
    // in main.js intercepts and routes to a new tab via tab:openNewTab IPC.
    wv.addEventListener('dom-ready', () => {
      wv.executeJavaScript(`
        (function() {
          if (window.__in_injected) return;
          window.__in_injected = true;
          document.addEventListener('mousedown', function(e) {
            if (e.button !== 1) return;
            var link = e.target.closest('a[href]');
            if (link && link.href && !link.href.startsWith('javascript:')) {
              e.preventDefault();
              e.stopPropagation();
              window.open(link.href, '_blank');
            }
          }, true);
        })();
      `).catch(() => {});
    });

  } else {
    // ── SUBSEQUENT NAVIGATION: webview is ready, loadURL is safe ─────────
    tab.webview.setAttribute('partition', result.partition);
    try { tab.webview.loadURL(url); } catch (_) { tab.webview.src = url; }
  }

  if (tab.ntp) tab.ntp.style.display = 'none';
  tab.webview.style.display = 'flex';

  renderTabs();
  if (tabId === activeId) updateNavbar();
}

/* ══════════════════════════════════════════════════════════════════════════
   GATE
   ══════════════════════════════════════════════════════════════════════════ */
function showGate(icon, title, msg, showBtn) {
  gateIcon.textContent  = icon;
  gateTitle.textContent = title;
  gateMsg.innerHTML     = msg;
  gateAction.style.display = showBtn ? 'inline-block' : 'none';
  gate.classList.add('show');
}
gateDismiss.addEventListener('click', () => gate.classList.remove('show'));
gateAction.addEventListener('click',  () => { gate.classList.remove('show'); openSettings(); });

/* ══════════════════════════════════════════════════════════════════════════
   NAVBAR EVENTS
   ══════════════════════════════════════════════════════════════════════════ */
addrInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { const u = normalizeUrl(addrInput.value); if (u && activeId) navigate(activeId, u); }
});
addrInput.addEventListener('focus', () => addrInput.select());
btnBack.addEventListener('click',    () => { const t = getTab(activeId); if (t?.webview) try { if (t.webview.canGoBack())    t.webview.goBack();    } catch(_){} });
btnFwd.addEventListener('click',     () => { const t = getTab(activeId); if (t?.webview) try { if (t.webview.canGoForward()) t.webview.goForward(); } catch(_){} });
btnRefresh.addEventListener('click', () => { const t = getTab(activeId); if (t?.webview) try { t.webview.reload(); } catch(_){} });
btnNewWindow.addEventListener('click', () => openInNewWindow(''));
newTabBtn.addEventListener('click',    () => createTab());

/* ══════════════════════════════════════════════════════════════════════════
   WINDOW CONTROLS
   ══════════════════════════════════════════════════════════════════════════ */
document.getElementById('winMin').addEventListener('click',   () => window.browser.minimize());
document.getElementById('winMax').addEventListener('click',   () => window.browser.maximize());
document.getElementById('winClose').addEventListener('click', () => window.browser.close());

/* ══════════════════════════════════════════════════════════════════════════
   TOR STATUS
   ══════════════════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════════════════
   TOR STATUS
   ══════════════════════════════════════════════════════════════════════════ */
function updateTorStrip({ running, bootstrap, starting, error }) {
  if (running) {
    torPill.className = 'pill on-tor'; torLabel.textContent = 'TOR ON'; torProgress.textContent = '';
    sTorDot.className = 'dot on'; sTorTitle.textContent = 'Tor connected';
    sTorSub.textContent = 'Onion routing active. .onion URLs load automatically.';
    sTorPBar.style.display = 'none';
  } else if (starting || bootstrap > 0) {
    torPill.className = 'pill starting'; torLabel.textContent = `TOR ${bootstrap}%`; torProgress.textContent = '';
    sTorDot.className = 'dot starting'; sTorTitle.textContent = `Connecting… ${bootstrap}%`;
    sTorSub.textContent = 'Building circuits through the Tor network.';
    sTorPBar.style.display = 'block'; sTorFill.style.width = bootstrap + '%';
  } else if (error === 'not_found') {
    torPill.className = 'pill'; torLabel.textContent = 'TOR N/A';
    sTorDot.className = 'dot off'; sTorTitle.textContent = 'Tor not found';
    sTorSub.textContent = 'Place tor.exe in the tor-bin/ folder.';
    sTorPBar.style.display = 'none';
  } else {
    torPill.className = 'pill'; torLabel.textContent = 'TOR OFF';
    sTorDot.className = 'dot off'; sTorTitle.textContent = 'Tor not running';
    sTorSub.textContent = 'Will start automatically on next launch.';
    sTorPBar.style.display = 'none';
  }
}
window.browser.onTorStatus(updateTorStrip);
document.getElementById('torRestartBtn').addEventListener('click', async () => {
  sTorSub.textContent = 'Restarting…'; await window.browser.torRestart();
});
document.getElementById('torDownloadLink').addEventListener('click', e => {
  e.preventDefault(); openInNewWindow('https://www.torproject.org/download/tor/');
});

/* ── Tor-all toggle ───────────────────────────────────────────────────────── */
const torAllCheck = document.getElementById('torAllCheck');
torAllCheck.addEventListener('change', async () => {
  const prefs = await window.browser.setPrefs({ torAll: torAllCheck.checked });
  // If enabling tor-all, turn off psiphon
  if (torAllCheck.checked) {
    document.getElementById('psiphonCheck').checked = false;
    await window.browser.setPrefs({ psiphonEnabled: false });
  }
  setStripMsg(torAllCheck.checked ? 'All traffic now routes through Tor.' : 'Tor routing back to .onion only.', 3000);
});

/* ══════════════════════════════════════════════════════════════════════════
   PSIPHON STATUS
   ══════════════════════════════════════════════════════════════════════════ */
const psiphonPill  = document.getElementById('psiphonPill');
const psiphonLabel = document.getElementById('psiphonLabel');
const sPsiphonDot  = document.getElementById('sPsiphonDot');
const sPsiphonTitle= document.getElementById('sPsiphonTitle');
const sPsiphonSub  = document.getElementById('sPsiphonSub');

function updatePsiphonStrip({ running, starting, error, port }) {
  if (running) {
    psiphonPill.className = 'pill on-psiphon'; psiphonLabel.textContent = 'PSIPHON ON';
    sPsiphonDot.className = 'dot on'; sPsiphonTitle.textContent = `Psiphon connected (port ${port})`;
    sPsiphonSub.textContent = 'Clearnet traffic routed through Psiphon.';
  } else if (starting) {
    psiphonPill.className = 'pill starting'; psiphonLabel.textContent = 'PSIPHON…';
    sPsiphonDot.className = 'dot starting'; sPsiphonTitle.textContent = 'Psiphon connecting…';
    sPsiphonSub.textContent = 'Finding the best free server…';
  } else if (error === 'not_found') {
    psiphonPill.className = 'pill'; psiphonLabel.textContent = 'PSIPHON N/A';
    sPsiphonDot.className = 'dot off'; sPsiphonTitle.textContent = 'Psiphon not found';
    sPsiphonSub.textContent = 'Place psiphon3.exe in psiphon-bin/ folder.';
  } else {
    psiphonPill.className = 'pill'; psiphonLabel.textContent = 'PSIPHON OFF';
    sPsiphonDot.className = 'dot off'; sPsiphonTitle.textContent = 'Psiphon off';
    sPsiphonSub.textContent = 'Free built-in proxy. No account or config needed.';
  }
}
window.browser.onPsiphonStatus(updatePsiphonStrip);

/* ── Psiphon toggle ───────────────────────────────────────────────────────── */
const psiphonCheck = document.getElementById('psiphonCheck');
psiphonCheck.addEventListener('change', async () => {
  // If enabling Psiphon, turn off tor-all
  if (psiphonCheck.checked) {
    torAllCheck.checked = false;
    await window.browser.setPrefs({ torAll: false });
  }
  await window.browser.setPrefs({ psiphonEnabled: psiphonCheck.checked });
  setStripMsg(psiphonCheck.checked ? 'Psiphon starting…' : 'Psiphon disabled.', 3000);
});

document.getElementById('psiphonDlLink')?.addEventListener('click', e => {
  e.preventDefault(); openInNewWindow('https://psiphon.ca/en/download.html');
});

/* ══════════════════════════════════════════════════════════════════════════
   VPN STATUS
   ══════════════════════════════════════════════════════════════════════════ */
async function updateVpnStrip() {
  const cfg = await window.browser.getVpnConfig();
  if (cfg.enabled && cfg.host) {
    vpnPill.className = 'pill on-vpn'; vpnLabel.textContent = `VPN ${cfg.protocol.toUpperCase()}`;
  } else {
    vpnPill.className = 'pill'; vpnLabel.textContent = 'VPN OFF';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   SETTINGS
   ══════════════════════════════════════════════════════════════════════════ */
function openSettings() { settingsEl.classList.add('open'); }
settingsBtn.addEventListener('click',   () => settingsEl.classList.toggle('open'));
settingsClose.addEventListener('click', () => settingsEl.classList.remove('open'));

async function loadVpnForm() {
  const cfg = await window.browser.getVpnConfig();
  vpnProtocol.value = cfg.protocol || 'socks5';
  vpnHost.value = cfg.host || ''; vpnPort.value = cfg.port || '';
  vpnUser.value = cfg.user || ''; vpnPass.value = cfg.pass || '';
}

document.getElementById('vpnSaveBtn').addEventListener('click', async () => {
  const cfg = { enabled: true, protocol: vpnProtocol.value,
    host: vpnHost.value.trim(), port: vpnPort.value.trim(),
    user: vpnUser.value.trim(), pass: vpnPass.value };
  if (!cfg.host || !cfg.port) { setStripMsg('Enter a host and port.', 3000); return; }
  await window.browser.setVpnConfig(cfg); await updateVpnStrip();
  setStripMsg('VPN proxy saved and enabled.', 3000);
});
document.getElementById('vpnDisableBtn').addEventListener('click', async () => {
  const cfg = await window.browser.getVpnConfig(); cfg.enabled = false;
  await window.browser.setVpnConfig(cfg); await updateVpnStrip();
  setStripMsg('VPN proxy disabled.', 3000);
});

async function refreshSiteList() {
  const sites = await window.browser.listVpnSites();
  sSiteList.innerHTML = '';
  if (!sites.length) {
    sSiteList.innerHTML = '<li style="color:var(--dimmer);border-color:transparent;background:transparent">No sites added yet.</li>';
    return;
  }
  sites.forEach(d => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${d}</span>`;
    const rm = document.createElement('button'); rm.textContent = '✕'; rm.title = 'Remove';
    rm.addEventListener('click', async () => { await window.browser.removeVpnSite(d); refreshSiteList(); });
    li.appendChild(rm); sSiteList.appendChild(li);
  });
}
document.getElementById('siteAddBtn').addEventListener('click', async () => {
  const v = siteAddInput.value.trim(); if (!v) return;
  await window.browser.addVpnSite(v); siteAddInput.value = ''; refreshSiteList();
});
siteAddInput.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('siteAddBtn').click(); });

document.querySelectorAll('.theme-option').forEach(el =>
  el.addEventListener('click', async () => {
    applyTheme(el.dataset.theme); await window.browser.setTheme(el.dataset.theme);
  }));

/* ══════════════════════════════════════════════════════════════════════════
   NAVIGATE FROM MAIN
   ══════════════════════════════════════════════════════════════════════════ */
window.browser.onNavigate(data => { if (data?.url) createTab(data.url); });

// Webview new-window requests intercepted by main (target="_blank", window.open, middle-click)
window.browser.onOpenNewTab(url => { if (url) createTab(url); });

// target="_blank", middle-click, window.open() inside any webview → new tab
window.browser.onTabOpen(url => { if (url) createTab(url); });

/* ══════════════════════════════════════════════════════════════════════════
   CONTEXT MENU ACTIONS  (sent back from main after user picks an item)
   ══════════════════════════════════════════════════════════════════════════ */
window.browser.onContextMenuAction(({ action, url, x, y }) => {
  const tab = getTab(activeId);
  switch (action) {
    case 'open-tab':    if (url) createTab(url); break;
    case 'open-window': if (url) openInNewWindow(url); break;
    case 'back':    if (tab?.webview) try { tab.webview.goBack();    } catch(_){} break;
    case 'forward': if (tab?.webview) try { tab.webview.goForward(); } catch(_){} break;
    case 'reload':  if (tab?.webview) try { tab.webview.reload();    } catch(_){} break;
    case 'inspect': if (tab?.webview) try { tab.webview.inspectElement(x, y); } catch(_){} break;
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════════════════════ */
(async () => {
  await loadTheme();
  createTab();

  const [prefs, psiphonSt, torSt] = await Promise.all([
    window.browser.getPrefs(),
    window.browser.psiphonStatus(),
    window.browser.torStatus(),
    loadVpnForm(),
    refreshSiteList(),
    updateVpnStrip()
  ]);

  torAllCheck.checked   = prefs.torAll         || false;
  psiphonCheck.checked  = prefs.psiphonEnabled || false;
  updateTorStrip(torSt);
  updatePsiphonStrip(psiphonSt);
})();

window.browser.onNavigate(data => { if (data?.url) createTab(data.url); });
window.browser.onOpenNewTab(url => { if (url) createTab(url); });
