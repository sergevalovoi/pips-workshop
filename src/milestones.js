'use strict';
// Local, privacy-preserving pilot milestones DERIVED from the existing audit state. Nothing is stored separately and nothing is sent anywhere.
// Records contain only: event name, ISO timestamp, seconds since the first milestone, and provenance (real | stub | n/a).
// They never contain task text, results, notes, names, roles, ids, file paths, e-mail or credentials.
const EVENTS = ['agent_created', 'first_result', 'first_feedback', 'rule_corrected', 'second_case_reviewed', 'grant_issued', 'schedule_created', 'scheduled_result_success'];
const tsOf = (x) => (x ? Date.parse(x) : NaN);
const prov = (r) => (r && r.live === true ? 'real' : r && r.live === false ? 'stub' : 'n/a');
// Provider completion only (model returned text). Says NOTHING about mechanical checks or quality.
const hasResult = (r) => r && r.result != null && !r.error;
// Valid = provider text AND all mechanical checks passed (still not a quality judgement).
const isValid = (r) => hasResult(r) && !!(r.validation && r.validation.allPassed) && !['failed', 'rejected', 'cancelled', 'interrupted'].includes(r.status);
const earliest = (list) => list.filter((x) => Number.isFinite(x.t)).sort((a, b) => a.t - b.t)[0] || null;

function build(state, ctx, nowIso) {
  const agents = Object.values(state.agents || {});
  const procs = Object.values(state.procs || {});
  const runs = Object.values(state.runs || {}).filter((r) => r.kind === 'task');
  const manual = runs.filter((r) => r.mode === 'manual');
  const found = {};
  const put = (name, t, provenance) => { if (!Number.isFinite(t)) return; if (!found[name] || t < found[name].t) found[name] = { t, provenance: provenance || 'n/a' }; };

  const a0 = earliest(agents.map((a) => ({ t: tsOf(a.createdAt) })));
  if (a0) put('agent_created', a0.t, 'n/a');
  const r0 = earliest(runs.filter(hasResult).map((r) => ({ t: tsOf(r.finishedAt), p: prov(r) })));
  if (r0) put('first_result', r0.t, r0.p);
  const fb = [];
  for (const r of manual) {
    if (/follow/i.test(String(r.taskMode || ''))) fb.push({ t: tsOf(r.createdAt), p: prov(r) });
    if (r.review && r.review.decision === 'reject') fb.push({ t: tsOf(r.review.at), p: prov(r) });
  }
  const ruleVers = [];
  for (const p of procs) for (const v of p.versions || []) if (v.n > 1 && v.changes && ((v.changes.addedRules || []).length || (v.changes.removedRules || []).length || (v.changes.addedChecks || []).length || (v.changes.removedChecks || []).length)) ruleVers.push({ t: tsOf(v.createdAt), p: 'n/a' });
  const f0 = earliest(fb.concat(ruleVers));
  if (f0) put('first_feedback', f0.t, f0.p);
  const rc = earliest(ruleVers);
  if (rc) put('rule_corrected', rc.t, rc.p);
  // second_case_reviewed: two accepted manual runs of the SAME process and SAME version hash, different case ids and different canonical input hashes, checks passed.
  const groups = {}; const accepted = manual.filter((r) => r.status === 'accepted' && r.review && r.validation && r.validation.allPassed).sort((x, y) => tsOf(x.review.at) - tsOf(y.review.at));
  let second = null;
  for (const r of accepted) {
    const g = (groups[(r.procId || '') + '|' + (r.versionHash || r.versionN)] = groups[(r.procId || '') + '|' + (r.versionHash || r.versionN)] || { cases: new Set(), canon: new Set() });
    const k = r.caseId || r.id, c = r.canonHash || r.inputHash || r.id;
    if (g.cases.has(k) || g.canon.has(c)) continue;
    g.cases.add(k); g.canon.add(c);
    if (g.cases.size === 2) { second = r; break; }
  }
  if (second) put('second_case_reviewed', tsOf(second.review.at), prov(second));
  const g0 = earliest(procs.flatMap((p) => (p.grants || []).map((g) => ({ t: tsOf(g.grantedAt), p: 'n/a' }))));
  if (g0) put('grant_issued', g0.t, g0.p);
  const s0 = earliest(Object.values(state.schedules || {}).map((s) => ({ t: tsOf(s.createdAt), p: 'n/a' })));
  if (s0) put('schedule_created', s0.t, s0.p);
  const sr = earliest(runs.filter((r) => r.mode === 'scheduled' && isValid(r) && r.status === 'completed' && r.autoCompleted === true).map((r) => ({ t: tsOf(r.finishedAt), p: prov(r) })));
  if (sr) put('scheduled_result_success', sr.t, sr.p);

  const names = EVENTS.filter((n) => found[n]);
  const first = names.length ? Math.min(...names.map((n) => found[n].t)) : null;
  const events = names.map((n) => ({ event: n, at: new Date(found[n].t).toISOString(), secondsSinceFirstMilestone: Math.round((found[n].t - first) / 1000), provenance: found[n].provenance }));
  const bucket = () => ({ success: 0, error: 0, other: 0 });
  const counts = { real: bucket(), stub: bucket(), unknown: bucket() };
  for (const r of runs) {
    const b = counts[r.live === true ? 'real' : r.live === false ? 'stub' : 'unknown'];
    if (isValid(r)) b.success++; else if (hasResult(r)) b.other++; else if (['failed', 'interrupted', 'cancelled'].includes(r.status)) b.error++; else b.other++;
  }
  const reviews = { accepted: 0, rejected: 0 };
  for (const r of runs) if (r.review) reviews[r.review.decision === 'accept' ? 'accepted' : 'rejected']++;
  const bud = state.budget || {};
  return {
    kind: 'bay-office-milestones', schemaVersion: 1, app: 'bay-office-alpha', appVersion: ctx.appVersion, edition: ctx.edition,
    exportedAt: nowIso,
    privacy: 'Local derived summary. Contains no task text, results, notes, names, roles, file paths, e-mail or credentials. Generated on this computer; the app never uploads it. You choose whether to share it.',
    provenanceNote: 'real = produced by the signed-in local Claude Code; stub = automated test provider (not a participant observation); n/a = event not tied to a model run.',
    events, missingEvents: EVENTS.filter((n) => !found[n]),
    runCounts: counts, reviewDecisions: reviews,
    callsUsed: bud.calls || 0, callLimit: ctx.limits.maxCalls,
    semanticsNote: 'first_result = the provider returned text (not checked, not quality). scheduled_result_success = scheduled run whose mechanical checks passed and was auto-completed under a grant (not human-reviewed, not quality). second_case_reviewed = two accepted, check-passing, distinct cases on the same process version.',
    notice: 'These milestones are an activation log. They are not a usability study and not a competence score.',
  };
}
const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function toCsv(ex) {
  const rows = [['event', 'at', 'secondsSinceFirstMilestone', 'provenance']];
  for (const e of ex.events) rows.push([e.event, e.at, e.secondsSinceFirstMilestone, e.provenance]);
  rows.push([]); rows.push(['# runs', 'success', 'error', 'other']);
  for (const k of ['real', 'stub', 'unknown']) rows.push(['# ' + k, ex.runCounts[k].success, ex.runCounts[k].error, ex.runCounts[k].other]);
  rows.push(['# app', ex.appVersion, ex.edition, ex.exportedAt]);
  const crlf = String.fromCharCode(13, 10);
  return rows.map((r) => r.map(esc).join(',')).join(crlf) + crlf;
}
module.exports = { build, toCsv, EVENTS };
