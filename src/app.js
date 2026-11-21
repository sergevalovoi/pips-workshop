'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { BATCHES, REPOS, fetchSnapshot, sha } = require('./sources');
const { validate, extractJson, CHECK_CATALOG, BASE_CHECKS } = require('./validate');
const { MODELS } = require('./provider');
const agentsMod = require('./agents');

const PROCESS_ID = 'fastpay-brief';
const GRANT_SCOPE = 'create_local_draft_brief_for_allowlisted_sources';
const SNAP_TTL_MS = 30 * 60 * 1000;
const MAX_BODY = 16 * 1024;
const REVIEWER = 'agent-reviewed (Claude/Codex under delegated authority; NOT approved by the owner)';

const V1_INSTRUCTIONS = [
  'TASK: Write a source-backed competitive/release brief for FastPay (a visual "Pip\'s Workshop" teaching-and-delegation workspace for AI agents) comparing the first repository ("ours") with the second repository, using ONLY the supplied snapshots.',
  'Separate exactly observed facts from interpretation. State limits. Give one practical implication for FastPay and ONE prioritized next product task with a rationale and an acceptance criterion.',
].join('\n');

const OUTPUT_SPEC = `Return ONE JSON object with exactly these keys:
{
 "summary": string (2-4 sentences),
 "observed_facts": [ { "repo": "<full_name exactly as in the snapshot>", "field": one of ["stargazers_count","forks_count","open_issues_count","subscribers_count","language","license","created_at","pushed_at","archived","default_branch","description","latest_release_tag","latest_release_date","readme_quote"], "value": <exact value from snapshot; for readme_quote a VERBATIM excerpt of 8-200 chars from that repo's README>, "source_url": "<one of the item urls given for that repo>" } ],
 "interpretation": [ { "text": string, "based_on": [indexes into observed_facts] } ],
 "limits": [string],
 "unknowns": [string],
 "fastpay_implication": string,
 "next_priority": { "title": string, "rationale": string, "acceptance_criterion": string }
}
Use only values present in the snapshots. If a value is null in the snapshot, do not cite it as a number.`;

function now() { return new Date().toISOString(); }
function rid(p) { return `${p}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`; }
function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
class HttpErr extends Error { constructor(status, code, extra) { super(code); this.status = status; this.code = code; this.extra = extra || {}; } }

function createApp(opts) {
  const dataDir = opts.dataDir;
  const provider = opts.provider;
  const fetchImpl = opts.fetchImpl || fetch;
  // cumulative caps incl. the 4 calls (~$0.02) already spent by the earlier GitHub-brief iteration: 12 calls, $2.03
  const limits = { maxCalls: 12, maxUsd: 2.03, perCallUsd: 0.25, timeoutMs: 120000, ...(opts.limits || {}) };
  const publicDir = opts.publicDir || path.join(__dirname, '..', 'public');
  for (const d of ['snapshots', 'receipts', 'reports', 'runtime']) fs.mkdirSync(path.join(dataDir, d), { recursive: true });
  const stateFile = path.join(dataDir, 'state.json');
  const instanceId = opts.instanceId || null, edition = opts.edition || 'alpha', appVersion = opts.appVersion || '0.2.1';
  const milestones = require('./milestones');
  const launchToken = opts.launchToken || crypto.randomBytes(24).toString('base64url');
  const sessionSecret = crypto.randomBytes(32);
  const sessions = new Map();
  let allowedHosts = new Set();
  let server = null;
  let working = false;
  let shuttingDown = false;
  let tickTimer = null;

  // ---------- state ----------
  let state;
  const agents = agentsMod.attach({ HttpErr, now, rid, cleanText: (s, m) => cleanText(s, m), logEv: (t, r) => logEv(t, r), save: () => save(), provider, limits, dataDir, getState: () => state, budgetCheck: () => budgetCheck(), pump: () => pump() });
  function freshState() {
    const v1 = mkVersion(1, { instructions: V1_INSTRUCTIONS, rules: [], checks: [...BASE_CHECKS], model: 'haiku', examples: [], note: 'Initial baseline instruction', basedOnRun: null });
    return { schema: 2, agents: {}, procs: {}, schedules: {}, process: { id: PROCESS_ID, versions: [v1] }, runs: {}, order: [], grants: [], budget: { calls: 0, usd: 0, halted: false, haltReason: null }, snapshotCache: {}, log: [] };
  }
  function mkVersion(n, v) {
    const body = { instructions: v.instructions, rules: v.rules, checks: v.checks, model: v.model, examples: v.examples };
    return { n, id: `v${n}`, createdAt: now(), ...body, note: v.note, basedOnRun: v.basedOnRun, reviewer: n === 1 ? 'system' : REVIEWER, hash: sha(JSON.stringify(body)).slice(0, 16) };
  }
  function load() {
    const existed = fs.existsSync(stateFile);
    if (existed) { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); if (!state.schema || state.schema < 2) { try { fs.copyFileSync(stateFile, stateFile + '.schema1.bak'); } catch { /* ignore */ } } } else state = freshState();
    let changed = agents.onLoad(state);
    for (const r of Object.values(state.runs)) {
      if (r.status === 'running' || r.status === 'queued') {
        r.status = 'interrupted'; r.finishedAt = now(); r.error = 'server_restarted_before_completion (not replayed automatically)'; changed = true;
        logEv(`Run ${r.id} marked interrupted after restart`, r.id);
      }
    }
    if (!existed || changed) save();
  }
  function save() { const tmp = stateFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state, null, 1)); fs.renameSync(tmp, stateFile); }
  function logEv(text, runId) { state.log.push({ t: now(), text, runId: runId || null }); if (state.log.length > 500) state.log.shift(); }
  const curVersion = () => state.process.versions[state.process.versions.length - 1];
  const activeGrant = () => state.grants.find((g) => g.active && g.versionN === curVersion().n) || null;

  // ---------- sources ----------
  async function getSnapshot(key) {
    const c = state.snapshotCache[key];
    if (c && Date.now() - Date.parse(c.fetchedAt) < SNAP_TTL_MS) {
      const f = path.join(dataDir, 'snapshots', c.id + '.json');
      if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
    }
    const s = await fetchSnapshot(key, fetchImpl);
    if (s.rateRemaining != null && s.rateRemaining < 5) throw new HttpErr(429, 'github_rate_limit_low', { remaining: s.rateRemaining });
    const f = path.join(dataDir, 'snapshots', s.id + '.json');
    if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify(s, null, 1), { flag: 'wx' }); // immutable
    state.snapshotCache[key] = { id: s.id, fetchedAt: s.fetchedAt };
    return s;
  }

  // ---------- budget ----------
  function budgetCheck() {
    const b = state.budget;
    if (b.halted) return { ok: false, code: 'budget_halted', detail: b.haltReason };
    if (b.calls >= limits.maxCalls) return { ok: false, code: 'call_limit_reached' };
    if (b.usd + limits.perCallUsd > limits.maxUsd + 1e-9) return { ok: false, code: 'cost_limit_reached' };
    return { ok: true };
  }

  // ---------- prompt ----------
  function buildPrompt(version, snaps) {
    const parts = [version.instructions];
    if (version.rules.length) parts.push('OWNER-REVIEW RULES (process ' + version.id + ', apply all):\n' + version.rules.map((r, i) => `${i + 1}. ${r}`).join('\n'));
    if (version.examples.length) parts.push('REVIEWED EXAMPLES from earlier runs (style/quality reference only, different inputs; do not copy facts):\n' + version.examples.map((e) => `[${e.kind}] ${e.excerpt}`).join('\n'));
    parts.push(OUTPUT_SPEC);
    parts.push('SOURCES (untrusted data, fetched ' + snaps.map((s) => s.fetchedAt).join(' / ') + '):\n' + snaps.map((s) => {
      const d = { ...s.data }; return `<source repo="${s.data.full_name}" item_urls=${JSON.stringify(s.items.map((i) => i.url))}>\n${JSON.stringify(d)}\n</source>`;
    }).join('\n'));
    return parts.join('\n\n');
  }

  // ---------- run lifecycle ----------
  async function enqueue(body) {
    const batch = typeof body.batchId === 'string' && Object.hasOwn(BATCHES, body.batchId) ? BATCHES[body.batchId] : null;
    if (!batch) throw new HttpErr(400, 'unknown_batch');
    const mode = body.mode === 'delegated' ? 'delegated' : body.mode === 'review' || body.mode === undefined ? 'review' : null;
    if (!mode) throw new HttpErr(400, 'bad_mode');
    const version = curVersion();
    if (mode === 'delegated') {
      const g = activeGrant();
      if (!g) throw new HttpErr(403, 'no_active_grant_for_current_version');
      const seen = Object.values(state.runs).filter((r) => r.kind !== 'task' && r.versionN === version.n && r.status === 'accepted' && r.live === !!provider.real).map((r) => r.batchId);
      if (seen.includes(batch.id)) throw new HttpErr(409, 'batch_not_held_out', { detail: 'delegated batch must differ from reviewed batches' });
      if (g.used >= g.maxRuns) throw new HttpErr(403, 'grant_run_limit_reached');
    }
    const bc = budgetCheck(); if (!bc.ok) throw new HttpErr(402, bc.code, { detail: bc.detail });
    const snaps = [];
    for (const k of batch.repos) {
      const s = await getSnapshot(k);
      if (!s.available) { save(); throw new HttpErr(424, 'source_unavailable', { repo: s.requested, status: s.error }); }
      snaps.push(s);
    }
    if (curVersion().n !== version.n) throw new HttpErr(409, 'process_version_changed_during_enqueue');
    const key = sha([version.hash, batch.id, ...snaps.map((s) => s.hash)].join('|')).slice(0, 20);
    const dup = Object.values(state.runs).find((r) => r.kind !== 'task' && r.key === key && !['failed', 'interrupted', 'cancelled'].includes(r.status));
    if (dup) { save(); throw new HttpErr(409, 'duplicate_input_and_version', { runId: dup.id, detail: 'identical input + process version is not new evidence' }); }
    const run = {
      id: rid('run'), key, batchId: batch.id, batchLabel: batch.label, mode, status: 'queued', createdAt: now(),
      versionN: version.n, versionId: version.id, versionHash: version.hash, model: version.model, checks: [...version.checks],
      snapshots: snaps.map((s) => ({ id: s.id, repo: s.data.full_name, fetchedAt: s.fetchedAt, hash: s.hash, requested: s.requested, redirected: s.canonical.redirected, urls: s.items.map((i) => ({ kind: i.kind, url: i.url, status: i.status, sha256: i.sha256 })) })),
      provider: provider.real ? provider.name : `TEST-STUB:${provider.name}`, live: !!provider.real,
      promptSha: null, usage: null, costUsd: null, actualModel: null, result: null, validation: null, review: null, error: null,
    };
    if (mode === 'delegated') { const g = activeGrant(); if (!g || g.used >= g.maxRuns) throw new HttpErr(403, 'grant_changed_or_exhausted'); g.used++; run.grantId = g.id; }
    state.runs[run.id] = run; state.order.push(run.id);
    logEv(`Queued ${mode} run for batch ${batch.id} with process ${version.id}`, run.id);
    save();
    setImmediate(pump);
    return run;
  }

  async function pump() {
    if (working || shuttingDown) return;
    const id = state.order.find((i) => state.runs[i].status === 'queued');
    if (!id) return;
    working = true;
    const run = state.runs[id];
    try {
      const bc = budgetCheck();
      if (!bc.ok) { run.status = 'failed'; run.error = 'budget_stop:' + bc.code; run.finishedAt = now(); logEv(`Run stopped before provider call: ${bc.code}`, id); if (run.kind === 'task' && state.agents[run.agentId]) state.agents[run.agentId].chat.push({ id: rid('msg'), t: now(), role: 'error', runId: id, text: 'Запуск остановлен до вызова модели: ' + bc.code }); save(); return; }
      if (run.kind === 'task') { await agents.executeTask(run); return; }
      const version = state.process.versions[run.versionN - 1];
      const snaps = run.snapshots.map((s) => JSON.parse(fs.readFileSync(path.join(dataDir, 'snapshots', s.id + '.json'), 'utf8')));
      const prompt = buildPrompt(version, snaps);
      run.promptSha = sha(prompt); run.status = 'running'; run.startedAt = now();
      state.budget.calls++; // reserve before the call; counts failures too
      logEv(`Run started on ${run.model}`, id); save();
      const r = await provider.run({ model: run.model, prompt, timeoutMs: limits.timeoutMs, maxUsd: limits.perCallUsd, runId: run.id });
      fs.writeFileSync(path.join(dataDir, 'receipts', run.id + '.json'), JSON.stringify({ runId: run.id, at: now(), promptSha: run.promptSha, prompt, provider: run.provider, response: r }, null, 1));
      run.finishedAt = now(); run.durationMs = r.durationMs ?? null; run.usage = r.usage || null; run.costUsd = r.costUsd ?? null; run.actualModel = r.model || null; run.costBasis = r.costBasis || null;
      state.budget.usd += typeof r.costUsd === 'number' ? r.costUsd : limits.perCallUsd; // unknown cost charged at per-call cap
      const modelMismatch = r.ok && r.model && !String(r.model).toLowerCase().includes(run.model);
      if (run.status === 'cancelled') { save(); return; }
      if (!r.ok) {
        run.status = 'failed'; run.error = r.error + (r.detail ? ': ' + r.detail : '');
        if (r.rateLimited) { state.budget.halted = true; state.budget.haltReason = 'rate/overage signal on ' + run.id; }
        logEv(`Run failed: ${run.error}`, id); save(); return;
      }
      if (modelMismatch) { run.status = 'failed'; run.error = 'unexpected_model:' + r.model; state.budget.halted = true; state.budget.haltReason = 'unexpected model on ' + run.id; logEv('Run failed: ' + run.error, id); save(); return; }
      const out = extractJson(r.text);
      run.result = out;
      run.rawTextSha = sha(String(r.text));
      run.validation = validate(out, snaps, run.checks);
      const g = state.grants.find((x) => x.id === run.grantId);
      const covered = snaps.every((sn) => Array.isArray(out && out.observed_facts) && out.observed_facts.filter((f) => String(f && f.repo).toLowerCase() === sn.data.full_name.toLowerCase()).length >= 3);
      if (run.mode === 'delegated' && run.validation.allPassed && covered && g && g.active) {
        run.status = 'completed'; run.autoCompleted = true;
        writeReport(run, snaps);
        logEv('Delegated run completed automatically: all deterministic checks passed (not human-reviewed)', id);
      } else {
        run.status = 'needs-review';
        if (run.mode === 'delegated') run.holdReason = !(g && g.active) ? 'grant revoked before completion' : (covered ? 'deterministic check failed' : 'fewer than 3 observed facts for a repository');
        writeReport(run, snaps);
        logEv(run.validation.allPassed ? 'Run needs review' : 'Run needs review: some checks failed', id);
      }
      save();
    } catch (e) {
      run.status = 'failed'; run.error = 'internal:' + String(e.message).slice(0, 200); run.finishedAt = now(); logEv('Run failed: ' + run.error, id); save();
      if (run.kind === 'task' && state.agents[run.agentId]) { state.agents[run.agentId].chat.push({ id: rid('msg'), t: now(), role: 'error', runId: id, text: 'Ошибка выполнения: ' + run.error }); save(); }
    } finally {
      working = false;
      if (!shuttingDown) setImmediate(pump);
    }
  }

  function writeReport(run, snaps) {
    const o = run.result; if (!o) return;
    const L = [`# FastPay brief — batch ${run.batchId} (${run.batchLabel})`, '',
      `Run ${run.id} · process ${run.versionId} (hash ${run.versionHash}) · mode ${run.mode} · model ${run.actualModel || run.model} via ${run.provider}`,
      `Sources: ${snaps.map((s) => `${s.data.full_name} @ ${s.fetchedAt}`).join('; ')}`, '', '## Summary', o.summary, '', '## Observed facts (mechanically verified against snapshots)'];
    o.observed_facts.forEach((f, i) => L.push(`${i}. **${f.repo}** ${f.field}: ${JSON.stringify(f.value)} — ${f.source_url}`));
    L.push('', '## Interpretation'); o.interpretation.forEach((x) => L.push(`- ${typeof x === 'string' ? x : x.text}`));
    L.push('', '## Limits'); o.limits.forEach((x) => L.push(`- ${x}`));
    L.push('', '## Unknowns'); (o.unknowns || []).forEach((x) => L.push(`- ${x}`));
    L.push('', '## Implication for FastPay', o.fastpay_implication, '', '## Next priority', `**${o.next_priority.title}**`, o.next_priority.rationale, '', `Acceptance criterion: ${o.next_priority.acceptance_criterion}`, '',
      '## Deterministic checks', ...run.validation.checks.map((c) => `- [${c.pass ? 'x' : ' '}] ${c.id}: ${c.detail}`), '',
      run.autoCompleted ? '_Completed under delegated draft grant; not human-reviewed. Strategic quality is not scored by this tool._' : '_Strategic quality requires a separate reviewer assessment._');
    fs.writeFileSync(path.join(dataDir, 'reports', run.id + '.md'), L.join('\n'));
    run.reportFile = `reports/${run.id}.md`;
  }

  // ---------- owner actions ----------
  function reviewRun(id, body) {
    const run = state.runs[id]; if (!run) throw new HttpErr(404, 'unknown_run');
    if (run.kind === 'task') return agents.reviewTask(run, body);
    if (run.status !== 'needs-review') throw new HttpErr(409, 'run_not_awaiting_review', { status: run.status });
    const decision = body.decision; if (!['accept', 'reject'].includes(decision)) throw new HttpErr(400, 'bad_decision');
    const note = cleanText(body.note, 1500);
    if (decision === 'accept' && !(run.validation && run.validation.allPassed)) throw new HttpErr(409, 'cannot_accept_failed_checks');
    run.review = { decision, note, at: now(), reviewer: REVIEWER };
    run.status = decision === 'accept' ? 'accepted' : 'rejected';
    logEv(`Reviewer ${decision}ed run (agent-reviewed): ${note.slice(0, 120)}`, id); save(); return run;
  }
  function cleanText(s, max) {
    if (s === undefined || s === null) return '';
    if (typeof s !== 'string') throw new HttpErr(400, 'bad_text');
    if (s.length > max) throw new HttpErr(413, 'text_too_long', { max });
    return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  }
  function addFeedback(body) {
    const note = cleanText(body.note, 2000);
    if (!note) throw new HttpErr(400, 'note_required');
    const rules = Array.isArray(body.rules) ? body.rules : [];
    if (rules.length > 6) throw new HttpErr(413, 'too_many_rules');
    const cleanRules = rules.map((r) => cleanText(r, 400)).filter(Boolean);
    const add = Array.isArray(body.addChecks) ? body.addChecks : [];
    for (const c of add) if (!CHECK_CATALOG[c]) throw new HttpErr(400, 'unknown_check', { check: String(c).slice(0, 40) });
    let model = body.model === undefined ? curVersion().model : body.model;
    if (!MODELS.includes(model)) throw new HttpErr(400, 'model_not_allowed');
    const base = curVersion();
    const examples = [...base.examples];
    if (body.exampleRunId) {
      const r = state.runs[body.exampleRunId];
      if (!r || !r.result || r.status !== 'accepted') throw new HttpErr(400, 'example_run_must_be_accepted');
      examples.push({ runId: r.id, kind: 'good', excerpt: JSON.stringify({ limits: r.result.limits, unknowns: r.result.unknowns, next_priority: r.result.next_priority }).slice(0, 1500) });
      if (examples.length > 3) examples.shift();
    }
    if (!cleanRules.length && !add.length && !body.exampleRunId && model === base.model) throw new HttpErr(400, 'feedback_has_no_effect');
    const v = mkVersion(base.n + 1, { instructions: base.instructions, rules: [...base.rules, ...cleanRules], checks: [...new Set([...base.checks, ...add])], model, examples, note, basedOnRun: body.basedOnRunId && state.runs[body.basedOnRunId] ? body.basedOnRunId : null });
    state.process.versions.push(v);
    for (const g of state.grants) if (g.active) { g.active = false; g.revokedAt = now(); g.revokedReason = `new process version ${v.id}; grants do not carry over`; }
    logEv(`Reviewer feedback saved as process ${v.id} (hash ${v.hash}); previous grant (if any) revoked`, null);
    save(); return v;
  }
  function grant(body) {
    const version = curVersion();
    const ok = Object.values(state.runs).filter((r) => r.kind !== 'task' && r.versionN === version.n && r.status === 'accepted' && r.live === !!provider.real);
    const distinct = new Set(ok.map((r) => r.batchId));
    if (distinct.size < 2) throw new HttpErr(409, 'insufficient_evidence', { detail: 'need >=2 accepted runs on distinct batches at the current process version', have: distinct.size });
    if (activeGrant()) throw new HttpErr(409, 'grant_already_active');
    if (body.scope !== GRANT_SCOPE) throw new HttpErr(400, 'scope_not_allowed', { allowed: GRANT_SCOPE });
    const maxRuns = Math.min(Math.max(parseInt(body.maxRuns || 1, 10) || 1, 1), 3);
    const g = { id: rid('grant'), scope: GRANT_SCOPE, versionN: version.n, versionHash: version.hash, grantedAt: now(), by: REVIEWER, maxRuns, used: 0, active: true, evidenceRuns: ok.map((r) => r.id), note: cleanText(body.note, 500) };
    state.grants.push(g); logEv(`Draft autonomy granted for ${version.id}: ${GRANT_SCOPE} (max ${maxRuns} run(s))`, null); save(); return g;
  }
  function revoke() {
    const g = activeGrant(); if (!g) throw new HttpErr(409, 'no_active_grant');
    g.active = false; g.revokedAt = now(); g.revokedReason = 'revoked by reviewer';
    for (const r of Object.values(state.runs)) if (r.mode === 'delegated' && r.status === 'queued') { r.status = 'cancelled'; r.error = 'grant revoked'; }
    logEv('Draft autonomy revoked', null); save(); return g;
  }
  function cancelRun(id) {
    const run = state.runs[id]; if (!run) throw new HttpErr(404, 'unknown_run');
    if (!['queued', 'running'].includes(run.status)) throw new HttpErr(409, 'not_cancellable');
    const was = run.status; const tk = was === 'running' && run.kind === 'task'; run.status = tk ? 'interrupted' : 'cancelled'; run.finishedAt = now(); run.error = tk ? 'остановлено владельцем во время выполнения (дочерний процесс убит по возможности)' : 'cancelled by reviewer';
    if (was === 'running') provider.cancel && provider.cancel();
    logEv('Run cancelled', id); save(); return run;
  }

  // ---------- view ----------
  function view() {
    const runs = state.order.map((i) => state.runs[i]).filter((r) => r.kind !== 'task');
    const g = activeGrant();
    const timeline = [];
    for (const v of state.process.versions) timeline.push({ t: v.createdAt, who: v.n === 1 ? 'system' : 'reviewer', text: v.n === 1 ? `Process v1 created: baseline instruction.` : `Feedback saved as process ${v.id}: ${v.note}${v.rules.length ? ' — rules now: ' + v.rules.length : ''}` });
    for (const r of runs) {
      timeline.push({ t: r.createdAt, who: 'system', runId: r.id, text: `Run ${r.id} queued (${r.mode}, batch ${r.batchId}, ${r.versionId})` });
      if (r.result && r.finishedAt) timeline.push({ t: r.finishedAt, who: 'pip', runId: r.id, text: `[${r.actualModel || r.model}] ${r.result.summary || ''}` });
      if (r.status === 'failed' || r.status === 'interrupted') timeline.push({ t: r.finishedAt || r.createdAt, who: 'pip', runId: r.id, text: `Run ${r.status}: ${r.error || ''}` });
      if (r.review) timeline.push({ t: r.review.at, who: 'reviewer', runId: r.id, text: `${r.review.decision} (agent-reviewed): ${r.review.note}` });
    }
    for (const x of state.grants) { timeline.push({ t: x.grantedAt, who: 'reviewer', text: `Granted: ${x.scope}, ${x.versionId || 'v' + x.versionN}` }); if (x.revokedAt) timeline.push({ t: x.revokedAt, who: 'reviewer', text: `Grant revoked: ${x.revokedReason}` }); }
    timeline.sort((a, b) => a.t.localeCompare(b.t));
    const running = runs.find((r) => r.status === 'running') || runs.find((r) => r.status === 'queued');
    return {
      mode: provider.real ? 'LIVE-LOCAL' : 'TEST-STUB', providerName: provider.name, serverTime: now(),
      process: { id: PROCESS_ID, current: curVersion().n, versions: state.process.versions }, batches: Object.values(BATCHES).map((b) => ({ ...b, repoSlugs: b.repos.map((k) => REPOS[k]) })),
      runs, grant: g, grants: state.grants, budget: { ...state.budget, limits }, checkCatalog: CHECK_CATALOG, models: MODELS, grantScope: GRANT_SCOPE,
      worldState: running ? (running.status === 'running' ? 'working' : 'queued') : runs.some((r) => r.status === 'needs-review') ? 'review' : g ? 'delegated' : 'idle',
      timeline: timeline.slice(-80), log: state.log.slice(-40), ...agents.view(), schema: state.schema,
      allowance: { callsUsed: state.budget.calls, maxCalls: limits.maxCalls, callsRemaining: Math.max(0, limits.maxCalls - state.budget.calls), usd: state.budget.usd, maxUsd: limits.maxUsd, perCallUsd: limits.perCallUsd, timeoutMs: limits.timeoutMs, halted: state.budget.halted, haltReason: state.budget.haltReason, queue: Object.values(state.runs).filter((r) => r.kind === 'task' && ['queued', 'running'].includes(r.status)).length },
    };
  }

  // ---------- HTTP ----------
  function setPort(port) { allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]); }
  const hdrs = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'Cache-Control': 'no-store' };
  function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
    res.writeHead(status, { 'Content-Type': type, ...hdrs, ...extra });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  }
  function parseCookies(h) { const o = {}; for (const p of String(h || '').split(';')) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); } return o; }
  function sessionOf(req) { const c = parseCookies(req.headers.cookie).fp_session; return c && sessions.has(c) ? c : null; }
  const csrfFor = (sid) => crypto.createHmac('sha256', sessionSecret).update(sid).digest('base64url');
  function readBody(req, max = MAX_BODY) {
    return new Promise((resolve, reject) => {
      let n = 0; const chunks = [];
      let big = false;
      req.on('data', (c) => { n += c.length; if (n > max) { big = true; chunks.length = 0; if (n > 4e6) req.destroy(); } else chunks.push(c); });
      req.on('end', () => { if (big) return reject(new HttpErr(413, 'body_too_large')); try { const t = Buffer.concat(chunks).toString('utf8'); resolve(t ? JSON.parse(t) : {}); } catch { reject(new HttpErr(400, 'bad_json')); } });
      req.on('error', () => reject(new HttpErr(400, 'read_error')));
    });
  }
  const STATIC = { '/bay/shell.js': ['bay/shell.js', 'text/javascript; charset=utf-8'], '/bay/office-layout.js': ['bay/office-layout.js', 'text/javascript; charset=utf-8'], '/bay/office-behavior.js': ['bay/office-behavior.js', 'text/javascript; charset=utf-8'], '/bay/camera.js': ['bay/camera.js', 'text/javascript; charset=utf-8'], '/bay/office-scene.js': ['bay/office-scene.js', 'text/javascript; charset=utf-8'], '/bay/camera-ui.js': ['bay/camera-ui.js', 'text/javascript; charset=utf-8'], '/bay/office2.css': ['bay/office2.css', 'text/css; charset=utf-8'], '/bay/bay-extra.css': ['bay/bay-extra.css', 'text/css; charset=utf-8'], '/i18n.js': ['i18n.js', 'text/javascript; charset=utf-8'], '/i18n-en.js': ['i18n-en.js', 'text/javascript; charset=utf-8'], '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'] };

  const ASSETS = { '/assets/bay/teia.webp': 'teia.webp', '/assets/bay/mark.webp': 'mark.webp', '/assets/bay/atlas.webp': 'atlas.webp', '/assets/bay/nora.webp': 'nora.webp' };

  async function handle(req, res) {
    try {
      if (!allowedHosts.has(String(req.headers.host || '').toLowerCase())) throw new HttpErr(403, 'bad_host');
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (p === '/favicon.ico') return send(res, 204, '');
        if (p === '/health') return send(res, 200, { ok: true, app: 'bay-office-alpha', version: appVersion, instanceId, mode: provider.real ? 'LIVE-LOCAL' : 'TEST-STUB' });
        if (p === '/auth') {
          const k = url.searchParams.get('k') || '';
          if (!safeEq(k, launchToken)) throw new HttpErr(403, 'bad_launch_token');
          const sid = crypto.randomBytes(24).toString('base64url'); sessions.set(sid, now());
          return send(res, 302, '', 'text/plain', { Location: '/', 'Set-Cookie': `fp_session=${sid}; HttpOnly; SameSite=Strict; Path=/` });
        }
        if (ASSETS[p]) return send(res, 200, fs.readFileSync(path.join(publicDir, 'assets', 'bay', ASSETS[p])), 'image/webp', { 'Cache-Control': 'private, max-age=3600' });
        if (STATIC[p]) { const [f, t] = STATIC[p]; return send(res, 200, fs.readFileSync(path.join(publicDir, f)), t); }
        const sid = sessionOf(req); if (!sid) throw new HttpErr(401, 'no_session');
        if (p === '/api/state') return send(res, 200, { csrf: csrfFor(sid), edition, appVersion, ...view() });
        if (p === '/api/setup') return send(res, 200, provider.setupStatus ? provider.setupStatus() : { cli: 'unknown', auth: 'unknown', checkedAt: null, stub: true });
        if (p === '/api/export/milestones') {
          const fmtq = url.searchParams.get('format') === 'csv' ? 'csv' : 'json';
          const ex = milestones.build(state, { provider, limits, appVersion, edition }, now());
          const body = fmtq === 'csv' ? milestones.toCsv(ex) : JSON.stringify(ex, null, 2) + String.fromCharCode(10);
          return send(res, 200, body, fmtq === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8', { 'Content-Disposition': 'attachment; filename="bay-office-milestones.' + fmtq + '"' });
        }
        let m;
        if ((m = p.match(/^\/api\/agents\/(agent_[a-z0-9]+)\/source$/))) return send(res, 200, { source: agents.getSource(m[1], url.searchParams.get('procId') || undefined) });
        if ((m = p.match(/^\/api\/runs\/(run_[a-z0-9]+)\/report$/))) {
          const r = state.runs[m[1]]; if (!r || !r.reportFile) throw new HttpErr(404, 'no_report');
          return send(res, 200, fs.readFileSync(path.join(dataDir, r.reportFile)), 'text/plain; charset=utf-8');
        }
        throw new HttpErr(404, 'not_found');
      }
      if (req.method !== 'POST') throw new HttpErr(405, 'method_not_allowed');
      // mutations: session + CSRF + Origin + content-type
      const origin = req.headers.origin;
      if (!origin || !(origin === `http://${req.headers.host}` && allowedHosts.has(String(req.headers.host).toLowerCase()))) throw new HttpErr(403, 'bad_origin');
      if (req.headers['sec-fetch-site'] && !['same-origin'].includes(req.headers['sec-fetch-site'])) throw new HttpErr(403, 'cross_site');
      const sid = sessionOf(req); if (!sid) throw new HttpErr(401, 'no_session');
      if (!safeEq(req.headers['x-csrf-token'] || '', csrfFor(sid))) throw new HttpErr(403, 'bad_csrf');
      if (!/^application\/json(;|$)/i.test(req.headers['content-type'] || '')) throw new HttpErr(415, 'json_required');
      const body = await readBody(req, /^\/api\/agents\//.test(p) ? 64 * 1024 : MAX_BODY);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpErr(400, 'bad_body');
      let m;
      if (p === '/api/runs') { const run = await enqueue(body); return send(res, 202, { run }); }
      if ((m = p.match(/^\/api\/runs\/(run_[a-z0-9]+)\/review$/))) return send(res, 200, { run: reviewRun(m[1], body) });
      if ((m = p.match(/^\/api\/runs\/(run_[a-z0-9]+)\/cancel$/))) return send(res, 200, { run: cancelRun(m[1]) });
      if (p === '/api/process/feedback') return send(res, 201, { version: addFeedback(body) });
      if (p === '/api/grant') return send(res, 201, { grant: grant(body) });
      if (p === '/api/grant/revoke') return send(res, 200, { grant: revoke() });
      if (p === '/api/agents') return send(res, 201, { agent: agents.createAgent(body) });
      if ((m = p.match(/^\/api\/agents\/(agent_[a-z0-9]+)\/(update|processes|tasks|feedback|rules|source|grant|grant\/revoke|schedules)$/))) {
        const aid = m[1], act = m[2];
        if (act === 'update') return send(res, 200, { agent: agents.updateAgent(aid, body) });
        if (act === 'processes') return send(res, 201, { process: agents.createProcess(aid, body) });
        if (act === 'tasks') return send(res, 202, { run: agents.startTask(aid, body) });
        if (act === 'feedback') return send(res, 201, { version: agents.feedback(aid, body) });
        if (act === 'rules') return send(res, 201, { version: agents.editRules(aid, body) });
        if (act === 'source') return send(res, 200, { source: agents.putSource(aid, body) });
        if (act === 'grant') return send(res, 201, { grant: agents.grant(aid, body) });
        if (act === 'grant/revoke') return send(res, 200, { grant: agents.revoke(aid, body) });
        return send(res, 201, { schedule: agents.createSchedule(aid, body) });
      }
      if ((m = p.match(/^\/api\/schedules\/(sch_[a-z0-9]+)\/(pause|resume|cancel|recreate)$/))) return send(res, 200, { schedule: agents.scheduleAction(m[1], m[2]) });
      if (p === '/api/setup/check') { if (!provider.checkSetup) throw new HttpErr(409, 'setup_check_unavailable'); return send(res, 200, await provider.checkSetup()); }
      if (p === '/api/budget/resume') { state.budget.halted = false; state.budget.haltReason = null; save(); return send(res, 200, { ok: true }); }
      throw new HttpErr(404, 'not_found');
    } catch (e) {
      if (e instanceof HttpErr) return send(res, e.status, { error: e.code, ...e.extra });
      console.error('internal error', e && e.message);
      return send(res, 500, { error: 'internal_error' });
    }
  }

  function listen(port = 8194) {
    return new Promise((resolve, reject) => {
      server = http.createServer((q, s) => { handle(q, s); });
      server.on('error', reject);
      server.listen(port, '127.0.0.1', () => { const actual = server.address().port; setPort(actual); if (opts.scheduler !== false) { tickTimer = setInterval(() => { try { agents.tick(); } catch (e) { console.error('tick error', e && e.message); } }, opts.tickMs || 4000); } resolve(actual); });
    });
  }
  async function close() {
    shuttingDown = true; if (tickTimer) clearInterval(tickTimer);
    provider.shutdown && provider.shutdown();
    for (const r of Object.values(state.runs)) if (r.status === 'running' || r.status === 'queued') { r.status = 'interrupted'; r.error = 'server_shutdown'; r.finishedAt = now(); }
    save();
    if (server) await new Promise((r) => { server.close(r); server.closeAllConnections && server.closeAllConnections(); });
  }
  load();
  return { listen, close, handle, launchToken, getState: () => state, setPort, pump, tick: () => agents.tick() };
}
module.exports = { createApp, GRANT_SCOPE, PROCESS_ID };
