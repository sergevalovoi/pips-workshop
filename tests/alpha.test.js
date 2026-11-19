'use strict';
// ALPHA PORTABILITY TESTS. Everything here uses a stub provider or a node-script "CLI" stub that only answers
// `--version` / `auth status` and FAILS the test if it is ever asked to run a model request (-p). No real Claude, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const { createApp } = require('../src/app');
const milestones = require('../src/milestones');

const ROOT = path.resolve(__dirname, '..');
const SECRET_TASK = 'ZEBRA-SECRET-TASK-TEXT-12345 please summarise';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function req(port, method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { Host: '127.0.0.1:' + port, ...headers } }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: b, json: (() => { try { return JSON.parse(b); } catch { return null; } })() }));
    });
    r.on('error', reject); if (body) r.write(body); r.end();
  });
}
async function login(port, token) {
  const r = await req(port, 'GET', '/auth?k=' + token);
  const cookie = String(r.headers['set-cookie'] || '').split(';')[0];
  const st = await req(port, 'GET', '/api/state', { headers: { Cookie: cookie } });
  const post = (p, o) => req(port, 'POST', p, { headers: { Cookie: cookie, Origin: 'http://127.0.0.1:' + port, 'X-CSRF-Token': st.json.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify(o || {}) });
  const get = (p) => req(port, 'GET', p, { headers: { Cookie: cookie } });
  return { post, get, state: st.json };
}
function stubProvider() {
  const calls = [];
  return { calls, name: 'unit-stub', real: false, async run({ prompt }) { calls.push(prompt); return { ok: true, text: '## Draft\nA long enough stub answer for the mechanical checks to pass. [' + calls.length + ']', model: 'claude-haiku-stub', costUsd: 0.01, usage: {}, durationMs: 3 }; }, shutdown() {}, cancel() {} };
}
async function until(fn, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timeout'); }

test('milestones export: derived, no text/names/paths, real-vs-stub provenance, no extra model call', async () => {
  const dataDir = tmp('alpha-ms-'); const provider = stubProvider();
  const app = createApp({ dataDir, provider, instanceId: 'a'.repeat(32), edition: 'alpha', appVersion: '0.2.0' });
  const port = await app.listen(0); const c = await login(port, app.launchToken);
  const empty = await c.get('/api/export/milestones');
  assert.equal(empty.status, 200); assert.deepEqual(empty.json.events, []); assert.equal(empty.json.missingEvents.length, 8);
  assert.match(empty.headers['content-disposition'], /attachment/);
  const ag = await c.post('/api/agents', { name: 'SecretAgentName', role: 'SecretRoleText about things', goal: '', avatar: 'teia', lang: 'en' });
  assert.equal(ag.status, 201); assert.equal(ag.json.agent.procIds.length, 1);
  const pid = ag.json.agent.procIds[0];
  const t = await c.post('/api/agents/' + ag.json.agent.id + '/tasks', { procId: pid, task: SECRET_TASK, context: 'SecretContext', mode: 'new' });
  assert.equal(t.status, 202, JSON.stringify(t.json));
  await until(() => Object.values(app.getState().runs).some((r) => r.status === 'needs-review'));
  const before = provider.calls.length;
  const ex = await c.get('/api/export/milestones');
  const csv = await c.get('/api/export/milestones?format=csv');
  assert.equal(provider.calls.length, before, 'export must not call the model');
  const names = ex.json.events.map((e) => e.event);
  assert.ok(names.includes('agent_created') && names.includes('first_result'));
  assert.equal(ex.json.events.find((e) => e.event === 'first_result').provenance, 'stub');
  assert.equal(ex.json.runCounts.stub.success, 1); assert.equal(ex.json.runCounts.real.success, 0);
  for (const bad of [SECRET_TASK, 'SecretAgentName', 'SecretRoleText', 'SecretContext', dataDir, os.tmpdir(), 'Draft', 'launch', app.launchToken]) { assert.ok(!ex.text.includes(bad), 'json leaks ' + bad); assert.ok(!csv.text.includes(bad), 'csv leaks ' + bad); }
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.ok(csv.text.split(String.fromCharCode(13, 10))[0].startsWith('event,at'));
  // unit: a stub run never counts as real
  const u = milestones.build(app.getState(), { appVersion: 'x', edition: 'alpha', limits: { maxCalls: 20 } }, new Date().toISOString());
  assert.equal(u.runCounts.real.success, 0);
  // export requires a session
  const anon = await req(port, 'GET', '/api/export/milestones'); assert.equal(anon.status, 401);
  await app.close();
});

test('health exposes instance identity; setup endpoints require session and CSRF', async () => {
  const dataDir = tmp('alpha-h-'); const app = createApp({ dataDir, provider: stubProvider(), instanceId: 'b'.repeat(32), edition: 'alpha' });
  const port = await app.listen(0);
  const h = await req(port, 'GET', '/health'); assert.equal(h.json.app, 'bay-office-alpha'); assert.equal(h.json.instanceId, 'b'.repeat(32));
  assert.equal((await req(port, 'GET', '/api/setup')).status, 401);
  assert.equal((await req(port, 'POST', '/api/setup/check', { headers: { Origin: 'http://127.0.0.1:' + port, 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  const c = await login(port, app.launchToken);
  assert.equal((await c.get('/api/setup')).json.stub, true);
  await app.close();
});

// ---------- real server.js + CLI stub script ----------
function writeCliStub(dir, mode) {
  const f = path.join(dir, 'cli-stub.js'); const log = path.join(dir, 'cli-calls.log');
  fs.writeFileSync(f, `const fs=require('fs');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},a.join(' ')+'\\n');
if(a.includes('-p')){process.stderr.write('MODEL REQUEST FORBIDDEN IN TESTS');process.exit(99);}
if(a[0]==='--version'){console.log('9.9.9 (stub)');process.exit(0);}
if(a[0]==='auth'){const m=${JSON.stringify(mode)};if(m==='out'){console.log(JSON.stringify({loggedIn:false}));process.exit(1);}
 if(m==='api'){console.log(JSON.stringify({loggedIn:true,authMethod:'api_key',email:'leak@example.com'}));process.exit(0);}
 console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',email:'leak@example.com',orgName:'LeakOrg'}));process.exit(0);}
process.exit(2);`);
  return { f, log };
}
function startServer({ dataDir, port, env = {} }) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, env: { ...process.env, BAY_PORT: String(port), BAY_DATA_DIR: dataDir, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '', err = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
  return { child, out: () => out, err: () => err, exited: new Promise((r) => child.on('exit', (code) => r(code))) };
}
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
async function healthy(port) { return until(async () => { try { const r = await req(port, 'GET', '/health'); return r.json && r.json.app === 'bay-office-alpha' ? r.json : null; } catch { return null; } }, 10000); }

test('server.js: own data dir, identity, no token in console, setup check without model call, auth variants', async () => {
  const dataDir = path.join(tmp('alpha space-'), 'my data'); const sdir = tmp('alpha-cli-');
  const port = await freePort();
  const results = {};
  for (const mode of ['in', 'out', 'api']) {
    const { f, log } = writeCliStub(sdir, mode);
    const s = startServer({ dataDir, port, env: { CLAUDE_BIN: process.execPath, BAY_CLI_PREFIX_ARGS: JSON.stringify([f]) } });
    const h = await healthy(port);
    const ident = JSON.parse(fs.readFileSync(path.join(dataDir, 'instance.json'), 'utf8'));
    assert.equal(h.instanceId, ident.instanceId); assert.match(ident.instanceId, /^[a-f0-9]{32}$/);
    const url = fs.readFileSync(path.join(dataDir, 'launch-url.txt'), 'utf8').trim(); const token = new URL(url).searchParams.get('k');
    assert.ok(!s.out().includes(token) && !s.err().includes(token), 'token must not be printed');
    const c = await login(port, token);
    assert.equal((await c.get('/api/setup')).json.cli, 'unchecked', 'opening the app must not run the CLI');
    const chk = await c.post('/api/setup/check', {});
    results[mode] = chk.json; assert.ok(!JSON.stringify(chk.json).includes('leak'), 'identity must not be exposed');
    // duplicate start on same data dir is refused, foreign file untouched
    const dup = startServer({ dataDir, port: await freePort() });
    assert.notEqual(await dup.exited, 0); assert.match(dup.err(), /already used by a running instance/);
    s.child.kill(); await s.exited;
    const calls = fs.readFileSync(log, 'utf8'); assert.ok(!/(^| )-p( |$)/m.test(calls), 'no model request');
    assert.ok(!fs.existsSync(path.join(dataDir, 'cli-calls.log')));
    try { fs.unlinkSync(path.join(dataDir, 'runtime.lock')); } catch { /* killed hard on Windows */ }
  }
  assert.deepEqual([results.in.cli, results.in.auth], ['found', 'signed_in']);
  assert.equal(results.out.auth, 'not_signed_in'); assert.equal(results.api.auth, 'unsupported_method');
  // missing CLI
  const s2 = startServer({ dataDir, port, env: { CLAUDE_BIN: path.join(sdir, 'definitely-missing-cli') } }); await healthy(port);
  const token2 = new URL(fs.readFileSync(path.join(dataDir, 'launch-url.txt'), 'utf8').trim()).searchParams.get('k'); const c2 = await login(port, token2);
  assert.equal((await c2.post('/api/setup/check', {})).json.cli, 'missing');
  // a task without CLI/auth fails readably, counts, never retried
  const ag = await c2.post('/api/agents', { name: 'X', role: 'role text', goal: '', avatar: 'mark', lang: 'en' });
  const tk = await c2.post('/api/agents/' + ag.json.agent.id + '/tasks', { procId: ag.json.agent.procIds[0], task: 'do a thing please', context: '', mode: 'new' }); assert.equal(tk.status, 202, JSON.stringify(tk.json));
  const st = await until(async () => { const j = (await c2.get('/api/state')).json; return j.agents.some((a) => a.chat.some((m) => m.role === 'error')) ? j : null; });
  assert.match(st.agents[0].chat.find((m) => m.role === 'error').text, /auth_not_claude_ai/); assert.equal(st.allowance.callsUsed, 0, 'a call that never reached the model is not charged');
  s2.child.kill(); await s2.exited;
});

test('server.js: foreign port rejected, bad port/data-dir rejected, data confined', async () => {
  const dataDir = tmp('alpha-f-'); const port = await freePort();
  const foreign = http.createServer((q, r) => { r.end('hi'); }); await new Promise((r) => foreign.listen(port, '127.0.0.1', r));
  const s = startServer({ dataDir, port }); assert.notEqual(await s.exited, 0); assert.match(s.err(), /already in use/);
  assert.ok(!fs.existsSync(path.join(dataDir, 'runtime.lock')) && !fs.existsSync(path.join(dataDir, 'server.pid')));
  foreign.close();
  const badPort = startServer({ dataDir, port: 'abc' }); assert.notEqual(await badPort.exited, 0); assert.match(badPort.err(), /invalid port/);
  const nonEmpty = tmp('alpha-ne-'); fs.writeFileSync(path.join(nonEmpty, 'precious.txt'), 'x');
  const ne = startServer({ dataDir: nonEmpty, port: await freePort() }); assert.notEqual(await ne.exited, 0); assert.match(ne.err(), /not a Bay Office data folder/);
  assert.equal(fs.readdirSync(nonEmpty).join(), 'precious.txt');
  const inSrc = startServer({ dataDir: path.join(ROOT, 'src', 'x'), port: await freePort() }); assert.notEqual(await inSrc.exited, 0); assert.match(inSrc.err(), /must not be/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'x')));
});

test('portable source hygiene: no private paths/names, no legacy page, allowance capped', () => {
  const bad = [/C:[\\/]+(AI Prod|Users)/i, /live-d[a]ta/, /val[o]voy/i, /819[2]/];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (['node_modules', 'data', '.git'].includes(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
  for (const f of walk(ROOT)) {
    if (!/\.(js|cjs|html|css|json|ps1|cmd|md)$/.test(f) || f.endsWith('alpha.test.js')) continue;
    const t = fs.readFileSync(f, 'utf8');
    for (const re of bad) assert.ok(!re.test(t), path.relative(ROOT, f) + ' matches ' + re);
  }
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(src, /ALPHA_MAX_CALLS = 20/); assert.match(src, /Math\.min\(n, ALPHA_MAX_CALLS\)/);
});

test('i18n: dictionary complete for wrapped strings, placeholders consistent, language reload only', () => {
  const dict = (() => { const w = {}; new Function('window', fs.readFileSync(path.join(ROOT, 'public', 'i18n-en.js'), 'utf8'))(w); return w.BAY_EN; })();
  assert.ok(Object.keys(dict).length > 500);
  for (const [k, v] of Object.entries(dict)) assert.equal((k.match(/\{\}/g) || []).length, (v.match(/\{\}/g) || []).length, k.slice(0, 40));
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.ok(!/innerHTML|eval\(/.test(app));
});

test('milestones semantics: failed checks / rejected / cosmetic copies / cross-version are not success', () => {
  const T = (m) => new Date(Date.UTC(2026, 10, 19, 8, m)).toISOString();
  const run = (id, o) => ({ id, kind: 'task', mode: 'manual', procId: 'p1', versionHash: 'h1', live: false, result: 'text', validation: { allPassed: true }, createdAt: T(1), finishedAt: T(2), caseId: id, canonHash: id, status: 'accepted', review: { decision: 'accept', at: T(3) }, ...o });
  const ctx = { appVersion: 'x', edition: 'alpha', limits: { maxCalls: 20 } };
  const ev = (st) => milestones.build(st, ctx, T(10)); const names = (x) => x.events.map((e) => e.event);
  // scheduled run whose checks failed (held for review) must not be scheduled_result_success
  const bad = { agents: {}, procs: {}, schedules: {}, runs: { s1: run('s1', { mode: 'scheduled', status: 'needs-review', review: null, validation: { allPassed: false } }) } };
  assert.ok(!names(ev(bad)).includes('scheduled_result_success'));
  assert.equal(ev(bad).runCounts.stub.success, 0);
  const ok = { agents: {}, procs: {}, schedules: {}, runs: { s1: run('s1', { mode: 'scheduled', status: 'completed', autoCompleted: true, review: null }) } };
  assert.ok(names(ev(ok)).includes('scheduled_result_success'));
  // two accepted runs, different versions -> no second_case_reviewed
  const xv = { agents: {}, procs: {}, schedules: {}, runs: { a: run('a', {}), b: run('b', { versionHash: 'h2', review: { decision: 'accept', at: T(4) } }) } };
  assert.ok(!names(ev(xv)).includes('second_case_reviewed'));
  // cosmetic copy (same canonHash) -> no
  const cp = { agents: {}, procs: {}, schedules: {}, runs: { a: run('a', { canonHash: 'z' }), b: run('b', { canonHash: 'z', review: { decision: 'accept', at: T(4) } }) } };
  assert.ok(!names(ev(cp)).includes('second_case_reviewed'));
  // check-failed accepted-looking run -> no
  const cf = { agents: {}, procs: {}, schedules: {}, runs: { a: run('a', {}), b: run('b', { validation: { allPassed: false }, review: { decision: 'accept', at: T(4) } }) } };
  assert.ok(!names(ev(cf)).includes('second_case_reviewed'));
  // genuine pair -> yes
  const good = { agents: {}, procs: {}, schedules: {}, runs: { a: run('a', {}), b: run('b', { review: { decision: 'accept', at: T(4) } }) } };
  assert.ok(names(ev(good)).includes('second_case_reviewed'));
});

test('i18n: user-authored names equal to UI labels are not translated inside server messages', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'i18n.js'), 'utf8');
  assert.ok(/function trParam/.test(src) && !/m\.slice\(1\)\.map\(trp\)/.test(src));
});
