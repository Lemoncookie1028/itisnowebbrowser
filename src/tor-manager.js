/**
 * tor-manager.js
 * Finds, starts and monitors a local Tor process.
 * Search order: bundled binary in app resources, system PATH, common install paths.
 * Communicates bootstrap progress back via an EventEmitter.
 */

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

const TOR_SOCKS_PORT = 9050;
const TOR_CONTROL_PORT = 9051;

class TorManager extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.running = false;
    this.bootstrapPct = 0;
    this.socksProxy = `socks5://127.0.0.1:${TOR_SOCKS_PORT}`;
    this.starting = false;
  }

  _findTorBinary(app) {
    const candidates = [];

    // 1. Bundled in extraResources
    if (app) {
      const res = process.resourcesPath || '';
      candidates.push(path.join(res, 'tor-bin', 'tor.exe'));
      candidates.push(path.join(res, 'tor-bin', 'tor'));
    }

    // 2. Next to the app executable
    const appDir = app ? path.dirname(app.getPath('exe')) : __dirname;
    candidates.push(path.join(appDir, 'tor-bin', 'tor.exe'));
    candidates.push(path.join(appDir, 'tor-bin', 'tor'));

    // 3. Current working directory
    candidates.push(path.join(process.cwd(), 'tor-bin', 'tor.exe'));
    candidates.push(path.join(process.cwd(), 'tor-bin', 'tor'));

    // 4. src directory
    candidates.push(path.join(__dirname, '..', 'tor-bin', 'tor.exe'));
    candidates.push(path.join(__dirname, '..', 'tor-bin', 'tor'));

    // 5. Common Windows install paths
    candidates.push('C:\\Program Files\\Tor Browser\\Browser\\TorBrowser\\Tor\\tor.exe');
    candidates.push('C:\\Program Files\\Tor\\tor.exe');
    candidates.push(path.join(process.env.APPDATA || '', 'tor', 'tor.exe'));

    // 6. System PATH
    candidates.push('tor');

    for (const c of candidates) {
      try {
        if (c === 'tor') return 'tor';
        if (fs.existsSync(c)) return c;
      } catch (_) {}
    }
    return null;
  }

  async _checkPort(port) {
    return new Promise((resolve) => {
      const s = net.createConnection({ host: '127.0.0.1', port, timeout: 800 });
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('error', () => resolve(false));
      s.on('timeout', () => { s.destroy(); resolve(false); });
    });
  }

  async start(app) {
    if (this.running) {
      this.emit('status', { running: true, bootstrap: 100 });
      return;
    }

    // Check if Tor is already running
    const alreadyUp = await this._checkPort(TOR_SOCKS_PORT);
    if (alreadyUp) {
      this.running = true;
      this.bootstrapPct = 100;
      this.starting = false;
      this.emit('status', { running: true, bootstrap: 100, source: 'external' });
      return;
    }

    const bin = this._findTorBinary(app);
    if (!bin) {
      this.starting = false;
      this.emit('status', { running: false, bootstrap: 0, error: 'not_found' });
      return;
    }

    const dataDir = app
      ? path.join(app.getPath('userData'), 'tor-data')
      : path.join(__dirname, '..', 'tor-data');

    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch (err) {
      this.emit('status', { running: false, bootstrap: 0, error: 'mkdir_failed', detail: err.message });
      return;
    }

    const args = [
      '--SocksPort', String(TOR_SOCKS_PORT),
      '--ControlPort', String(TOR_CONTROL_PORT),
      '--DataDirectory', dataDir,
      '--Log', 'notice stdout',
      '--CookieAuthentication', '1'
    ];

    this.starting = true;
    this.bootstrapPct = 0;
    this.emit('status', { running: false, bootstrap: 0, starting: true });

    try {
      this.process = spawn(bin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env }
      });
    } catch (err) {
      this.starting = false;
      this.emit('status', { running: false, bootstrap: 0, error: 'spawn_failed', detail: err.message });
      return;
    }

    const parseLog = (data) => {
      const line = data.toString();
      const m = line.match(/Bootstrapped (\d+)%/);
      if (m) {
        this.bootstrapPct = parseInt(m[1], 10);
        if (this.bootstrapPct === 100) {
          this.running = true;
          this.starting = false;
          this.emit('status', { running: true, bootstrap: 100 });
        } else {
          this.emit('status', { running: false, bootstrap: this.bootstrapPct, starting: true });
        }
      }
      if (line.includes('Tor has successfully opened a circuit')) {
        this.running = true;
        this.starting = false;
        this.bootstrapPct = 100;
        this.emit('status', { running: true, bootstrap: 100 });
      }
    };

    this.process.stdout.on('data', parseLog);
    this.process.stderr.on('data', parseLog);

    this.process.on('error', (err) => {
      this.starting = false;
      this.running = false;
      this.process = null;
      this.emit('status', { running: false, bootstrap: 0, error: 'process_error', detail: err.message });
    });

    this.process.on('exit', (code) => {
      this.running = false;
      this.starting = false;
      this.bootstrapPct = 0;
      this.process = null;
      if (code !== 0 && code !== null) {
        this.emit('status', { running: false, bootstrap: 0, error: `exited:${code}` });
      } else {
        this.emit('status', { running: false, bootstrap: 0, error: 'stopped' });
      }
    });

    setTimeout(() => {
      if (!this.running && this.bootstrapPct > 0 && this.bootstrapPct < 100) {
        // Still bootstrapping
      } else if (!this.running && this.bootstrapPct === 0 && this.process) {
        // Might be stuck
      }
    }, 30000);
  }

  stop() {
    if (this.process) {
      try {
        this.process.kill();
      } catch (err) {}
      this.process = null;
    }
    this.running = false;
    this.starting = false;
    this.bootstrapPct = 0;
  }

  getStatus() {
    return { 
      running: this.running, 
      bootstrap: this.bootstrapPct, 
      starting: this.starting,
      proxy: this.socksProxy 
    };
  }
}

module.exports = new TorManager();