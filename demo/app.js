'use strict';
/* Pip's Workshop — Simulation / Demo. Single append-only event log -> pure reducer -> world + chat + tabs.
   No network, no real model calls. Persistence: localStorage "fastpay.demo.v1". */
(function () {
const KEY = 'fastpay.demo.v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- domain data (synthetic) ---------- */
const BASE_CRIT = [
  { id: 'sections', label: 'All four sections are present', short: 'Sections complete', check: true },
  { id: 'numbers', label: 'Numbers match the inputs; unknown values stay flagged', short: 'Numbers match', check: true },
  { id: 'exceptions', label: 'Every exception is listed for you', short: 'Exceptions listed', check: true }
];
const SOURCES_CRIT = { id: 'sources', label: 'Every number names its source', short: 'Sources named', check: true };
const SRC = { roles: 'Ops sheet', cands: 'ATS export', ints: 'ATS export', made: 'ATS export', acc: 'ATS export', starts: 'ATS export' };
const LBL = { roles: 'Open roles', cands: 'New candidates', ints: 'Interviews held', made: 'Offers made', acc: 'Offers accepted', starts: 'People started' };
const SECT = [
  { id: 'pipeline', title: 'Pipeline', f: ['roles', 'cands', 'ints'] },
  { id: 'offers', title: 'Offers', f: ['made', 'acc'] },
  { id: 'hires', title: 'Hires', f: ['starts'] },
  { id: 'risks', title: 'Risks', f: [] }
];
const CASES = {
  A: { id: 'A', week: 46, title: 'Week 46', kind: 'clean', kindLabel: 'clean data', delegated: false,
    d: { roles: 5, cands: 42, ints: 18, made: 3, acc: 2, starts: 1 }, risk: ['Two roles have been open more than 45 days'], issue: null },
  B: { id: 'B', week: 47, title: 'Week 47', kind: 'missing', kindLabel: 'missing data', delegated: false,
    d: { roles: 5, cands: 37, ints: 15, made: 4, acc: null, starts: 2 }, risk: [],
    issue: { kind: 'missing', field: 'acc', section: 'offers', q: 'The ATS export leaves "Offers accepted" blank this week. How should I handle it?', short: 'Offers accepted is blank' } },
  C: { id: 'C', week: 48, title: 'Week 48', kind: 'conflict', kindLabel: 'conflicting data', delegated: false,
    d: { roles: 4, cands: 40, ints: 16, made: 3, acc: 3, starts: { ats: 4, ops: 6 } }, risk: ['One candidate withdrew after verbal offer'],
    issue: { kind: 'conflict', field: 'starts', section: 'hires', q: 'The ATS export says 4 people started; the ops sheet says 6. Which should the brief use?', short: 'Starts: 4 vs 6' } },
  D: { id: 'D', week: 49, title: 'Week 49', kind: 'clean', kindLabel: 'clean data, delegated', delegated: true,
    d: { roles: 6, cands: 45, ints: 19, made: 4, acc: 3, starts: 2 }, risk: ['Agency invoice is pending'], issue: null },
  E: { id: 'E', week: 50, title: 'Week 50', kind: 'missing', kindLabel: 'broken source, delegated', delegated: true,
    d: { roles: 6, cands: 48, ints: null, made: 2, acc: 1, starts: 1 }, risk: [],
    issue: { kind: 'missing', field: 'ints', section: 'pipeline', q: 'Interviews held is blank in this week\'s ATS export. I will not guess — what should I do?', short: 'Interviews held is blank' } }
};
const TRAIN = ['A', 'B', 'C'];
const LEVELS = ['L0 Teach', 'L1 Coach', 'L2 Review', 'L3 Sample', 'L4 Outcome'];
const LEVEL_DESC = [
  'You define the goal and rules; every draft is yours to judge.',
  'You review every draft and can correct it step by step.',
  'Pip delivers a finished draft; you review it before it counts.',
  'Pip delivers drafts on its own; you spot-check some. Exceptions still stop it and ask.',
  'Outcome-only checks. Locked in this demo.'
];
const STATE_LABEL = { draft: 'Ready', needs_input: 'Needs your input', working: 'Working', awaiting_review: 'Awaiting your review', revision_requested: 'Fix requested', approved: 'Approved', rejected: 'Rejected', blocked: 'Blocked', failed: 'Failed', delivered: 'Delivered, spot-check due' };
const STATE_ICON = { draft: '○', needs_input: '?', working: '…', awaiting_review: '▤', revision_requested: '✎', approved: '✓', rejected: '✕', blocked: '⛔', failed: '!', delivered: '✉' };

/* ---------- output production (deterministic, scripted) ---------- */
function produce(cs, crit, ans) {
  const withSrc = crit.some(c => c.id === 'sources');
  const exc = [], secs = [];
  const tag = f => withSrc ? ' — ' + SRC[f] : '';
  for (const sc of SECT) {
    const iss = cs.issue;
    if (iss && iss.section === sc.id && ans && ans.choice === 'skip') {
      exc.push(sc.title + ' omitted at your request: ' + LBL[iss.field] + ' was not settled.');
      continue;
    }
    const lines = [];
    if (sc.id === 'risks') {
      if (cs.risk.length) cs.risk.forEach(r => lines.push({ t: r + (withSrc ? ' — Ops sheet' : ''), flag: false }));
      else lines.push({ t: 'No risks reported in the inputs' + (withSrc ? ' — Ops sheet' : ''), flag: false });
    }
    for (const f of sc.f) {
      const v = cs.d[f];
      if (iss && iss.field === f) {
        const c = ans.choice;
        if (iss.kind === 'missing') {
          if (c === 'value') { lines.push({ t: LBL[f] + ': ' + ans.value + ' (provided by you; the source was blank)' + (withSrc ? ' — owner input' : ''), flag: true }); exc.push(LBL[f] + ' was blank in the source; you supplied ' + ans.value + '.'); }
          else { lines.push({ t: LBL[f] + ': UNKNOWN (source was blank)' + tag(f), flag: true }); exc.push(LBL[f] + ' is unknown; the source was blank and nothing was filled in.'); }
        } else {
          if (c === 'ats') { lines.push({ t: LBL[f] + ': ' + v.ats + tag(f) + '; the ops sheet says ' + v.ops + ' (difference unresolved)', flag: true }); exc.push('Starts differ between sources (ATS ' + v.ats + ', ops sheet ' + v.ops + '); you chose the ATS figure.'); }
          else if (c === 'ops') { lines.push({ t: LBL[f] + ': ' + v.ops + ' (Ops sheet); the ATS export says ' + v.ats + ' (difference unresolved)', flag: true }); exc.push('Starts differ between sources (ATS ' + v.ats + ', ops sheet ' + v.ops + '); you chose the ops sheet figure.'); }
          else { lines.push({ t: LBL[f] + ': ' + v.ats + ' per ATS export, ' + v.ops + ' per ops sheet — unresolved', flag: true }); exc.push('Starts differ between sources and stay unresolved in the brief.'); }
        }
      } else lines.push({ t: LBL[f] + ': ' + v + tag(f), flag: false });
    }
    secs.push({ id: sc.id, title: sc.title, lines });
  }
  return { secs, exc };
}
function evaluate(out, crit) {
  return crit.map(c => {
    if (!c.check) return { id: c.id, r: 'untested', d: 'This rule cannot be checked automatically in the demo.' };
    if (c.id === 'sections') return out.secs.length === 4 ? { id: c.id, r: 'pass' } : { id: c.id, r: 'fail', d: 'A section is missing.' };
    return { id: c.id, r: 'pass' };
  });
}

/* ---------- reducer ---------- */
function init() {
  return { plan: { version: 1, criteria: BASE_CRIT.slice() }, history: [{ v: 1, reason: 'Starting rubric' }],
    task: { state: 'draft', caseId: 'A', runId: null, delegated: false, question: null, answer: null, output: null, results: null, refused: null, blockedReason: null, failReason: null },
    runSeq: 0, runs: [], evidence: [], reviews: [], level: 0, grants: { read: true, draft: false }, fault: false,
    keys: new Set(), dup: 0, refusals: 0, noProof: 0, count: 0 };
}
function apply(S, e) {
  S.count++;
  if (e.key) S.keys.add(e.key);
  const T = S.task;
  if (e.type !== 'refusal' && e.type !== 'dup_ignored' && e.type !== 'msg') T.refused = null;
  switch (e.type) {
    case 'case_selected': T.caseId = e.caseId; T.state = 'draft'; T.output = null; T.results = null; T.question = null; T.answer = null; break;
    case 'grant_changed': S.grants[e.scope] = e.value; if (T.state === 'blocked' && S.grants.read) T.state = 'draft'; break;
    case 'run_started': S.runSeq++; Object.assign(T, { state: 'working', runId: e.runId, caseId: e.caseId, delegated: !!e.delegated, question: null, answer: null, output: null, results: null, failReason: null }); break;
    case 'question_asked': T.state = 'needs_input'; T.question = CASES[T.caseId].issue; break;
    case 'answered': T.answer = { choice: e.choice, value: e.value }; T.state = 'working'; break;
    case 'run_failed': T.state = 'failed'; T.failReason = e.reason; S.fault = false; break;
    case 'fault_injected': S.fault = true; break;
    case 'blocked': T.state = 'blocked'; T.blockedReason = e.reason; break;
    case 'run_completed': {
      const cs = CASES[T.caseId]; const out = produce(cs, S.plan.criteria, T.answer); const res = evaluate(out, S.plan.criteria);
      T.output = out; T.results = res; T.state = T.delegated ? 'delivered' : 'awaiting_review';
      S.runs.push({ id: T.runId, caseId: cs.id, v: S.plan.version, crit: S.plan.criteria.map(c => c.id), out, res, delegated: T.delegated, questions: T.answer ? 1 : 0, review: null, spot: null, counted: false });
      break;
    }
    case 'reviewed': {
      const run = S.runs.find(r => r.id === e.runId); if (!run) break;
      run.review = { decision: e.decision, note: e.note || '' };
      S.reviews.push({ runId: run.id, decision: e.decision });
      if (e.decision === 'approve') {
        T.state = 'approved';
        const ok = run.res.every(r => r.r === 'pass');
        const dupe = S.evidence.some(x => x.caseId === run.caseId && x.v === run.v);
        if (ok && !dupe) { run.counted = true; S.evidence.push({ runId: run.id, caseId: run.caseId, v: run.v, flagged: run.out.exc.length > 0, questions: run.questions }); }
        else { S.noProof++; run.why = !ok ? 'Approved, but a rule failed or cannot be checked in this demo, so it does not count as proof.' : 'Same week and same plan version as an earlier proof, so it adds no new proof.'; }
      } else if (e.decision === 'revise') T.state = 'revision_requested';
      else T.state = 'rejected';
      break;
    }
    case 'plan_revised': S.plan.version = e.version; S.plan.criteria.push(e.criterion); S.history.push({ v: e.version, reason: e.reason, add: e.criterion.label }); break;
    case 'level_changed': S.level = e.to; break;
    case 'spot': { const run = S.runs.find(r => r.id === e.runId); if (run) run.spot = e.ok ? 'ok' : 'flagged'; T.state = e.ok ? 'approved' : 'rejected'; break; }
    case 'refusal': S.refusals++; T.refused = { what: e.what, reasons: e.reasons || [] }; break;
    case 'dup_ignored': S.dup++; break;
  }
}
function derive(evs) { const S = init(); evs.forEach(e => apply(S, e)); return S; }

/* ---------- persistence + command layer ---------- */
let memOnly = false, events = [], S = init();
function load() {
  try { const raw = localStorage.getItem(KEY); const o = raw ? JSON.parse(raw) : null; return o && Array.isArray(o.events) ? o.events : []; }
  catch (_) { return events; }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, events })); } catch (_) { memOnly = true; } }
function act(fn) {
  if (!memOnly) events = load();
  let st = derive(events);
  let out = fn(st);
  if (!out || !out.length) return false;
  if (out.some(e => e.key && st.keys.has(e.key))) out = [{ type: 'dup_ignored', from: 'sys', text: 'Already done — nothing was duplicated.' }];
  for (const e of out) { e.n = events.length + 1; e.t = new Date().toISOString(); events.push(e); }
  save(); S = derive(events); render(); schedule();
  return true;
}
const say = (from, text) => ({ type: 'msg', from, text });
const nextRunId = st => 'run-' + (st.runSeq + 1);
const sync = () => { if (!memOnly) { events = load(); } S = derive(events); render(); schedule(); };

function refuse(what, reasons, text) { return { type: 'refusal', from: 'pip', what, reasons, text }; }

function cmdGrant(scope, value) {
  return act(st => {
    if (scope === 'send' || scope === 'accounts') {
      const name = scope === 'send' ? 'Send the brief to people' : 'Connect real accounts';
      return [refuse(name, ['Locked in this demo: nothing is ever sent and no real accounts exist.'], 'Not permitted: ' + name + '. This demo never sends anything and has no live accounts, so there is nothing to unlock.')];
    }
    if (st.grants[scope] === value) return [say('sys', 'No change: that permission is already ' + (value ? 'on' : 'off') + '.')];
    const label = scope === 'read' ? 'read the demo inputs' : 'save drafts';
    const evs = [{ type: 'grant_changed', scope, value, from: 'sys', text: 'Permission ' + (value ? 'granted' : 'revoked') + ': ' + label + '.' }];
    if (!value && st.level >= 2) evs.push({ type: 'level_changed', to: 1, from: 'sys', text: 'Autonomy lowered to L1 Coach because a permission it relies on was revoked.' });
    return evs;
  });
}
function cmdSelect(caseId) { return act(st => (['working', 'needs_input', 'awaiting_review'].includes(st.task.state) ? [say('sys', 'Finish the current step first.')] : [{ type: 'case_selected', caseId, from: 'sys', text: 'Selected ' + CASES[caseId].title + ' (' + CASES[caseId].kindLabel + ').' }])); }
function cmdStart(caseId) {
  return act(st => {
    const T = st.task, cs = CASES[caseId || T.caseId];
    if (T.state === 'working') return [{ type: 'dup_ignored', from: 'sys', text: 'A run is already in progress — no second run was started.' }];
    if (T.state === 'needs_input' || T.state === 'awaiting_review') return [say('sys', 'Finish the current ' + (T.state === 'needs_input' ? 'question' : 'review') + ' before starting another run.')];
    if (cs.delegated && st.level < 3) return [refuse('Delegated run', ['Delegated runs need L3 Sample.'], 'Not permitted: ' + cs.title + ' is a delegated run and needs L3 Sample. Earn it with evidence first.')];
    if (cs.delegated && !st.grants.draft) return [refuse('Save drafts', ['Saving drafts is switched off.'], 'Not permitted: saving drafts is switched off, so I cannot deliver.')];
    const base = { runId: nextRunId(st), caseId: cs.id, delegated: cs.delegated, key: 'start:' + nextRunId(st) };
    if (!st.grants.read) return [{ type: 'blocked', reason: 'read the demo inputs', from: 'pip', text: 'Blocked: I am not allowed to read the demo inputs yet. Grant that in Permissions (or use the button) and I will go.' }];
    return [{ type: 'run_started', ...base, from: 'pip', text: 'Starting ' + cs.title + ' (' + cs.kindLabel + ', plan v' + st.plan.version + ')' + (cs.delegated ? ' on my own.' : '.') }];
  });
}
function cmdComplete(runId) {
  return act(st => {
    const T = st.task; if (T.state !== 'working' || T.runId !== runId) return null;
    const cs = CASES[T.caseId];
    if (st.fault) return [{ type: 'run_failed', reason: 'The demo input source was unavailable (simulated outage).', key: 'fail:' + runId, from: 'pip', text: 'The run failed: the demo input source was unavailable (simulated outage). I produced nothing. Retrying is a new attempt.' }];
    if (!st.grants.read) return [{ type: 'blocked', reason: 'read the demo inputs', from: 'pip', text: 'Blocked mid-run: read access was revoked, so I stopped.' }];
    if (cs.issue && !T.answer) return [{ type: 'question_asked', key: 'ask:' + runId, from: 'pip', text: cs.issue.q }];
    return [{ type: 'run_completed', runId, key: 'done:' + runId, from: 'pip', text: cs.delegated ? 'Delivered a draft for ' + cs.title + '. I did not send it anywhere. Please spot-check it.' : 'Draft for ' + cs.title + ' is ready for your review.' }];
  });
}
function cmdAnswer(choice, value) {
  return act(st => {
    const T = st.task; if (T.state !== 'needs_input') return [say('sys', 'There is no open question.')];
    if (choice === 'value') {
      const n = Number(value);
      if (value === '' || value == null || !Number.isInteger(n) || n < 0 || n > 999) return [say('pip', 'I need a whole number from 0 to 999. If you do not know it, choose "Mark unknown" — I will not guess.')];
      value = n;
    }
    const names = { value: 'Provided ' + value, unknown: 'Mark unknown', skip: 'Skip the section', ats: 'Use ATS figure', ops: 'Use ops sheet figure', both: 'Report both, unresolved' };
    return [{ type: 'answered', runId: T.runId, choice, value: value === undefined ? null : value, key: 'ans:' + T.runId, from: 'owner', text: names[choice] }];
  });
}
function cmdReview(decision, note) {
  return act(st => {
    const T = st.task; if (T.state !== 'awaiting_review') return [say('sys', 'No draft is waiting for review.')];
    const evs = [{ type: 'reviewed', runId: T.runId, decision, note, key: 'review:' + T.runId, from: 'owner', text: decision === 'approve' ? 'Approved the draft.' : decision === 'reject' ? 'Rejected the draft.' : 'Requested a fix: ' + note }];
    const run = st.runs.find(r => r.id === T.runId);
    if (decision === 'approve') {
      const ok = run.res.every(r => r.r === 'pass');
      const dupe = st.evidence.some(x => x.caseId === run.caseId && x.v === run.v);
      evs.push(say('sys', ok ? (dupe ? 'No new proof: same week on the same plan version as an earlier proof.' : 'Counted as proof for ' + CASES[run.caseId].title + ' on plan v' + run.v + '.') : 'Approved, but a rule failed or cannot be checked in this demo, so this does not count as proof.'));
    }
    if (decision === 'revise') evs.push(...reviseEvents(st, note, 'Owner requested a fix after review'));
    return evs;
  });
}
function reviseEvents(st, text, reason) {
  const v = st.plan.version + 1;
  const wantsSources = /sourc|cite|citation|where.*from/i.test(text) && !st.plan.criteria.some(c => c.id === 'sources');
  const crit = wantsSources ? SOURCES_CRIT : { id: 'rule' + v, label: 'Owner rule: ' + text.slice(0, 80), short: 'Rule: ' + text.slice(0, 16), check: false };
  const evs = [{ type: 'plan_revised', version: v, criterion: crit, reason, from: 'pip', text: 'Plan v' + v + ' written. Added: "' + crit.label + '".' + (crit.check ? '' : ' The demo cannot check this rule automatically, so it shows as untested.') + ' Earlier proof applies to v' + st.plan.version + ' only — rerun to prove v' + v + '.' }];
  if (st.level >= 2) evs.push({ type: 'level_changed', to: 1, from: 'sys', text: 'Process changed, so autonomy dropped to L1 Coach until it is proven again.' });
  return evs;
}
function cmdTeach(text) {
  return act(st => {
    text = (text || '').trim();
    if (!text) return [say('pip', 'Tell me the rule in a sentence, for example "Cite the source for every number".')];
    if (['working', 'needs_input', 'awaiting_review'].includes(st.task.state)) return [say('sys', 'Finish the current step before changing the process.')];
    return [{ type: 'msg', from: 'owner', text: 'Teach: ' + text }, ...reviseEvents(st, text, 'Owner taught a rule')];
  });
}
function gate(st, t) {
  if (t >= 4) return [{ ok: false, label: 'Outcome-only autonomy (L4) is locked in this demo', hint: '' }];
  const v = st.plan.version, cur = st.evidence.filter(e => e.v === v), has = id => cur.some(e => e.caseId === id);
  const ck = [], add = (ok, label, hint) => ck.push({ ok, label, hint });
  if (t === 1) add(st.reviews.length > 0, 'You have reviewed at least one draft', 'Approve a draft or ask for a fix');
  if (t >= 2) {
    const last = st.reviews[st.reviews.length - 1];
    add(has('A'), 'Clean week proven on plan v' + v, 'Run and approve Week 46');
    add(has('B') || has('C'), 'A missing- or conflicting-data week proven on plan v' + v, 'Run and approve Week 47 or 48');
    add(cur.some(e => (e.caseId === 'B' || e.caseId === 'C') && e.flagged), 'The exception week listed its exception instead of hiding it', 'Approve a Week 47 or 48 draft');
    add(!!last && last.decision === 'approve', 'Your latest review was an approval, not a correction', 'Review the latest draft');
    add(st.grants.read && st.grants.draft, 'You allowed reading the inputs and saving drafts', 'Allow both in Permissions');
  }
  if (t >= 3) add(has('A') && has('B') && has('C'), 'All three situations proven on plan v' + v, 'Prove ' + ['A', 'B', 'C'].filter(x => !has(x)).map(x => CASES[x].title).join(', '));
  return ck;
}
function cmdLevel() {
  return act(st => {
    const t = st.level + 1, ck = gate(st, t);
    if (t >= 4) return [refuse('Level L4', [ck[0].label], 'Not permitted: ' + ck[0].label + '.')];
    const bad = ck.filter(c => !c.ok);
    if (bad.length) return [{ type: 'msg', from: 'owner', text: 'Ask for ' + LEVELS[t] + '.' }, refuse(LEVELS[t], bad.map(b => b.label + ' — ' + b.hint), 'Not yet for ' + LEVELS[t] + '. Missing: ' + bad.map(b => b.label).join('; ') + '.')];
    return [{ type: 'level_changed', to: t, from: 'pip', text: 'Moved up to ' + LEVELS[t] + '. ' + LEVEL_DESC[t] }];
  });
}
function cmdSpot(ok) {
  return act(st => {
    const T = st.task; if (T.state !== 'delivered') return [say('sys', 'There is no delivered draft to spot-check.')];
    const evs = [{ type: 'spot', runId: T.runId, ok, key: 'spot:' + T.runId, from: 'owner', text: ok ? 'Spot-check passed.' : 'Spot-check found a problem.' }];
    if (!ok && st.level >= 3) evs.push({ type: 'level_changed', to: 2, from: 'sys', text: 'A failed spot-check lowered autonomy to L2 Review.' });
    return evs;
  });
}
function cmdFault() { return act(st => (st.fault ? [say('sys', 'An outage is already queued for the next run.')] : [{ type: 'fault_injected', from: 'sys', text: 'Simulated outage queued: the next run will fail.' }])); }

/* chat parsing: same commands as the buttons */
function chat(txt) {
  txt = txt.trim(); if (!txt) return;
  const t = txt.toLowerCase();
  act(() => [say('owner', txt)]);
  const st = S.task.state;
  let m;
  if (!/^\s*teach\b/.test(t) && st !== 'needs_input' && /^\s*(please\s+)?(send|email|post|publish|forward)\b/.test(t)) return cmdGrant('send', true);
  if (/real account|connect.*account|login/.test(t)) return cmdGrant('accounts', true);
  if (st === 'needs_input') {
    if (/unknown/.test(t)) return cmdAnswer('unknown');
    if (/skip|omit/.test(t)) return cmdAnswer('skip');
    if (/both|unresolved/.test(t)) return cmdAnswer('both');
    if (/\bats\b/.test(t)) return cmdAnswer('ats');
    if (/ops/.test(t)) return cmdAnswer('ops');
    if ((m = t.match(/-?\d+(\.\d+)?/))) return cmdAnswer('value', m[0]);
  }
  if ((m = txt.match(/^(?:teach|rule)[:\s]+(.+)/i))) return cmdTeach(m[1]);
  if ((m = txt.match(/^(?:fix|revise|redo)[:\s]*(.*)/i))) return cmdReview('revise', m[1] || 'Cite the source for every number');
  if (/^(approve|looks good|ok|yes)/.test(t)) return cmdReview('approve');
  if (/^reject/.test(t)) return cmdReview('reject');
  if ((m = t.match(/^(grant|allow|revoke|deny)\s+(read|draft|save)/))) return cmdGrant(m[2] === 'read' ? 'read' : 'draft', /grant|allow/.test(m[1]));
  if (/level|promot|responsib|autonom|delegate/.test(t) && !/^run/.test(t)) {
    if (/delegate/.test(t) && S.level >= 3) return cmdStart(S.task.caseId === 'D' ? 'E' : 'D');
    return cmdLevel();
  }
  if (/spot/.test(t)) return cmdSpot(!/fail|problem|bad/.test(t));
  if ((m = t.match(/^(run|start|go|rerun|retry)(?:.*week\s*(4[6-9]|50)|.*case\s*([a-e]))?/))) {
    const wk = m[2] && Object.values(CASES).find(c => String(c.week) === m[2]); return cmdStart(wk ? wk.id : m[3] ? m[3].toUpperCase() : undefined);
  }
  act(() => [say('pip', 'This demo understands a few commands: run, approve, fix: <what>, reject, teach: <rule>, grant read, grant draft, level up, delegate. Or use the buttons.')]);
}

/* ---------- timers (run progress) ---------- */
let timer = null, timerRun = null;
function schedule() {
  const T = S.task;
  if (T.state === 'working' && T.runId) {
    const id = T.runId + ':' + S.count;
    if (timerRun === id) return;
    clearTimeout(timer); timerRun = id;
    timer = setTimeout(() => { timerRun = null; cmdComplete(T.runId); }, reduced() ? 500 : 1500);
  } else { clearTimeout(timer); timerRun = null; }
}

/* ---------- next-step guidance ---------- */
function nextStep(st) {
  const T = st.task, v = st.plan.version, cur = st.evidence.filter(e => e.v === v), has = id => cur.some(e => e.caseId === id);
  const todo = TRAIN.find(c => !has(c));
  if (T.state === 'blocked' && !st.grants.read) return { t: 'Pip is stopped at the door: it may not read the demo inputs yet.', b: 'Allow reading demo inputs', a: 'grant:read' };
  if (T.state === 'working') return { t: 'Pip is working. Nothing to do — watch the coworker or the chat.', b: 'Working…', dis: true };
  if (T.state === 'needs_input') return { t: 'Pip is asking you a question. Pick an answer in Chat or Task.', b: 'Answer the question', a: 'tab:chat' };
  if (T.state === 'awaiting_review') return { t: 'A draft is waiting. Approve it, or ask for a fix if something is missing.', b: 'Open the draft', a: 'tab:task' };
  if (T.state === 'delivered') return { t: 'Pip delivered a draft by itself. Spot-check it before you trust it.', b: 'Spot-check passes', a: 'spot:ok' };
  if (T.state === 'revision_requested') return { t: 'Plan v' + v + ' is ready. Rerun ' + CASES[T.caseId].title + ' to see whether the fix worked.', b: 'Rerun ' + CASES[T.caseId].title, a: 'run:' + T.caseId };
  if (T.state === 'failed') return { t: 'The run failed and produced nothing. Retry is a new attempt.', b: 'Retry ' + CASES[T.caseId].title, a: 'run:' + T.caseId };
  if (!st.grants.read) return { t: 'Reading the demo inputs is switched off. Turn it back on so Pip can work.', b: 'Allow reading demo inputs', a: 'grant:read' };
  if (!st.runs.length) return { t: 'Start here: give Pip its first task, the weekly hiring and ops brief for Week 46.', b: 'Start the first task', a: 'run:A' };
  if (st.runs.length && !st.reviews.length) return { t: 'Run Week 46.', b: 'Run Week 46', a: 'run:A' };
  if (todo) return { t: 'Next proof needed on plan v' + v + ': ' + CASES[todo].title + ' (' + CASES[todo].kindLabel + ').', b: 'Run ' + CASES[todo].title, a: 'run:' + todo };
  if (!st.grants.draft) return { t: 'All three situations are proven. Decide whether Pip may save drafts.', b: 'Allow saving drafts', a: 'grant:draft' };
  if (st.level < 3) return { t: 'The evidence is in. Ask for the next level of responsibility; the gate will check it.', b: 'Ask for ' + LEVELS[st.level + 1], a: 'level' };
  if (!st.runs.some(r => r.caseId === 'D')) return { t: 'Pip is trusted to deliver drafts by itself. Delegate Week 49.', b: 'Delegate Week 49', a: 'run:D' };
  if (!st.runs.some(r => r.caseId === 'E')) return { t: 'Now the exception: Week 50 has a broken source. A trustworthy coworker stops and asks.', b: 'Delegate Week 50', a: 'run:E' };
  return { t: 'Demo path complete. Try asking for "send it" (refused), change the process to see autonomy drop, or export the log.', b: 'Teach a new rule', a: 'tab:task' };
}

/* ---------- world ---------- */
const CX = { inbox: 125, rubric: 365, review: 605, door: 835 };
const STN = ['inbox', 'rubric', 'review', 'door'];
const STN_NAME = { inbox: 'Inbox Tray', rubric: 'Rubric Wall', review: 'Review Table', door: 'Permissions Door' };
const STN_TAB = { inbox: 'task', rubric: 'evidence', review: 'task', door: 'perms' };
function buildWorld() {
  const poses = `
  <g class="pose pose-idle"><ellipse cx="-36" cy="-30" rx="8" ry="14" fill="#5A3F8F"/><ellipse cx="36" cy="-30" rx="8" ry="14" fill="#5A3F8F"/></g>
  <g class="pose pose-hand-raised"><ellipse cx="-36" cy="-30" rx="8" ry="14" fill="#5A3F8F"/><path d="M34 -50 L48 -96" stroke="#5A3F8F" stroke-width="12" stroke-linecap="round"/><text x="58" y="-100" font-size="26" font-weight="700">!</text></g>
  <g class="pose pose-typing"><rect x="-30" y="-24" width="60" height="22" rx="4" fill="#2B2438"/><rect x="-24" y="-60" width="48" height="36" rx="4" fill="#fff" stroke="#2B2438" stroke-width="3"/><path d="M-34 -46 L-18 -26 M34 -46 L18 -26" stroke="#5A3F8F" stroke-width="10" stroke-linecap="round"/></g>
  <g class="pose pose-holding-document"><rect x="-26" y="-74" width="52" height="64" rx="3" fill="#fff" stroke="#2B2438" stroke-width="3"/><path d="M-16 -60h32M-16 -48h32M-16 -36h22" stroke="#2B2438" stroke-width="3"/><path d="M-34 -30 L-24 -40 M34 -30 L24 -40" stroke="#5A3F8F" stroke-width="10" stroke-linecap="round"/></g>
  <g class="pose pose-reading-notes"><rect x="-50" y="-60" width="36" height="48" rx="3" fill="#FFFBF3" stroke="#2B2438" stroke-width="3" transform="rotate(-8 -32 -36)"/><path d="M-44 -46h24M-44 -36h24" stroke="#2B2438" stroke-width="3" transform="rotate(-8 -32 -36)"/><ellipse cx="36" cy="-30" rx="8" ry="14" fill="#5A3F8F"/></g>
  <g class="pose pose-thumbs-up"><ellipse cx="-36" cy="-30" rx="8" ry="14" fill="#5A3F8F"/><path d="M34 -40 L46 -70" stroke="#5A3F8F" stroke-width="12" stroke-linecap="round"/><path d="M40 -84 q8 -10 12 2 l-2 10 h-12z" fill="#5A3F8F"/></g>
  <g class="pose pose-slump"><ellipse cx="-38" cy="-12" rx="8" ry="12" fill="#5A3F8F"/><ellipse cx="38" cy="-12" rx="8" ry="12" fill="#5A3F8F"/></g>
  <g class="pose pose-stopped-at-door"><path d="M-30 -50 L-62 -70 M30 -50 L62 -70" stroke="#5A3F8F" stroke-width="10" stroke-linecap="round"/><rect x="-74" y="-86" width="14" height="26" rx="4" fill="#fff" stroke="#2B2438" stroke-width="2" transform="rotate(-10 -67 -73)"/><rect x="60" y="-86" width="14" height="26" rx="4" fill="#fff" stroke="#2B2438" stroke-width="2" transform="rotate(10 67 -73)"/></g>
  <g class="pose pose-confused"><ellipse cx="-36" cy="-30" rx="8" ry="14" fill="#5A3F8F"/><ellipse cx="36" cy="-30" rx="8" ry="14" fill="#5A3F8F"/><text x="30" y="-104" font-size="30" font-weight="700">?</text></g>`;
  const st = (id, inner) => `<g class="st" id="st-${id}" role="button" tabindex="${id === 'inbox' ? 0 : -1}" data-st="${id}"><rect class="hit" x="${CX[id] - 108}" y="10" width="216" height="300" fill-opacity="0"/>${inner}</g>`;
  return `
  <rect width="960" height="400" fill="#F4EAD8"/><rect y="300" width="960" height="100" fill="#C99A6B"/><rect y="296" width="960" height="8" fill="#A97B4F"/>
  <path d="M0 0H960" stroke="#E8D9BD" stroke-width="8"/>
  ${st('inbox', `<g aria-hidden="true"><rect x="45" y="352" width="160" height="30" rx="8" fill="#FFFBF3" stroke="#2B2438" stroke-width="2"/><text x="125" y="373" text-anchor="middle" font-size="17" font-weight="700">Inbox Tray</text><rect x="45" y="230" width="160" height="62" rx="8" fill="#B07A44" stroke="#2B2438" stroke-width="3"/><rect x="60" y="208" width="130" height="26" fill="#fff" stroke="#2B2438" stroke-width="2" transform="rotate(-3 125 220)"/><rect x="68" y="190" width="120" height="26" fill="#fff" stroke="#2B2438" stroke-width="2" transform="rotate(4 125 200)"/><path d="M80 200h60M80 218h70" stroke="#5B5370" stroke-width="2"/><text id="inb" x="125" y="268" text-anchor="middle" font-size="16" font-weight="700" fill="#fff" style="fill:#fff">Week 46</text></g>`)}
  ${st('rubric', `<g aria-hidden="true"><rect x="285" y="352" width="160" height="30" rx="8" fill="#FFFBF3" stroke="#2B2438" stroke-width="2"/><text x="365" y="373" text-anchor="middle" font-size="17" font-weight="700">Rubric Wall</text><rect x="265" y="82" width="200" height="190" rx="8" fill="#FFFBF3" stroke="#2B2438" stroke-width="3"/><g id="rub"></g></g>`)}
  ${st('review', `<g aria-hidden="true"><rect x="525" y="352" width="160" height="30" rx="8" fill="#FFFBF3" stroke="#2B2438" stroke-width="2"/><text x="605" y="373" text-anchor="middle" font-size="17" font-weight="700">Review Table</text><rect x="520" y="226" width="170" height="14" rx="4" fill="#8A5A2B" stroke="#2B2438" stroke-width="3"/><path d="M536 240v56M674 240v56" stroke="#2B2438" stroke-width="6"/><rect id="doc" x="570" y="204" width="70" height="22" fill="#fff" stroke="#2B2438" stroke-width="2"/><path d="M578 212h54M578 219h40" stroke="#5B5370" stroke-width="2"/><g id="flag" style="display:none"><path d="M690 226V170" stroke="#2B2438" stroke-width="3"/><path d="M690 170h30l-8 10 8 10h-30z" fill="#E4572E" stroke="#2B2438" stroke-width="2"/></g><g id="chair"><rect x="524" y="252" width="30" height="8" fill="#6B4FA3"/><path d="M528 260v34" stroke="#2B2438" stroke-width="5"/></g></g>`)}
  ${st('door', `<g aria-hidden="true"><rect x="755" y="352" width="160" height="30" rx="8" fill="#FFFBF3" stroke="#2B2438" stroke-width="2"/><text x="835" y="373" text-anchor="middle" font-size="17" font-weight="700">Permissions Door</text><rect x="738" y="78" width="194" height="82" rx="8" fill="#FFFBF3" stroke="#2B2438" stroke-width="3"/><g id="tags" font-size="13"></g><rect x="790" y="166" width="90" height="130" fill="#8A5A2B" stroke="#2B2438" stroke-width="3"/><path id="doorpanel" d="M790 166h90v130h-90z" fill="#B07A44" stroke="#2B2438" stroke-width="3" style="transition:d .24s"/><circle cx="866" cy="236" r="5" fill="#F2B632" stroke="#2B2438"/><g id="lock"><rect x="822" y="215" width="26" height="22" rx="3" fill="#8B8497" stroke="#2B2438" stroke-width="2"/><path d="M827 215v-8a8 8 0 0 1 16 0v8" fill="none" stroke="#2B2438" stroke-width="3"/></g></g>`)}
  <g id="owner" aria-hidden="true" style="transform:translate(60px,330px)"><g id="ownerbody"><path d="M-18 0C-20 -34 -12 -54 0 -54s20 20 18 54z" fill="#E4572E" stroke="#2B2438" stroke-width="2"/><circle cx="0" cy="-66" r="13" fill="#F2B632" stroke="#2B2438" stroke-width="2"/><text x="0" y="16" text-anchor="middle" font-size="12" font-weight="700">You</text></g></g>
  <g id="cow" data-pose="idle" role="img" aria-label="Pip, the coworker" style="transform:translate(125px,330px)">
    <ellipse cx="0" cy="2" rx="46" ry="8" fill="#2B2438" opacity=".18"/>
    <g id="cowbody"><path d="M-36 0C-44 -60 -24 -104 0 -104s44 44 36 104z" fill="#6B4FA3" stroke="#2B2438" stroke-width="3"/>
      <circle cx="-13" cy="-66" r="8" fill="#fff"/><circle cx="13" cy="-66" r="8" fill="#fff"/><circle cx="-12" cy="-65" r="3.5" fill="#2B2438"/><circle cx="14" cy="-65" r="3.5" fill="#2B2438"/>
      <path class="mouth-ok" d="M-8 -48q8 8 16 0" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/><path class="mouth-sad" d="M-8 -42q8 -8 16 0" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/>
      <path d="M-10 -92L-4 -30L4 -30L10 -92" stroke="#E4572E" stroke-width="3" fill="none"/><rect x="-9" y="-34" width="18" height="12" rx="2" fill="#fff" stroke="#2B2438" stroke-width="2"/>
      ${poses}</g></g>`;
}
function stateText(st) {
  const T = st.task, cs = CASES[T.caseId];
  if (T.refused) return { station: 'door', pose: 'stopped-at-door', bubble: 'Not permitted: ' + T.refused.what, say: 'Pip is stopped at the door. Not permitted: ' + T.refused.what + '.' };
  switch (T.state) {
    case 'draft': return { station: 'inbox', pose: 'idle', bubble: 'Ready when you are.', say: 'Pip is ready at the inbox.' };
    case 'needs_input': return { station: 'inbox', pose: 'hand-raised', bubble: cs.issue.short + ' — what should I do?', say: 'Pip has a question: ' + cs.issue.q };
    case 'working': { const v = (st.count % 2) ? 'Reading the inputs…' : 'Drafting the brief…'; return { station: 'inbox', pose: 'typing', bubble: v, say: 'Pip is working on ' + cs.title + '.' }; }
    case 'awaiting_review': return { station: 'review', pose: 'holding-document', bubble: 'Ready for your review', say: 'Pip holds the finished draft at the review table.' };
    case 'revision_requested': return { station: 'rubric', pose: 'reading-notes', bubble: 'Noted. Plan v' + st.plan.version + ' written.', say: 'Pip is at the rubric wall with a new plan version ' + st.plan.version + '.' };
    case 'approved': return { station: 'review', pose: 'thumbs-up', bubble: 'Approved', say: 'The draft was approved.' };
    case 'rejected': return { station: 'review', pose: 'slump', bubble: 'Rejected — tell me what to change', say: 'The draft was rejected.' };
    case 'blocked': return { station: 'door', pose: 'stopped-at-door', bubble: 'Not permitted: ' + (T.blockedReason || 'that'), say: 'Pip is blocked at the door.' };
    case 'failed': return { station: 'inbox', pose: 'confused', bubble: 'Run failed: ' + (T.failReason || ''), say: 'Run failed. ' + (T.failReason || '') };
    case 'delivered': return { station: 'review', pose: 'holding-document', bubble: 'Delivered a draft — please spot-check', say: 'Pip delivered a draft on its own and awaits a spot-check.' };
  }
}
let lastBubble = '', focusStation = null;
function renderInfo() {
  const v = S.plan.version, cur = S.evidence.filter(e => e.v === v), last = S.runs[S.runs.length - 1];
  const res = {}; if (last && last.v === v) last.res.forEach(r => res[r.id] = r.r);
  const out = S.task.output ? S.task.output : last ? last.out : null;
  $('#worldinfo').innerHTML = `<div class="card"><h3>Goal</h3><p>A weekly hiring and ops brief from two synthetic exports. Pip drafts; you decide. Nothing is sent.</p><p class="fine">${esc(LEVELS[S.level])} · plan v${v}</p></div>
  <div class="card"><h3>Process checks</h3><ul class="clean">${S.plan.criteria.map(c => { const r = res[c.id]; return `<li><span class="${r === 'pass' ? 'ok' : r === 'fail' ? 'no' : 'un'}" aria-hidden="true">${r === 'pass' ? '✓' : r === 'fail' ? '✕' : '○'}</span> ${esc(c.short)}<span class="sr"> ${r || 'not yet run'}</span></li>`; }).join('')}</ul></div>
  <div class="card"><h3>Proof on this plan</h3><div class="capbar">${['A', 'B', 'C'].map(id => { const ok = cur.some(e => e.caseId === id); return `<span class="${ok ? 'yes' : 'deny'}">${ok ? '✓' : '○'} ${esc(CASES[id].kindLabel)}</span>`; }).join('')}</div>${out ? `<p class="fine">Latest draft (${esc(CASES[last ? last.caseId : S.task.caseId].title)}): ${out.exc.length ? esc(out.exc[0]) : 'no exceptions in the inputs'}</p>` : '<p class="fine">No draft yet.</p>'}</div>`;
}
function renderWorld() {
  const T = S.task, tx = stateText(S), cs = CASES[T.caseId];
  const cow = $('#cow'); cow.dataset.pose = tx.pose;
  cow.setAttribute('aria-label', 'Pip, ' + tx.say);
  cow.style.transform = `translate(${CX[tx.station]}px,330px)`;
  const ow = $('#owner'), lv = S.level;
  const ox = lv <= 1 ? CX[tx.station] - 78 : lv === 2 ? 640 : 700;
  ow.style.transform = `translate(${ox}px,330px)`; ow.style.opacity = lv >= 3 ? 0 : 1;
  $('#chair').style.opacity = lv >= 2 ? 1 : 0.35;
  $('#flag').style.display = lv >= 3 ? 'inline' : 'none';
  $('#inb').textContent = cs.title + (cs.delegated ? ' · delegated' : '');
  const curRes = {}; const last = S.runs[S.runs.length - 1];
  if (last && last.v === S.plan.version) last.res.forEach(r => curRes[r.id] = r.r);
  $('#rub').innerHTML = S.plan.criteria.slice(0, 6).map((c, i) => {
    const r = curRes[c.id] || 'untested', y = 112 + i * 28, mk = r === 'pass' ? '✓' : r === 'fail' ? '✕' : '○', col = r === 'pass' ? '#3E8E4F' : r === 'fail' ? '#B3261E' : '#8B8497';
    return `<rect x="274" y="${y - 17}" width="182" height="24" rx="6" fill="none" stroke="${col}" stroke-width="2" ${r === 'untested' ? 'stroke-dasharray="4 3"' : ''}/><text x="284" y="${y}" font-size="15" font-weight="700" style="fill:${col}">${mk}</text><text x="304" y="${y}" font-size="13" style="fill:#2B2438">${esc(c.short)}</text>`;
  }).join('') + `<text x="365" y="266" text-anchor="middle" font-size="12" style="fill:#5B5370">Plan v${S.plan.version}</text>`;
  const g = S.grants;
  $('#tags').innerHTML = [['read inputs', g.read], ['save drafts', g.draft], ['send to people', null], ['real accounts', null]].map((x, i) => `<text x="750" y="${99 + i * 16}" style="fill:${x[1] ? '#3E8E4F' : '#2B2438'}">${x[1] ? '✓' : x[1] === false ? '○' : '🔒'} ${x[0]}${x[1] === null ? ' (locked)' : x[1] ? '' : ' (off)'}</text>`).join('');
  const open = g.read && g.draft;
  $('#lock').style.display = open ? 'none' : 'inline';
  $('#doorpanel').setAttribute('d', open ? 'M790 166 L836 176 L836 286 L790 296 z' : 'M790 166h90v130h-90z');
  STN.forEach(id => {
    const el = $('#st-' + id);
    let desc = id === 'inbox' ? cs.title + ' · ' + STATE_LABEL[T.state] : id === 'rubric' ? 'plan v' + S.plan.version + ', ' + S.plan.criteria.length + ' checks' : id === 'review' ? (T.output ? 'draft ready' : 'no draft yet') : (g.read ? 'reading allowed' : 'reading off') + ', ' + (g.draft ? 'drafts allowed' : 'drafts off') + ', sending locked';
    el.setAttribute('aria-label', STN_NAME[id] + ': ' + desc + '. Press Enter to open its details.');
    el.classList.toggle('cur', id === tx.station);
  });
  const b = $('#bubble'); b.textContent = tx.bubble;
  b.style.left = Math.min(Math.max(CX[tx.station] / 960 * 100, 13), 87) + '%';
  if (lastBubble !== tx.bubble) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); lastBubble = tx.bubble; }
  $('#status').innerHTML = `<span class="pill st-${T.state}"><i aria-hidden="true">${STATE_ICON[T.state]}</i> ${esc(STATE_LABEL[T.state])}</span> ${esc(tx.say)}`;
  if ($('#live').textContent !== tx.say) $('#live').textContent = tx.say;
  const sc = $('#scroll'); if (sc.scrollWidth > sc.clientWidth) { const target = CX[tx.station] / 960 * sc.scrollWidth - sc.clientWidth / 2; sc.scrollTo({ left: Math.max(0, target), behavior: reduced() ? 'auto' : 'smooth' }); }
}

/* ---------- panes ---------- */
const ui = { tab: 'chat', reviseOpen: false, reviseText: 'Cite the source for every number', teachText: '' };
const btn = (a, label, cls = 'btn', extra = '') => `<button type="button" class="${cls}" data-act="${a}" data-fid="${a}" ${extra}>${label}</button>`;
function questionHTML(st) {
  const q = st.task.question; if (!q) return '';
  const opts = q.kind === 'missing'
    ? `<form class="inline" data-form="value"><label class="sr" for="val-${esc(st.task.runId)}">Value to use</label><input id="val-${esc(st.task.runId)}" class="valin" type="number" min="0" max="999" step="1" placeholder="Number" inputmode="numeric"><button class="chip primary" type="submit">Provide value</button></form>${btn('answer:unknown', 'Mark unknown', 'chip')}${btn('answer:skip', 'Skip section', 'chip')}`
    : `${btn('answer:ats', 'Use ATS (4)', 'chip')}${btn('answer:ops', 'Use ops sheet (6)', 'chip')}${btn('answer:both', 'Report both, unresolved', 'chip')}${btn('answer:skip', 'Skip section', 'chip')}`;
  return `<div class="card"><h3>Pip asks</h3><p>${esc(q.q)}</p><div class="chips">${opts}</div><p class="fine">Pip never fills a gap silently. Unknown stays unknown, with a flag.</p></div>`;
}
function briefHTML(st) {
  const T = st.task; if (!T.output) return '';
  const cs = CASES[T.caseId];
  const res = T.results.map(r => { const c = st.plan.criteria.find(x => x.id === r.id); return `<li><span class="${r.r === 'pass' ? 'ok' : r.r === 'fail' ? 'no' : 'un'}">${r.r === 'pass' ? '✓ pass' : r.r === 'fail' ? '✕ fail' : '○ untested'}</span> ${esc(c ? c.label : r.id)}${r.d ? ' <span class="muted">(' + esc(r.d) + ')</span>' : ''}</li>`; }).join('');
  let actions = '';
  if (T.state === 'awaiting_review') {
    actions = `<div class="row">${btn('review:approve', 'Approve <kbd>A</kbd>', 'btn primary')}${btn('review:fixopen', 'Request a fix <kbd>E</kbd>', 'btn')}${btn('review:reject', 'Reject <kbd>R</kbd>', 'btn danger')}</div>`;
    if (ui.reviseOpen) actions += `<form class="fixform" data-form="fix"><label for="fixtext"><strong>What should Pip change?</strong></label><textarea id="fixtext" maxlength="160">${esc(ui.reviseText)}</textarea><div class="row"><button class="btn primary" type="submit">Send fix and write plan v${st.plan.version + 1}</button></div></form>`;
  } else if (T.state === 'delivered') actions = `<div class="row">${btn('spot:ok', 'Spot-check passes', 'btn primary')}${btn('spot:bad', 'Found a problem', 'btn danger')}</div>`;
  return `<div class="card brief"><h3>Draft: ${esc(cs.title)} brief <span class="fine">· plan v${st.runs[st.runs.length - 1].v} · demo output</span></h3>
  ${T.output.secs.map(s => `<h4>${esc(s.title)}</h4><ul>${s.lines.map(l => `<li>${l.flag ? '<span class="flag">⚑</span> ' : ''}${esc(l.t)}</li>`).join('')}</ul>`).join('')}
  <h4>Exceptions for you</h4>${T.output.exc.length ? `<ul>${T.output.exc.map(x => `<li><span class="flag">⚑</span> ${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">None in the inputs.</p>'}
  <h4>Checks on this draft</h4><ul class="clean">${res}</ul>${actions}</div>`;
}
function renderTask() {
  const T = S.task, cs = CASES[T.caseId], v = S.plan.version, cur = S.evidence.filter(e => e.v === v);
  const busy = ['working', 'needs_input', 'awaiting_review'].includes(T.state);
  const caseRows = Object.values(CASES).map(c => {
    const proven = cur.some(e => e.caseId === c.id), locked = c.delegated && S.level < 3;
    return `<li><span class="${proven ? 'ok' : 'un'}" aria-hidden="true">${proven ? '✓' : c.delegated && locked ? '🔒' : '○'}</span><span style="flex:1"><strong>${esc(c.title)}</strong> — ${esc(c.kindLabel)}${proven ? ' <span class="ok">proven on v' + v + '</span>' : ''}${locked ? ' <span class="muted">(needs L3)</span>' : ''}</span>${btn('run:' + c.id, 'Run', 'btn small', busy || locked ? 'disabled' : '')}</li>`;
  }).join('');
  $('#p-task').innerHTML = `
  <div class="card"><h3>Weekly business brief <span class="fine">· synthetic data</span></h3>
   <p><span class="pill st-${T.state}"><i aria-hidden="true">${STATE_ICON[T.state]}</i> ${esc(STATE_LABEL[T.state])}</span> ${esc(cs.title)} · ${esc(LEVELS[S.level])} · plan v${v}</p>
   ${T.state === 'failed' ? `<p class="no">${esc(T.failReason)}</p>` : ''}${T.state === 'blocked' ? `<p class="no">Blocked: Pip may not ${esc(T.blockedReason)}.</p><div class="row">${btn('grant:read', 'Allow reading demo inputs', 'btn primary')}</div>` : ''}
   <p class="fine">Goal: a one-page weekly hiring/ops brief built from two synthetic exports (ATS and ops sheet). Pip drafts only. It never sends.</p></div>
  ${questionHTML(S)}${briefHTML(S)}
  <div class="card"><h3>Weeks to run</h3><ul class="clean">${caseRows}</ul>
   <div class="row" style="margin-top:8px">${btn('fault', 'Simulate a source outage for the next run', 'btn small', busy ? 'disabled' : '')}${S.fault ? '<span class="flag">Outage queued</span>' : ''}</div></div>
  <div class="card"><h3>Process: plan v${v}</h3><ul class="clean">${S.plan.criteria.map(c => `<li><span aria-hidden="true">▸</span> ${esc(c.label)}${c.check ? '' : ' <span class="un">(not checkable in demo)</span>'}</li>`).join('')}</ul>
   <form class="inline" data-form="teach" style="margin-top:8px"><label class="sr" for="teachin">Teach Pip a rule</label><input id="teachin" type="text" maxlength="120" value="${esc(ui.teachText)}" placeholder="Teach a rule, e.g. “Cite the source for every number”"><button class="btn" type="submit" ${busy ? 'disabled' : ''}>Teach</button></form>
   <p class="fine">Every change makes a new plan version. Earlier proof stays on record but stops counting.</p>
   <details><summary>Plan history</summary><ul class="clean mono">${S.history.map(h => `<li>v${h.v}: ${esc(h.reason)}${h.add ? ' + ' + esc(h.add) : ''}</li>`).join('')}</ul></details></div>`;
}
function renderEvidence() {
  const v = S.plan.version, next = S.level + 1, ck = gate(S, next), cur = S.evidence.filter(e => e.v === v);
  const ladder = LEVELS.map((l, i) => `<span class="${i === S.level ? 'on' : ''} ${i === 4 ? 'lock' : ''}" ${i === S.level ? 'aria-current="true"' : ''}>${i === 4 ? '🔒 ' : ''}${esc(l)}</span>`).join('');
  const runs = S.runs.slice().reverse().map(r => `<li><span style="flex:1"><strong>${esc(CASES[r.caseId].title)}</strong> · plan v${r.v} · ${r.delegated ? 'delegated' : 'reviewed'}<br><span class="muted">${r.res.map(x => (x.r === 'pass' ? '✓' : x.r === 'fail' ? '✕' : '○') + ' ' + esc((S.plan.criteria.find(c => c.id === x.id) || { short: x.id }).short)).join(' · ')}</span><br>Questions answered: ${r.questions} · Review: ${r.review ? esc(r.review.decision === 'revise' ? 'fix requested' : r.review.decision) : r.spot ? 'spot-check ' + r.spot : 'pending'} · ${r.counted ? '<span class="ok">counts as proof</span>' : r.why ? '<span class="flag">' + esc(r.why) + '</span>' : '<span class="muted">no proof yet</span>'}</span></li>`).join('');
  $('#p-evidence').innerHTML = `
  <div class="card"><h3>Autonomy: ${esc(LEVELS[S.level])}</h3><div class="ladder">${ladder}</div><p>${esc(LEVEL_DESC[S.level])}</p>
   <p class="fine">The levels borrow a human-management metaphor (situational leadership) per process. They are demo labels, not a validated measure of AI behavior, and there is no confidence score.</p></div>
  <div class="card"><h3>Gate for ${esc(LEVELS[Math.min(next, 4)])}</h3><ul class="clean">${ck.map(c => `<li><span class="${c.ok ? 'ok' : 'no'}" aria-hidden="true">${c.ok ? '✓' : '✕'}</span><span style="flex:1">${esc(c.label)}${c.ok || !c.hint ? '' : '<br><span class="muted">Next: ' + esc(c.hint) + '</span>'}<span class="sr">${c.ok ? ' met' : ' not met'}</span></span></li>`).join('')}</ul>
   <div class="row" style="margin-top:8px">${btn('level', next >= 4 ? 'L4 is locked in this demo' : 'Ask for ' + LEVELS[next], 'btn primary')}</div>
   <p class="fine">No fixed number of completions. Proof is per situation, per plan version. A fresh run of the same week on the same version adds no new proof.</p></div>
  <div class="card"><h3>Proof on plan v${v}</h3><ul class="clean">${['A', 'B', 'C'].map(id => `<li><span class="${cur.some(e => e.caseId === id) ? 'ok' : 'un'}" aria-hidden="true">${cur.some(e => e.caseId === id) ? '✓' : '○'}</span> ${esc(CASES[id].title)} — ${esc(CASES[id].kindLabel)}${cur.some(e => e.caseId === id) ? '' : ' <span class="muted">not yet</span>'}</li>`).join('')}</ul>
   ${S.evidence.length > cur.length ? `<p class="flag">${S.evidence.length - cur.length} earlier proof record(s) are from older plan versions and no longer count.</p>` : ''}
   <p class="fine">Counters: unsafe or premature requests refused ${S.refusals} · duplicate actions ignored ${S.dup} · approvals that added no proof ${S.noProof}</p></div>
  <div class="card"><h3>Run history</h3>${runs ? `<ul class="clean">${runs}</ul>` : '<p class="muted">No runs yet.</p>'}</div>`;
}
function renderPerms() {
  const v = S.plan.version, cur = S.evidence.filter(e => e.v === v), g = S.grants;
  const proven = ['A', 'B', 'C'].map(id => ({ id, ok: cur.some(e => e.caseId === id) }));
  const nProven = proven.filter(p => p.ok).length;
  let mis = '';
  if (g.draft && nProven < 3) mis = 'Permitted beyond proof: saving drafts is allowed, but only ' + nProven + ' of 3 situations are proven on plan v' + v + '.';
  else if (!g.draft && nProven === 3) mis = 'Proof not used: all three situations are proven, but saving drafts is not allowed.';
  const sw = (scope, label, on) => `<li><span style="flex:1"><strong>${label}</strong><br><span class="muted">${on ? 'Allowed' : 'Off'}</span></span>${btn((on ? 'revoke:' : 'grant:') + scope, on ? 'Revoke' : 'Allow', on ? 'btn small danger' : 'btn small primary')}</li>`;
  $('#p-perms').innerHTML = `
  <div class="card"><h3>What Pip may do</h3><p class="fine">Permissions are your decision. They are separate from what Pip has proven.</p><ul class="clean">
   ${sw('read', 'Read the synthetic demo inputs', g.read)}${sw('draft', 'Save weekly brief drafts', g.draft)}
   <li><span style="flex:1"><strong>🔒 Send the brief to people</strong><br><span class="muted">Locked. This demo never sends anything.</span></span>${btn('grant:send', 'Try to allow', 'btn small')}</li>
   <li><span style="flex:1"><strong>🔒 Connect real accounts</strong><br><span class="muted">Locked. No live integrations exist in this demo.</span></span>${btn('grant:accounts', 'Try to allow', 'btn small')}</li></ul></div>
  <div class="card"><h3>Proven vs permitted</h3>
   <p><strong>Proven on plan v${v}</strong></p><div class="capbar">${proven.map(p => `<span class="${p.ok ? 'yes' : 'deny'}">${p.ok ? '✓' : '○'} ${esc(CASES[p.id].kindLabel)}</span>`).join('')}</div>
   <p><strong>Permitted</strong></p><div class="capbar"><span class="${g.read ? 'grant' : 'deny'}">${g.read ? '✓' : '○'} read inputs</span><span class="${g.draft ? 'grant' : 'deny'}">${g.draft ? '✓' : '○'} save drafts</span></div>
   <p><strong>Not permitted</strong></p><div class="capbar"><span class="deny">✕ send to people</span><span class="deny">✕ real accounts</span></div>
   ${mis ? `<div class="hatch" role="note">${esc(mis)}</div>` : '<p class="fine">Proof and permissions line up right now.</p>'}</div>`;
}
function describe(e) { return e.text || e.type.replace(/_/g, ' '); }
let lastMsgCount = -1;
function renderChat() {
  const box = $('#msgs');
  const items = events.filter(e => e.text);
  const hello = `<div class="m pip"><small>Pip · scripted demo</small>Hi, I'm Pip. Teach me your weekly brief: tell me what it should cover, I draft it, you review it. I only earn more responsibility when the results show it, and demo defaults let me read the bundled sample inputs. Use the big button above to start.</div>`;
  box.innerHTML = hello + items.map(e => `<div class="m ${e.from === 'owner' ? 'owner' : e.from === 'pip' ? 'pip' : 'sys'}"><small>${e.from === 'owner' ? 'You' : e.from === 'pip' ? 'Pip · scripted demo' : 'System'}</small>${esc(e.text)}</div>`).join('');
  if (lastMsgCount !== items.length) { box.scrollTop = box.scrollHeight; lastMsgCount = items.length; }
  const T = S.task, ch = [];
  if (T.state === 'needs_input') ch.push(`<div class="chatq"><p><strong>Pip asks:</strong> ${esc(T.question.q)}</p><div class="chips">${questionHTML(S).match(/<div class="chips">([\s\S]*?)<\/div><p class="fine">/)[1]}</div></div>`);
  else if (T.state === 'awaiting_review') ch.push(btn('review:approve', 'Approve', 'chip primary'), btn('review:fixcite', 'Fix: cite sources', 'chip'), btn('review:reject', 'Reject', 'chip'), btn('tab:task', 'Open draft', 'chip'));
  else if (T.state === 'delivered') ch.push(btn('spot:ok', 'Spot-check passes', 'chip primary'), btn('spot:bad', 'Found a problem', 'chip'));
  else { const n = nextStep(S); if (!n.dis && n.a !== 'tab:task') ch.push(btn(n.a, esc(n.b), 'chip primary')); if (S.reviews.length) ch.push(btn('level', 'Ask for more responsibility', 'chip')); if (S.evidence.length) ch.push(btn('grant:send', 'Try: send it (will be refused)', 'chip')); }
  $('#chips').innerHTML = ch.join('');
}
function renderNext() {
  const n = nextStep(S);
  $('#nextbar').innerHTML = `<p class="lbl">Next step</p><span class="txt">${esc(n.t)}</span>${n.a ? btn(n.a, esc(n.b), 'btn primary', n.dis ? 'disabled' : '') : `<button class="btn primary" disabled>${esc(n.b)}</button>`}`;
}
function renderEvents() {
  const all = events.filter(e => e.type !== 'msg' || e.from !== 'owner' || true).filter(e => e.text);
  $('#strip').innerHTML = all.slice(-5).map(e => `<span>${esc(describe(e))}</span>`).join('') || '<span>No events yet.</span>';
  $('#fulllog').innerHTML = events.map(e => `<li>#${e.n} ${esc(e.t.slice(11, 19))} ${esc(e.type)}${e.text ? ' — ' + esc(e.text) : ''}</li>`).join('');
}
function renderTabs() {
  $$('.tabs button').forEach(b => { const on = b.dataset.tab === ui.tab; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; $('#p-' + b.dataset.tab).hidden = !on; });
}
function render() {
  const a = document.activeElement, fid = a && a.dataset && a.dataset.fid, fiv = a && a.id;
  renderWorld(); renderInfo(); renderNext(); renderChat(); renderTask(); renderEvidence(); renderPerms(); renderEvents(); renderTabs();
  if (fid) { const el = $('[data-fid="' + CSS.escape(fid) + '"]'); if (el && el !== document.activeElement && !el.disabled) el.focus({ preventScroll: true }); }
  else if (fiv && ['fixtext', 'teachin'].includes(fiv) && document.activeElement !== $('#' + fiv)) { const el = $('#' + fiv); if (el) el.focus(); }
}
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2600); }
function setTab(t, focus) { ui.tab = t; renderTabs(); if (focus) $('#tab-' + t).focus(); }

/* ---------- actions ---------- */
function doAct(a) {
  const [k, arg] = a.split(':');
  switch (k) {
    case 'tab': return setTab(arg);
    case 'grant': return cmdGrant(arg, true);
    case 'revoke': return cmdGrant(arg, false);
    case 'run': return cmdStart(arg);
    case 'answer': return cmdAnswer(arg);
    case 'review':
      if (arg === 'fixopen') { ui.reviseOpen = true; setTab('task'); renderTask(); const t = $('#fixtext'); if (t) t.focus(); return; }
      if (arg === 'fixcite') return cmdReview('revise', 'Cite the source for every number');
      return cmdReview(arg, '');
    case 'level': return cmdLevel();
    case 'spot': return cmdSpot(arg === 'ok');
    case 'fault': return cmdFault();
    case 'export': return doExport();
    case 'help': return $('#dlg-help').showModal();
    case 'about': return $('#dlg-about').showModal();
    case 'reset-ask': return $('#dlg-reset').showModal();
  }
}
function doExport() {
  const d = { app: "Pip's Workshop", simulation: true, note: 'Simulation / Demo export. Synthetic data, scripted coworker, nothing was sent.', exportedAt: new Date().toISOString(),
    derived: { level: LEVELS[S.level], planVersion: S.plan.version, criteria: S.plan.criteria.map(c => c.label), planHistory: S.history, grants: S.grants, evidence: S.evidence, runs: S.runs.map(r => ({ id: r.id, week: CASES[r.caseId].title, planVersion: r.v, delegated: r.delegated, results: r.res, review: r.review, spot: r.spot, countedAsProof: r.counted })), counters: { refusals: S.refusals, duplicatesIgnored: S.dup, approvalsWithoutNewProof: S.noProof } },
    events };
  const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'pips-workshop-demo-export.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Exported the demo log as JSON.');
}
function doReset() {
  clearTimeout(timer); timerRun = null; try { localStorage.removeItem(KEY); } catch (_) {} events = []; S = init(); ui.reviseOpen = false; lastMsgCount = -1; render(); toast('Demo reset.');
}

/* ---------- wiring ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (b && !b.disabled) { e.preventDefault(); doAct(b.dataset.act); return; }
  const t = e.target.closest('[data-tab]'); if (t) { setTab(t.dataset.tab); return; }
  const s = e.target.closest('.st'); if (s) openStation(s.dataset.st);
});
function openStation(id) { setTab(STN_TAB[id]); }
document.addEventListener('submit', e => {
  const f = e.target.closest('form'); if (!f) return;
  const kind = f.dataset.form;
  if (f.id === 'chatform') { e.preventDefault(); const i = $('#chatin'); const v = i.value; i.value = ''; chat(v); return; }
  if (!kind) return; e.preventDefault();
  if (kind === 'value') cmdAnswer('value', f.querySelector('input').value);
  if (kind === 'fix') { const txt = $('#fixtext').value.trim() || 'Cite the source for every number'; ui.reviseOpen = false; cmdReview('revise', txt); }
  if (kind === 'teach') { const i = $('#teachin'); const v = i.value; ui.teachText = ''; cmdTeach(v); }
});
document.addEventListener('input', e => { if (e.target.id === 'fixtext') ui.reviseText = e.target.value; if (e.target.id === 'teachin') ui.teachText = e.target.value; });
$('#reset-ok').addEventListener('click', () => doReset());
$('#world').addEventListener('keydown', e => {
  const s = e.target.closest('.st'); if (!s) return;
  const i = STN.indexOf(s.dataset.st);
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStation(s.dataset.st); }
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); focusStn((i + (e.key === 'ArrowRight' ? 1 : 3)) % 4); }
});
function focusStn(i) { STN.forEach((id, j) => $('#st-' + id).tabIndex = j === i ? 0 : -1); $('#st-' + STN[i]).focus(); }
$('.tabs').addEventListener('keydown', e => {
  const tabs = $$('.tabs button'), i = tabs.indexOf(document.activeElement);
  if (i < 0 || !['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
  e.preventDefault(); const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : 3)) % 4]; setTab(n.dataset.tab, true);
});
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tg = e.target; if (tg.closest('input,textarea,select') || tg.isContentEditable || document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase();
  if (['1', '2', '3', '4'].includes(k)) { focusStn(+k - 1); }
  else if (k === 'c') { e.preventDefault(); setTab('chat'); $('#chatin').focus(); }
  else if (k === '?') $('#dlg-help').showModal();
  else if (S.task.state === 'awaiting_review' && ['a', 'e', 'r'].includes(k)) { e.preventDefault(); doAct(k === 'a' ? 'review:approve' : k === 'e' ? 'review:fixopen' : 'review:reject'); }
});
window.addEventListener('storage', e => { if (e.key === KEY) sync(); });

/* ---------- boot ---------- */
$('#world').innerHTML = buildWorld();
events = load(); S = derive(events);
render(); schedule();
if (!events.length) { try { localStorage.setItem('fastpay.demo.probe', '1'); localStorage.removeItem('fastpay.demo.probe'); } catch (_) { memOnly = true; toast('Storage is unavailable: progress will not persist.'); } }
window.__pip = { state: () => S, events: () => events }; // read-only handle for automated checks
})();
