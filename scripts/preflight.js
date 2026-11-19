'use strict';
// Readable preflight. Never calls a model. `claude --version` and `claude auth status` are local, non-inference commands.
// Exit code 0 = ready, 1 = something to fix (with the exact next step). Never prints tokens, e-mail or account identity.
const fs = require('fs');
const path = require('path');
const http = require('http');
const APP = path.resolve(__dirname, '..');
const INSTALL_DOC = 'https://code.claude.com/docs/en/quickstart';
const lines = []; let bad = 0;
const ok = (m) => lines.push('  [ OK ] ' + m);
const no = (m, next) => { bad++; lines.push('  [FIX ] ' + m); if (next) lines.push('         Next step: ' + next); };

function health(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 2000 }, (res) => {
      let b = ''; res.on('data', (d) => { if (b.length < 4096) b += d; }); res.on('end', () => { try { resolve({ up: true, json: JSON.parse(b) }); } catch { resolve({ up: true, json: null }); } });
    });
    req.on('error', () => resolve({ up: false })); req.on('timeout', () => { req.destroy(); resolve({ up: false }); });
  });
}
(async () => {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major >= 20) ok('Node.js ' + process.versions.node); else no('Node.js ' + process.versions.node + ' is too old (need 20+).', 'install the LTS version from https://nodejs.org/');
  for (const f of ['server.js', 'src/app.js', 'public/index.html']) if (!fs.existsSync(path.join(APP, f))) no('missing file ' + f, 're-extract the ZIP into a fresh folder');
  const dataDir = process.env.BAY_DATA_DIR ? path.resolve(process.env.BAY_DATA_DIR) : path.join(APP, 'data');
  try { fs.mkdirSync(dataDir, { recursive: true }); const t = path.join(dataDir, '.write-test'); fs.writeFileSync(t, 'x'); fs.unlinkSync(t); ok('data folder is writable'); } catch { no('the data folder is not writable', 'move the app to a folder you can write to (e.g. Documents), not Program Files'); }
  const port = parseInt(process.env.BAY_PORT || '8194', 10);
  let myId = null; try { myId = JSON.parse(fs.readFileSync(path.join(dataDir, 'instance.json'), 'utf8')).instanceId; } catch { /* first run */ }
  const h = await health(port);
  if (!h.up) ok('port ' + port + ' is free');
  else if (h.json && h.json.app === 'bay-office-alpha' && myId && h.json.instanceId === myId) ok('this Bay Office instance is already running on port ' + port);
  else no('port ' + port + ' answers but it is NOT this instance (another program or another Bay Office copy).', 'set a different port, e.g. in PowerShell: $env:BAY_PORT=8195 ; then START again');
  // Claude Code CLI + sign-in (no model request)
  const { makeClaudeProvider } = require('../src/provider');
  const prov = makeClaudeProvider({ runtimeDir: path.join(dataDir, 'runtime') });
  const s = await prov.checkSetup();
  if (s.cli === 'missing') no('Claude Code CLI was not found.', 'install the official Claude Code (' + INSTALL_DOC + '), open a NEW terminal, then run CHECK again. Each person uses their own account.');
  else if (s.cli !== 'found') no('Claude Code CLI could not be run.', 'reinstall it from ' + INSTALL_DOC);
  else {
    ok('Claude Code CLI found' + (s.version ? ' (' + s.version + ')' : ''));
    if (s.auth === 'signed_in') ok('signed in with a Claude subscription account (identity not shown)');
    else if (s.auth === 'not_signed_in') no('Claude Code is not signed in.', 'open a terminal, run: claude   and complete the sign-in in your browser with YOUR OWN Claude account; then run CHECK again.');
    else if (s.auth === 'unsupported_method') no('Claude Code is signed in with a method this alpha has not been tested with (only claude.ai subscription sign-in was tested).', 'run: claude auth login   and choose the Claude subscription (claude.ai) account.');
    else no('could not read the sign-in status.', 'run: claude auth status   in a terminal and follow its message.');
  }
  console.log('Bay Office alpha preflight');
  console.log(lines.join('\n'));
  console.log(bad ? '\nResult: ' + bad + ' item(s) to fix. The app can still open without Claude, but tasks will not run until the items above are OK.' : '\nResult: ready.');
  process.exit(bad ? 1 : 0);
})();
