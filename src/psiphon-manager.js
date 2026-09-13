/**
 * psiphon-manager.js
 * Finds and starts Psiphon3 headlessly, parses its local SOCKS5 port from
 * stdout JSON notices, and exposes it as a proxy string.
 */

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

class PsiphonManager extends EventEmitter {
  constructor() {
    super();
    this.process  = null;
    this.running  = false;
    this.starting = false;
    this.socksPort = null;
    this.socksProxy = null;
  }

  _findBinary(app) {
    const candidates = [];
    if (app) {
      const res = process.resourcesPath || '';
      candidates.push(path.join(res, 'psiphon-bin', 'psiphon3.exe'));
      candidates.push(path.join(res, 'psiphon-bin', 'psiphon3'));
    }
    const appDir = app ? path.dirname(app.getPath('exe')) : __dirname;
    candidates.push(path.join(appDir,   'psiphon-bin', 'psiphon3.exe'));
    candidates.push(path.join(__dirname, '..', 'psiphon-bin', 'psiphon3.exe'));
    candidates.push(path.join(process.cwd(), 'psiphon-bin', 'psiphon3.exe'));

    for (const c of candidates) {
      try { if (fs.existsSync(c)) return c; } catch (_) {}
    }
    return null;
  }

  async start(app) {
    if (this.running || this.starting) return;

    const bin = this._findBinary(app);
    if (!bin) {
      this.emit('status', { running: false, error: 'not_found' });
      return;
    }

    const dataDir = app
      ? path.join(app.getPath('userData'), 'psiphon-data')
      : path.join(__dirname, '..', 'psiphon-data');
    fs.mkdirSync(dataDir, { recursive: true });

    this.starting = true;
    this.emit('status', { running: false, starting: true });

    try {
      this.process = spawn(bin, ['--headless'], {
        cwd: dataDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env }
      });
    } catch (err) {
      this.starting = false;
      this.emit('status', { running: false, error: 'spawn_failed', detail: err.message });
      return;
    }

    const parseLine = (data) => {
      const text = data.toString();
      // Psiphon emits JSON notice lines: {"noticeType":"ListeningSocksProxyPort","data":{"port":1081}}
      for (const line of text.split('\n')) {
        try {
          const obj = JSON.parse(line.trim());
          if (obj.noticeType === 'ListeningSocksProxyPort' && obj.data?.port) {
            this.socksPort  = obj.data.port;
            this.socksProxy = `socks5://127.0.0.1:${this.socksPort}`;
            this.running    = true;
            this.starting   = false;
            this.emit('status', { running: true, port: this.socksPort, proxy: this.socksProxy });
          }
          if (obj.noticeType === 'Tunnels' && obj.data?.count === 0 && this.running) {
            this.emit('status', { running: false, starting: true, reconnecting: true });
          }
          if (obj.noticeType === 'Tunnels' && obj.data?.count > 0) {
            this.running  = true;
            this.starting = false;
            this.emit('status', { running: true, port: this.socksPort, proxy: this.socksProxy });
          }
        } catch (_) {
          // Not JSON — plain log line, ignore
        }
      }
    };

    this.process.stdout.on('data', parseLine);
    this.process.stderr.on('data', parseLine);

    this.process.on('error', (err) => {
      this.starting = false; this.running = false; this.process = null;
      this.emit('status', { running: false, error: 'process_error', detail: err.message });
    });
    this.process.on('exit', (code) => {
      this.running = false; this.starting = false;
      this.socksPort = null; this.socksProxy = null; this.process = null;
      this.emit('status', { running: false, error: code ? `exited:${code}` : 'stopped' });
    });
  }

  stop() {
    if (this.process) { try { this.process.kill(); } catch (_) {} this.process = null; }
    this.running = false; this.starting = false;
    this.socksPort = null; this.socksProxy = null;
  }

  getStatus() {
    return { running: this.running, starting: this.starting, port: this.socksPort, proxy: this.socksProxy };
  }
}

module.exports = new PsiphonManager();
