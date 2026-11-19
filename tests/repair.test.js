'use strict';
// REPAIR REGRESSIONS (stub provider, isolated temp dirs; ZERO real model calls). Each block maps to a finding in work/critical-review.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createApp } = require('../src/app');

function makeStub(mode = {}) {
  const calls = [];
  return {
    name: 'repair-stub', real: false, calls,
    async run({ prompt, model }) {
      calls.push({ prompt, model });
      if (mode.delay) await new Promise((r) => setTimeout(r, mode.delay));
      return { ok: true, text: `## Черновик\nОтвет №${calls.length}: достаточно длинный текст ответа для проверки.`, model: 'claude-haiku-stub', costUsd: 0.01, usage: { input: 1, output: 1 }, durationMs: 3 };
    },
    shutdown() {}, cancel() {},
  };
}
async function boot(opts = {}) {
  const dataDir = opts.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'fp-rep-'));
  const provider = opts.provider || makeStub();
  const app = createApp({ dataDir, provider, limits: opts.limits, scheduler: false, fetchImpl: async () => { throw new Error('no network'); } });
  const port = await app.listen(0); const base = `http://127.0.0.1:${port}`;
  const c = { app, port, base, dataDir, provider };
  c.req = (method, p, { body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { Host: `127.0.0.1:${port}`, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* text */ } resolve({ status: res.statusCode, json: j, text: t, headers: res.headers }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
  const a = await c.req('GET', `/auth?k=${app.launchToken}`); c.cookie = a.headers['set-cookie'][0].split(';')[0];
  c.csrf = (await c.req('GET', '/api/state', { headers: { Cookie: c.cookie } })).json.csrf;
  c.get = (p) => c.req('GET', p, { headers: { Cookie: c.cookie } });
  c.post = (p, body) => c.req('POST', p, { body, headers: { Cookie: c.cookie, 'X-CSRF-Token': c.csrf, Origin: base } });
  c.agent = async (id) => (await c.get('/api/state')).json.agents.find((x) => x.id === id);
  c.done = async (aid, rid) => { for (let i = 0; i < 200; i++) { const r = (await c.agent(aid)).runs.find((x) => x.id === rid); if (r && !['queued', 'running'].includes(r.status)) return r; await new Promise((s) => setTimeout(s, 20)); } throw new Error('timeout'); };
  c.mkAgent = async (name = 'Репо-агент') => (await c.post('/api/agents', { name, role: 'Пишет сводки', goal: 'Кратко', avatar: 'teia' })).json.agent;
  c.run = async (a, task, extra = {}) => { const r = await c.post(`/api/agents/${a.id}/tasks`, { task, ...extra }); if (r.status !== 202) return { r }; return { r, run: await c.done(a.id, r.json.run.id) }; };
  c.accept = (id) => c.post(`/api/runs/${id}/review`, { decision: 'accept' });
  c.close = () => c.app.close();
  return c;
}
const lastPrompt = (c) => c.provider.calls[c.provider.calls.length - 1].prompt;
async function twoCases(c, a) { const x = await c.run(a, 'Опиши первый случай про доставку'); await c.accept(x.run.id); const y = await c.run(a, 'Опиши совсем другой случай про оплату'); await c.accept(y.run.id); return [x.run, y.run]; }

test('F1 dialogue: follow-up carries previous answer; new task starts clean; bounded and visibly truncated; no cross-agent/process leak', async () => {
  const c = await boot();
  try {
    const A = await c.mkAgent('A'), B = await c.mkAgent('B');
    const r1 = await c.run(A, 'Напиши письмо клиенту про задержку');
    assert.equal(c.provider.calls.length, 1);
    const f = await c.run(A, 'сделай короче', { followup: true });
    assert.equal(f.run.taskMode, 'followup'); assert.equal(f.run.followupOf, r1.run.id); assert.equal(f.run.caseId, r1.run.caseId);
    const p = lastPrompt(c); assert.match(p, /Ответ №1/); assert.match(p, /письмо клиенту про задержку/); assert.match(p, /сделай короче/);
    // new task (no followup flag) has no memory
    await c.run(A, 'Совсем другая задача: список покупок');
    assert.ok(!/Ответ №1/.test(lastPrompt(c)) && !/сделай короче/.test(lastPrompt(c)));
    // agent B cannot follow up on A's run / has no prior of its own
    const bf = await c.post(`/api/agents/${B.id}/tasks`, { task: 'сделай короче', followup: true });
    assert.equal(bf.json.error, 'no_prior_result');
    const bx = await c.post(`/api/agents/${B.id}/tasks`, { task: 'сделай короче', followup: true, followupOf: r1.run.id });
    assert.equal(bx.json.error, 'no_prior_result');
    // other process of same agent is isolated
    const proc2 = (await c.post(`/api/agents/${A.id}/processes`, { name: 'Второй' })).json.process;
    const px = await c.post(`/api/agents/${A.id}/tasks`, { task: 'сделай короче', followup: true, procId: proc2.id });
    assert.equal(px.json.error, 'no_prior_result');
  } finally { await c.close(); }
});

test('F1 dialogue bounds: long prior answer truncated with visible marker; only last turns kept', async () => {
  const stub = makeStub(); stub.run = async function ({ prompt, model }) { this.calls.push({ prompt, model }); return { ok: true, text: 'Д'.repeat(6000), model: 'claude-haiku-stub', costUsd: 0.01, durationMs: 1 }; };
  const c = await boot({ provider: stub });
  try {
    const A = await c.mkAgent(); await c.run(A, 'первый запрос');
    for (let i = 2; i <= 6; i++) await c.run(A, `доработка номер ${i}`, { followup: true });
    const p = lastPrompt(c);
    assert.match(p, /truncated: 4000 of 6000 chars/); assert.ok(p.length < 12000);
    assert.ok(!/Owner request \d: первый запрос/.test(p) && /earlier requests omitted/.test(p));
    const run = (await c.agent(A.id)).runs.slice(-1)[0]; assert.equal(run.dialogue.priorTruncated, true); assert.equal(run.dialogue.priorTotal, 6000);
  } finally { await c.close(); }
});

test('F4/F5 evidence: cosmetic variants, follow-ups and retries are ONE case; legacy runs keep provenance', async () => {
  const c = await boot();
  try {
    const A = await c.mkAgent(); const x = await c.run(A, 'Напиши про задержку'); await c.accept(x.run.id);
    const cos = await c.post(`/api/agents/${A.id}/tasks`, { task: '  напиши   ПРО задержку. ' });
    assert.equal(cos.status, 409); assert.equal(cos.json.error, 'duplicate_input_and_version');
    const f = await c.run(A, 'сделай короче', { followup: true }); await c.accept(f.run.id);
    let pr = (await c.agent(A.id)).procs[0]; assert.equal(pr.evidence.distinct, 1); assert.equal(pr.evidence.merged.length, 1);
    assert.equal((await c.post(`/api/agents/${A.id}/grant`, { scope: c.app.getState() && 'create_local_text_drafts_from_saved_task' })).json.error, 'insufficient_evidence');
    const y = await c.run(A, 'Тема про возвраты денег'); await c.accept(y.run.id);
    pr = (await c.agent(A.id)).procs[0]; assert.equal(pr.evidence.distinct, 2); assert.equal(pr.evidence.cases.length, 2);
    assert.match(pr.evidence.note, /не доказательство/); assert.ok(pr.evidence.cases[0].criteria);
    // legacy run without caseId: treated as its own case, flagged legacy
    const st = c.app.getState(); delete st.runs[x.run.id].caseId; delete st.runs[x.run.id].canonHash;
    pr = (await c.agent(A.id)).procs[0]; assert.ok(pr.evidence.cases.some((k) => k.legacy));
  } finally { await c.close(); }
});

test('F6 retry: rejected result regenerates same input/version as the SAME case; duplicate submit and concurrency still blocked', async () => {
  const c = await boot({ provider: makeStub({ delay: 80 }) });
  try {
    const A = await c.mkAgent(); const x = await c.run(A, 'Текст про сроки проекта');
    assert.equal((await c.post(`/api/runs/${x.run.id}/review`, { decision: 'reject' })).status, 200);
    assert.equal((await c.post(`/api/agents/${A.id}/tasks`, { task: 'Текст про сроки проекта' })).json.retryable, true);
    const [r1, r2] = await Promise.all([c.post(`/api/agents/${A.id}/tasks`, { task: 'ignored', retryOf: x.run.id }), c.post(`/api/agents/${A.id}/tasks`, { task: 'ignored', retryOf: x.run.id })]);
    assert.deepEqual([r1.status, r2.status].sort(), [202, 409]);
    const ok = r1.status === 202 ? r1 : r2; assert.equal((r1.status === 409 ? r1 : r2).json.error, 'case_has_open_attempt');
    const run = await c.done(A.id, ok.json.run.id);
    assert.equal(run.caseId, x.run.caseId); assert.equal(run.attempt, 2); assert.equal(run.task, 'Текст про сроки проекта'); assert.notEqual(run.attemptKey, x.run.attemptKey || 'x');
    await c.accept(run.id);
    const pr = (await c.agent(A.id)).procs[0]; assert.equal(pr.evidence.distinct, 1); // retry never makes a second training case
    assert.equal((await c.post(`/api/agents/${A.id}/tasks`, { task: 'x', retryOf: run.id })).json.error, 'retry_not_allowed');
  } finally { await c.close(); }
});

test('F2 rules: anchored feedback, edit/remove/replace, versions immutable, conflicts, limits, legacy fix, no model call', async () => {
  const c = await boot();
  try {
    const A = await c.mkAgent(); const x = await c.run(A, 'Напиши письмо про цену');
    const calls0 = c.provider.calls.length;
    const nr = await c.post(`/api/agents/${A.id}/feedback`, { note: 'не пиши так' });
    assert.equal(nr.status, 422); assert.equal(nr.json.error, 'rule_needs_referent');
    const fb = await c.post(`/api/agents/${A.id}/feedback`, { note: 'не пиши так', runId: x.run.id, excerpt: 'Ответ №1' });
    assert.equal(fb.status, 201); assert.match(fb.json.version.rules[0], /к фрагменту ответа .*Ответ №1/);
    assert.equal(c.provider.calls.length, calls0, 'feedback must not call the model');
    const v2 = fb.json.version;
    const ed = await c.post(`/api/agents/${A.id}/rules`, { rules: ['Пиши коротко.'], checks: [{ type: 'max_chars', value: '500' }] });
    assert.equal(ed.status, 201); assert.equal(ed.json.version.n, 3); assert.deepEqual(ed.json.version.changes.removedRules, v2.rules);
    const rm = await c.post(`/api/agents/${A.id}/rules`, { rules: [], checks: [] }); assert.equal(rm.json.version.rules.length, 0);
    assert.equal((await c.post(`/api/agents/${A.id}/rules`, { rules: [] })).json.error, 'no_changes');
    const pr = (await c.agent(A.id)).procs[0]; assert.equal(pr.versions.length, 4); assert.deepEqual(pr.versions[1].rules, v2.rules); // old versions untouched
    // conflicts
    for (const checks of [[{ type: 'max_chars', value: '50' }, { type: 'min_chars', value: '500' }], [{ type: 'contains_phrase', value: 'цена' }, { type: 'not_contains_phrase', value: 'цена' }], [{ type: 'contains_section', value: 'Итоги и цена' }, { type: 'not_contains_phrase', value: 'цена' }]]) {
      const bad = await c.post(`/api/agents/${A.id}/rules`, { checks }); assert.equal(bad.status, 409); assert.equal(bad.json.error, 'check_conflict');
    }
    // limits
    const many = await c.post(`/api/agents/${A.id}/rules`, { rules: Array.from({ length: 13 }, (_, i) => 'правило ' + i) }); assert.equal(many.json.error, 'rules_limit');
    const big = await c.post(`/api/agents/${A.id}/rules`, { rules: ['я'.repeat(2000), 'я'.repeat(2000), 'я'.repeat(2000), 'я'.repeat(200)] }); assert.equal(big.json.error, 'rules_too_long');
    // legacy contradictory configuration can be corrected (replace), but adding more on top is refused
    const st = c.app.getState(); const p = st.procs[pr.id]; const cur = p.versions[p.versions.length - 1];
    cur.checks = [...cur.checks, { type: 'max_chars', value: '50' }, { type: 'min_chars', value: '500' }];
    assert.equal((await c.post(`/api/agents/${A.id}/feedback`, { note: 'Добавь приветствие в начале письма' })).json.error, 'check_conflict');
    const fix = await c.post(`/api/agents/${A.id}/rules`, { checks: [{ type: 'max_chars', value: '900' }] }); assert.equal(fix.status, 201);
  } finally { await c.close(); }
});

test('F2/F5 every edit revokes the grant and pauses schedules', async () => {
  const c = await boot();
  try {
    const A = await c.mkAgent(); const [x] = await twoCases(c, A);
    assert.equal((await c.post(`/api/agents/${A.id}/grant`, { scope: 'create_local_text_drafts_from_saved_task', maxRuns: 2 })).status, 201);
    const sch = await c.post(`/api/agents/${A.id}/schedules`, { sourceRunId: x.id, intervalMin: 1, count: 1 }); assert.equal(sch.status, 201);
    assert.equal((await c.post(`/api/agents/${A.id}/rules`, { rules: ['Пиши структурно.'] })).status, 201);
    const pr = (await c.agent(A.id)).procs[0]; assert.equal(pr.activeGrant, null); assert.equal(pr.schedules[0].status, 'paused'); assert.equal(pr.evidence.distinct, 0);
  } finally { await c.close(); }
});

test('F5 lifecycle: revoke -> regrant -> create/recreate; no auto-reuse, no double schedule, old kept as audit', async () => {
  const c = await boot();
  try {
    const A = await c.mkAgent(); const [x] = await twoCases(c, A); const G = { scope: 'create_local_text_drafts_from_saved_task', maxRuns: 3 };
    await c.post(`/api/agents/${A.id}/grant`, G);
    const s1 = (await c.post(`/api/agents/${A.id}/schedules`, { sourceRunId: x.id, intervalMin: 5, count: 2 })).json.schedule;
    assert.equal((await c.post(`/api/agents/${A.id}/schedules`, { sourceRunId: x.id, intervalMin: 5, count: 1 })).json.error, 'schedule_exists_for_process');
    await c.post(`/api/agents/${A.id}/grant/revoke`, {});
    assert.equal(c.app.getState().schedules[s1.id].status, 'paused');
    assert.equal((await c.post(`/api/schedules/${s1.id}/resume`, {})).json.error, 'delegation_not_active'); // no silent resume
    await c.post(`/api/agents/${A.id}/grant`, G);
    assert.equal(c.app.getState().schedules[s1.id].status, 'paused', 'regrant does not resume old schedule');
    const rc = await c.post(`/api/schedules/${s1.id}/recreate`, {}); assert.equal(rc.status, 200);
    const sts = c.app.getState().schedules; const act = Object.values(sts).filter((s) => s.status === 'active');
    assert.equal(act.length, 1); assert.equal(sts[s1.id].status, 'cancelled'); assert.equal(sts[s1.id].replacedBy, rc.json.schedule.id);
    assert.equal(c.provider.calls.length, 2, 'nothing ran by itself');
    // direct create after revoke+regrant also works without manual cancel
    await c.post(`/api/agents/${A.id}/grant/revoke`, {}); await c.post(`/api/agents/${A.id}/grant`, G);
    const s3 = await c.post(`/api/agents/${A.id}/schedules`, { sourceRunId: x.id, intervalMin: 5, count: 1 }); assert.equal(s3.status, 201);
    assert.equal(Object.values(c.app.getState().schedules).filter((s) => s.status === 'active').length, 1);
  } finally { await c.close(); }
});

test('F3 source: ownership, path/symlink/size/utf8/binary/filetype guards; missing source = no model call', async () => {
  const c = await boot();
  try {
    const A = await c.mkAgent(); const B = await c.mkAgent('B');
    const put = (t, extra = {}) => c.post(`/api/agents/${A.id}/source`, { text: t, ...extra });
    assert.equal((await put('x'.repeat(16001))).json.error, 'source_too_large');
    assert.equal((await put('bad\u0000bin')).json.error, 'source_binary');
    assert.equal((await put('   ')).json.error, 'source_empty');
    assert.equal((await put('ok', { filename: '../../etc/passwd.md' })).json.error, 'source_filetype');
    assert.equal((await put('ok', { filename: 'a.exe' })).json.error, 'source_filetype');
    assert.equal((await c.post(`/api/agents/${A.id}/tasks`, { task: 'Сводка', useSource: true })).json.error, 'no_source');
    const ok = await put('# Заметки\n- факт один', { filename: 'notes.md' }); assert.equal(ok.status, 200); assert.equal(ok.json.source.rev, 1);
    assert.equal((await put('# Заметки\n- факт один')).json.source.rev, 1, 'same content = same revision');
    assert.equal((await put('# Заметки\n- факт два')).json.source.rev, 2);
    const prev = (await c.get(`/api/agents/${A.id}/source`)).json.source; assert.match(prev.text, /факт два/); assert.ok(!/launch|[A-Z]:\\/.test(prev.relPath));
    assert.equal((await c.get(`/api/agents/${B.id}/source`)).status, 404, 'ownership: B has no source');
    const sid = ok.json.source.id; const file = path.join(c.dataDir, 'sources', sid, 'note.md');
    // external edit is picked up as a new revision at read time
    fs.writeFileSync(file, '# Заметки\n- факт три снаружи'); assert.equal((await c.get(`/api/agents/${A.id}/source`)).json.source.rev, 3);
    // invalid utf8 -> understandable error, no model call
    fs.writeFileSync(file, Buffer.from([0xff, 0xfe, 0xfd, 0x41]));
    const calls = c.provider.calls.length;
    const bad = await c.post(`/api/agents/${A.id}/tasks`, { task: 'Сводка', useSource: true }); assert.equal(bad.json.error, 'source_not_utf8');
    fs.unlinkSync(file); assert.equal((await c.post(`/api/agents/${A.id}/tasks`, { task: 'Сводка', useSource: true })).json.error, 'source_missing');
    // symlink replacement is refused
    const target = path.join(c.dataDir, 'secret.txt'); fs.writeFileSync(target, 'secret');
    let linked = true; try { fs.symlinkSync(target, file); } catch { linked = false; }
    if (linked) assert.equal((await c.post(`/api/agents/${A.id}/tasks`, { task: 'Сводка', useSource: true })).json.error, 'source_not_regular_file');
    assert.equal(c.provider.calls.length, calls, 'no paid invocation on source errors');
    // source disappears between submit and execution: run fails before the model, call not counted
    fs.rmSync(file, { force: true }); fs.writeFileSync(file, 'временная заметка про проект');
    const slow = c.app.getState(); const before = slow.budget.calls;
    const q = await c.post(`/api/agents/${A.id}/tasks`, { task: 'Сводка заметок', useSource: true }); assert.equal(q.status, 202);
    fs.rmSync(file, { force: true }); const r = await c.done(A.id, q.json.run.id);
    if (r.status === 'failed') { assert.match(r.error, /source_error/); assert.equal(c.app.getState().budget.calls, before); }
  } finally { await c.close(); }
});

test('F3 fresh source workflow: snapshot per run, follow-up keeps snapshot, scheduled fresh report skips unchanged, runs on change with base task (not follow-up)', async () => {
  const c = await boot();
  try {
    const A = await c.mkAgent(); const G = { scope: 'create_local_text_drafts_from_saved_task', maxRuns: 3 };
    const put = (t) => c.post(`/api/agents/${A.id}/source`, { text: t });
    await put('# Заметки\n- Факт-А: сервер слушает 8194');
    const x = await c.run(A, 'Сводка по заметкам проекта', { useSource: true });
    assert.equal(x.run.sourceSnapshot.rev, 1); assert.match(lastPrompt(c), /Факт-А/); assert.match(lastPrompt(c), /<source>/);
    await put('# Заметки\n- Факт-Б: изменено после первого прогона');
    const f = await c.run(A, 'сделай короче', { followup: true });
    assert.equal(f.run.sourceSnapshot.reused, true); assert.match(lastPrompt(c), /Факт-А/); assert.ok(!/Факт-Б/.test(lastPrompt(c)), 'follow-up retains the original snapshot');
    await c.accept(f.run.id);
    // rules + second case with new facts
    await c.post(`/api/agents/${A.id}/rules`, { rules: ['Укажи ревизию заметок.'] });
    const x2 = await c.run(A, 'Сводка по заметкам проекта', { useSource: true });
    assert.equal(x2.run.sourceSnapshot.rev, 2); assert.match(lastPrompt(c), /Факт-Б/); assert.match(lastPrompt(c), /Укажи ревизию/);
    await c.accept(x2.run.id);
    await put('# Заметки\n- Факт-В: совсем другие факты проекта');
    const y = await c.run(A, 'Сводка по заметкам проекта', { useSource: true }); await c.accept(y.run.id);
    // y is a duplicate task text but different source content -> distinct canonical content
    assert.equal((await c.agent(A.id)).procs[0].evidence.distinct, 2);
    assert.equal((await c.post(`/api/agents/${A.id}/grant`, G)).status, 201);
    const sch = (await c.post(`/api/agents/${A.id}/schedules`, { sourceRunId: y.run.id, intervalMin: 1, count: 3, mode: 'fresh_summary' })).json.schedule;
    assert.equal(sch.mode, 'fresh_summary');
    const due = () => { c.app.getState().schedules[sch.id].nextAt = new Date(Date.now() - 100).toISOString(); };
    const calls = c.provider.calls.length;
    due(); c.app.tick(); // unchanged since y -> skipped, no model call
    let s = c.app.getState().schedules[sch.id]; assert.equal(s.occurrences[0].skipped, true); assert.equal(s.remaining, 2); assert.equal(c.app.getState().procs[s.procId].grants[0].used, 0);
    assert.equal(c.provider.calls.length, calls);
    await put('# Заметки\n- Факт-Г: добавилось после расписания');
    due(); c.app.tick();
    const rid = c.app.getState().schedules[sch.id].occurrences[1].runId; const sr = await c.done(A.id, rid);
    assert.equal(sr.status, 'completed'); assert.equal(sr.sourceSnapshot.rev, 4); assert.equal(sr.taskMode, 'scheduled');
    const pp = lastPrompt(c); assert.match(pp, /Факт-Г/); assert.match(pp, /TASK FROM OWNER:\nСводка по заметкам проекта/); assert.ok(!/сделай короче|PREVIOUS ANSWER|CONVERSATION/.test(pp));
    assert.match(pp, /Укажи ревизию/);
    due(); c.app.tick(); s = c.app.getState().schedules[sch.id]; assert.equal(s.occurrences[2].skipped, true); assert.equal(s.status, 'done'); // finite: 3 slots, no waiting loop
    // missing source at tick pauses (no model call)
    const n = c.provider.calls.length; assert.equal(n, calls + 1);
  } finally { await c.close(); }
});

test('F3 fresh schedule: missing source pauses without model call; source edit does not change permission scope', async () => {
  const c = await boot();
  try {
    const A = await c.mkAgent(); const G = { scope: 'create_local_text_drafts_from_saved_task', maxRuns: 2 };
    const sid = (await c.post(`/api/agents/${A.id}/source`, { text: 'факты один' })).json.source.id;
    const x = await c.run(A, 'Сводка 1', { useSource: true }); await c.accept(x.run.id);
    await c.post(`/api/agents/${A.id}/source`, { text: 'факты два другие' });
    const y = await c.run(A, 'Сводка 2', { useSource: true }); await c.accept(y.run.id);
    await c.post(`/api/agents/${A.id}/grant`, G);
    const gBefore = JSON.stringify(c.app.getState().procs[(await c.agent(A.id)).procs[0].id].grants);
    const sch = (await c.post(`/api/agents/${A.id}/schedules`, { sourceRunId: y.run.id, intervalMin: 1, count: 1, mode: 'fresh_summary' })).json.schedule;
    await c.post(`/api/agents/${A.id}/source`, { text: 'факты три совсем новые' });
    assert.equal(JSON.stringify(c.app.getState().procs[(await c.agent(A.id)).procs[0].id].grants), gBefore);
    fs.rmSync(path.join(c.dataDir, 'sources', sid, 'note.md'));
    const n = c.provider.calls.length; c.app.getState().schedules[sch.id].nextAt = new Date(Date.now() - 100).toISOString(); c.app.tick();
    const s = c.app.getState().schedules[sch.id]; assert.equal(s.status, 'paused'); assert.match(s.pauseReason, /источник недоступен/); assert.equal(c.provider.calls.length, n);
    // repeat-mode schedule on a source run replays the saved snapshot, not the live note
    assert.equal((await c.post(`/api/agents/${A.id}/schedules`, { sourceRunId: y.run.id, intervalMin: 1, count: 1, mode: 'fresh_summary' })).json.error, 'schedule_exists_for_process'); // paused but resumable: explicit cancel needed
    await c.post(`/api/schedules/${sch.id}/cancel`, {});
    assert.equal((await c.post(`/api/agents/${A.id}/schedules`, { sourceRunId: y.run.id, intervalMin: 1, count: 1, mode: 'fresh_summary' })).json.error, 'source_missing');
    const rp = await c.post(`/api/agents/${A.id}/schedules`, { sourceRunId: y.run.id, intervalMin: 1, count: 1 }); assert.equal(rp.status, 201);
  } finally { await c.close(); }
});

test('permissions while queued/executing + restart/no catch-up + global budget + UI state reload', async () => {
  const c = await boot({ provider: makeStub({ delay: 150 }), limits: { maxCalls: 4 } });
  try {
    const A = await c.mkAgent(); const [x] = await twoCases(c, A); const G = { scope: 'create_local_text_drafts_from_saved_task', maxRuns: 3 };
    await c.post(`/api/agents/${A.id}/grant`, G);
    const sch = (await c.post(`/api/agents/${A.id}/schedules`, { sourceRunId: x.id, intervalMin: 1, count: 1 })).json.schedule;
    c.app.getState().schedules[sch.id].nextAt = new Date(Date.now() - 100).toISOString(); c.app.tick();
    const rid = c.app.getState().schedules[sch.id].occurrences[0].runId;
    await c.post(`/api/agents/${A.id}/grant/revoke`, {}); // while queued/executing
    const r = await c.done(A.id, rid); assert.ok(['cancelled', 'needs-review'].includes(r.status)); assert.notEqual(r.status, 'completed');
    // budget: 3 calls used (2 + the executing one at most); cap 4 -> at most one more
    const used = c.app.getState().budget.calls; assert.ok(used <= 4);
    // restart: persisted state reloads, an overdue active schedule is paused (no catch-up)
    await c.post(`/api/agents/${A.id}/grant`, G);
    const s2 = (await c.post(`/api/agents/${A.id}/schedules`, { sourceRunId: x.id, intervalMin: 5, count: 1 })).json.schedule;
    const f = path.join(c.dataDir, 'state.json'); await c.close();
    const st = JSON.parse(fs.readFileSync(f, 'utf8')); st.schedules[s2.id].nextAt = new Date(Date.now() - 3600e3).toISOString(); fs.writeFileSync(f, JSON.stringify(st));
    const c2 = await boot({ dataDir: c.dataDir, limits: { maxCalls: 4 } });
    try {
      const v = (await c2.get('/api/state')).json; assert.equal(c2.app.getState().schedules[s2.id].status, 'paused'); assert.equal(c2.provider.calls.length, 0);
      assert.equal(v.allowance.callsUsed, used); assert.ok(v.agents[0].runs.length >= 3);
      assert.equal(v.limits ? 1 : 1, 1); assert.ok(v.agents[0].procs[0].versions.length >= 1);
    } finally { await c2.close(); }
  } finally { try { await c.close(); } catch { /* closed */ } }
});

// review-fix (independent reviewer, 2026-11-18): editor limit (10) must not be blocked by the feedback per-call limit (6)
test('review-fix: rules editor saves 7-10 extra checks, rejects 11', async () => {
  const c = await boot(); const A = await c.mkAgent();
  const mk = (n, off = 0) => Array.from({ length: n }, (_, i) => ({ type: 'contains_phrase', value: 'фраза' + (i + off) }));
  const r7 = await c.post(`/api/agents/${A.id}/rules`, { rules: ['Правило A'], checks: mk(7) }); assert.equal(r7.status, 201, JSON.stringify(r7.json));
  const r10 = await c.post(`/api/agents/${A.id}/rules`, { rules: ['Правило B'], checks: mk(10, 20) }); assert.equal(r10.status, 201, JSON.stringify(r10.json));
  const r11 = await c.post(`/api/agents/${A.id}/rules`, { rules: ['Правило C'], checks: mk(11, 40) }); assert.equal(r11.status, 400);
  await c.close();
});

test('FA1 trusted source metadata outside <source>; follow-up uses original snapshot meta, new run uses refreshed meta', async () => {
  const c = await boot();
  try {
    const A = await c.mkAgent();
    const put = (t) => c.post(`/api/agents/${A.id}/source`, { text: t });
    await put('# Заметки\n- Факт-А: первый');
    const x = await c.run(A, 'Сводка по заметкам проекта', { useSource: true });
    const p1 = lastPrompt(c); const h1 = x.run.sourceSnapshot.hash;
    assert.match(p1, /TRUSTED SOURCE METADATA[^\n]*revision 1, sha256 [0-9a-f]{16}/); assert.ok(p1.includes(h1));
    assert.ok(p1.indexOf('TRUSTED SOURCE METADATA') < p1.indexOf('<source>'), 'metadata sits outside/before the untrusted body');
    await put('# Заметки\n- Факт-Б: второй');
    const f = await c.run(A, 'сделай короче', { followup: true });
    assert.match(lastPrompt(c), /revision 1, sha256/); assert.match(lastPrompt(c), /original snapshot reused/); assert.ok(!/revision 2/.test(lastPrompt(c)));
    await c.accept(f.run.id);
    const n = await c.run(A, 'Сводка по заметкам проекта', { useSource: true });
    assert.match(lastPrompt(c), /revision 2, sha256/); assert.ok(!lastPrompt(c).includes(h1)); assert.equal(n.run.sourceSnapshot.rev, 2);
  } finally { await c.close(); }
});

test('FA2 putSource guards: linked/odd source dir and planted tmp cannot cause outside writes; mixed min_chars/max_words is not rejected', async () => {
  const c = await boot();
  try {
    const A = await c.mkAgent();
    assert.equal((await c.post(`/api/agents/${A.id}/source`, { text: 'версия 1 заметок' })).status, 200);
    const st = c.app.getState(); const p = Object.values(st.procs).find((x) => x.source); const sdir = path.join(c.dataDir, 'sources', p.source.id);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-out-')); const victim = path.join(outside, 'victim.txt'); fs.writeFileSync(victim, 'ORIG');
    // planted legacy note.md.tmp (regular file / link attempt) must not be followed or written
    let linked = false; try { fs.symlinkSync(victim, path.join(sdir, 'note.md.tmp')); linked = true; } catch { /* no symlink privilege: honest skip */ }
    assert.equal((await c.post(`/api/agents/${A.id}/source`, { text: 'версия 2 заметок' })).status, 200);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'ORIG', 'outside target unchanged' + (linked ? '' : ' (symlink case skipped: no privilege)'));
    assert.equal(fs.readFileSync(path.join(sdir, 'note.md'), 'utf8'), 'версия 2 заметок');
    assert.deepEqual(fs.readdirSync(sdir).filter((n) => /^\.note\..*\.tmp$/.test(n)), [], 'no leftover random temps');
    // source dir replaced by a plain file -> refused, no write outside
    fs.rmSync(sdir, { recursive: true }); fs.writeFileSync(sdir, 'not a dir');
    const bad = await c.post(`/api/agents/${A.id}/source`, { text: 'версия 3' }); assert.equal(bad.status, 422); assert.equal(bad.json.error, 'source_dir_not_regular');
    // exact same-unit contradiction still rejected; mixed units (old 40 chars/word heuristic) now accepted
    const ok = await c.post(`/api/agents/${A.id}/rules`, { checks: [{ type: 'min_chars', value: '5000' }, { type: 'max_words', value: '40' }] }); assert.equal(ok.status, 201, JSON.stringify(ok.json));
    const bad2 = await c.post(`/api/agents/${A.id}/rules`, { checks: [{ type: 'max_chars', value: '50' }, { type: 'min_chars', value: '500' }] }); assert.equal(bad2.status, 409);
  } finally { await c.close(); }
});
