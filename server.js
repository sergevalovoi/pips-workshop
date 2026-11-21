'use strict';
// Bay Office alpha: portable local server. Binds 127.0.0.1 only. Runtime data lives in ./data (or a validated --data-dir).
// No model call happens at startup, on page load, on polling or on the connection check.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const pkg = require('./package.json');

const APP_DIR = __dirname;
const DEFAULT_PORT = 8194;
const ALPHA_MAX_CALLS = 20;      // documented finite alpha allowance: NOT a Claude subscription quota
const ALPHA_MAX_USD = 3.0;       // price-list estimate ceiling for those calls (not a bill)
const MIN_NODE_MAJOR = 20;

function fail(msg, code = 1) { console.error('Bay Office: ' + msg); process.exit(code); }

// ---- Node preflight ----
const major = parseInt(process.versions.node.split('.')[0], 10);
if (major < MIN_NODE_MAJOR) fail(`Node.js ${MIN_NODE_MAJOR} or newer is required (this is ${process.versions.node}). Install the LTS version from https://nodejs.org/ and run START again.`);

// ---- argument / env parsing ----
function argVal(name) { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; }
const portRaw = argVal('--port') || process.env.BAY_PORT || String(DEFAULT_PORT);
if (!/^\d{1,5}$/.test(portRaw) || +portRaw < 1024 || +portRaw > 65535) fail(`invalid port "${portRaw}": use a whole number from 1024 to 65535 (BAY_PORT or --port).`);
const PORT = parseInt(portRaw, 10);

// ---- data directory: ./data by default; an explicit one must be empty, new, or already a Bay Office data dir ----
function resolveDataDir() {
  const raw = argVal('--data-dir') || process.env.BAY_DATA_DIR;
  if (!raw) return path.join(APP_DIR, 'data');
  if (/[\u0000-\u001f]/.test(raw)) fail('invalid data directory: control characters in path.');
  const p = path.resolve(raw);
  if (path.parse(p).root === p) fail('refusing a filesystem root as the data directory.');
  const inside = (child, parent) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
  for (const sub of ['', 'src', 'public', 'tests']) { const guarded = path.join(APP_DIR, sub); if (sub === '' ? p === APP_DIR : inside(p, guarded)) fail('the data directory must not be the app folder or inside its source folders (' + sub + ').'); }
  if (fs.existsSync(p)) {
    if (!fs.statSync(p).isDirectory()) fail('the data path exists and is not a folder.');
    const entries = fs.readdirSync(p);
    const foreign = entries.filter((n) => n !== 'server.out.log' && n !== 'server.err.log'); // the launcher creates these two log files before the server starts
    if (foreign.length && !entries.includes('instance.json')) fail('the data folder is not empty and is not a Bay Office data folder (no instance.json). Choose an empty or new folder.');
  }
  return p;
}
const dataDir = resolveDataDir();
fs.mkdirSync(dataDir, { recursive: true });

// ---- instance identity (random, local; used by START/STOP/CHECK to prove "this is MY instance") ----
const idFile = path.join(dataDir, 'instance.json');
let instance;
try { instance = JSON.parse(fs.readFileSync(idFile, 'utf8')); } catch { instance = null; }
if (!instance || !/^[a-f0-9]{32}$/.test(instance.instanceId || '')) {
  instance = { app: 'bay-office-alpha', instanceId: crypto.randomBytes(16).toString('hex'), createdAt: new Date().toISOString(), version: pkg.version };
  fs.writeFileSync(idFile, JSON.stringify(instance, null, 2));
}

// ---- single runtime owner per data dir ----
const lockFile = path.join(dataDir, 'runtime.lock');
function acquireLock() {
  for (let i = 0; i < 2; i++) {
    try { fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' }); return; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let pid = 0; try { pid = parseInt(fs.readFileSync(lockFile, 'utf8'), 10); } catch { /* ignore */ }
      let alive = false; if (pid && pid !== process.pid) { try { process.kill(pid, 0); alive = true; } catch { alive = false; } }
      if (alive) fail('this data folder is already used by a running instance (pid ' + pid + '). Use STOP first, or another data folder.');
      try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
    }
  }
  fail('could not acquire the runtime lock.');
}
acquireLock();

const { createApp } = require('./src/app');
const { makeClaudeProvider } = require('./src/provider');
const provider = makeClaudeProvider({ runtimeDir: path.join(dataDir, 'runtime') });
const limits = { maxCalls: ALPHA_MAX_CALLS, maxUsd: ALPHA_MAX_USD };
// env may only LOWER the allowance, never raise it
if (process.env.BAY_MAX_CALLS) { const n = parseInt(process.env.BAY_MAX_CALLS, 10); if (Number.isFinite(n) && n >= 0) limits.maxCalls = Math.min(n, ALPHA_MAX_CALLS); }
const app = createApp({ dataDir, provider, limits, instanceId: instance.instanceId, edition: 'alpha', appVersion: pkg.version });

function cleanup() {
  for (const f of ['server.pid', 'runtime.lock', 'launch-url.txt']) { try { fs.unlinkSync(path.join(dataDir, f)); } catch { /* ignore */ } }
}
app.listen(PORT).then((port) => {
  fs.writeFileSync(path.join(dataDir, 'launch-url.txt'), `http://127.0.0.1:${port}/auth?k=${app.launchToken}\n`); // private local file; never printed
  fs.writeFileSync(path.join(dataDir, 'server.pid'), String(process.pid));
  fs.writeFileSync(path.join(dataDir, 'server.port'), String(port));
  console.log(`Bay Office alpha ${pkg.version} listening on http://127.0.0.1:${port}/ (loopback only). Use START.cmd to open it with a private launch link.`);
}).catch((e) => {
  cleanup();
  if (e && e.code === 'EADDRINUSE') fail(`port ${PORT} is already in use by another program. Nothing was changed. Pick another port (BAY_PORT or --port).`);
  fail('could not listen: ' + (e.code || e.message));
});

let closing = false;
async function stop() {
  if (closing) return; closing = true;
  try { await app.close(); } catch { /* ignore */ }
  cleanup();
  process.exit(0);
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
