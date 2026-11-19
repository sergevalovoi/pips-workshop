'use strict';
// Deterministic, mechanical validation of the model's JSON brief against source snapshots.
const FIELDS = ['stargazers_count', 'forks_count', 'open_issues_count', 'subscribers_count', 'language', 'license',
  'created_at', 'pushed_at', 'archived', 'default_branch', 'description', 'latest_release_tag', 'latest_release_date', 'readme_quote'];
const CHECK_CATALOG = {
  schema: 'JSON has all required sections and types',
  facts_match_sources: 'every observed fact equals the snapshot value (or is a verbatim README quote) and cites a fetched URL',
  no_invented_metrics: 'no users/downloads/revenue-style numbers that are absent from the snapshots',
  has_next_priority: 'a next priority with an acceptance criterion',
  stars_caveat: 'limits explicitly say stars/forks are not users or revenue',
  unknowns_listed: 'at least one explicitly named unknown',
  measurable_acceptance: 'acceptance criterion contains a measurable threshold (a number)',
  fact_coverage: 'at least 3 verified facts per repository',
};
const BASE_CHECKS = ['schema', 'facts_match_sources', 'no_invented_metrics', 'has_next_priority'];
const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
const str = (x, min = 1) => typeof x === 'string' && x.trim().length >= min;

function extractJson(text) {
  if (typeof text !== 'string') return null;
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch { return null; }
}

function validate(out, snaps, checkIds) {
  const results = [];
  const add = (id, pass, detail) => results.push({ id, pass: !!pass, detail });
  const snapByName = {};
  for (const s of snaps) if (s.data) snapByName[s.data.full_name.toLowerCase()] = s;
  const urls = new Set();
  for (const s of snaps) for (const i of s.items) { urls.add(i.url); urls.add(i.requestedUrl); }
  if (snaps.some((s) => s.data && s.data.html_url)) for (const s of snaps) if (s.data) urls.add(s.data.html_url);
  const problems = [];
  if (!out || typeof out !== 'object' || Array.isArray(out)) problems.push('not an object');
  else {
    if (!str(out.summary, 20)) problems.push('summary');
    if (!Array.isArray(out.observed_facts) || !out.observed_facts.length) problems.push('observed_facts');
    if (!Array.isArray(out.interpretation) || !out.interpretation.length) problems.push('interpretation');
    if (!Array.isArray(out.limits) || !out.limits.length) problems.push('limits');
    if (!Array.isArray(out.unknowns)) problems.push('unknowns');
    if (!str(out.fastpay_implication, 20)) problems.push('fastpay_implication');
    const np = out.next_priority;
    if (!np || !str(np.title) || !str(np.rationale) || !str(np.acceptance_criterion)) problems.push('next_priority');
  }
  add('schema', !problems.length, problems.length ? 'missing/invalid: ' + problems.join(', ') : 'ok');
  if (problems.length) {
    for (const id of checkIds) if (id !== 'schema') add(id, false, 'not evaluated: schema invalid');
    const final = results.filter((r) => checkIds.includes(r.id));
    return { checks: final, allPassed: false, verifiedFacts: 0 };
  }
  const bad = []; let ok = 0; const perRepo = {};
  out.observed_facts.forEach((f, i) => {
    const s = f && snapByName[String(f.repo).toLowerCase()];
    if (!s) return bad.push(`#${i}: repo not in batch`);
    if (!FIELDS.includes(f.field)) return bad.push(`#${i}: field ${f.field}`);
    if (!urls.has(f.source_url) || !(s.items.some((it) => it.url === f.source_url || it.requestedUrl === f.source_url) || f.source_url === s.data.html_url)) return bad.push(`#${i}: url not fetched for ${s.data.full_name}`);
    if (f.field === 'readme_quote') {
      const q = norm(f.value);
      if (q.length < 8 || !s.data.readme_text || !norm(s.data.readme_text).includes(q)) return bad.push(`#${i}: quote not verbatim in README`);
    } else {
      const actual = s.data[f.field];
      if (actual === undefined || String(actual) !== String(f.value)) return bad.push(`#${i}: ${f.field}=${f.value} but source has ${actual}`);
    }
    ok++; perRepo[s.data.full_name] = (perRepo[s.data.full_name] || 0) + 1;
  });
  out.interpretation.forEach((x, i) => { if (x && typeof x === 'object' && x.based_on !== undefined && !(Array.isArray(x.based_on) && x.based_on.every((k) => Number.isInteger(k) && k >= 0 && k < out.observed_facts.length))) bad.push(`interpretation #${i}: based_on out of range`); });
  add('facts_match_sources', !bad.length, bad.length ? bad.slice(0, 5).join('; ') : `${ok} facts verified`);
  const interp = out.interpretation.map((x) => (typeof x === 'string' ? x : (x && x.text) || ''));
  const prose = [out.summary, out.fastpay_implication, ...interp, ...out.limits.filter((x) => typeof x === 'string'), out.next_priority.rationale].join(' \n ');
  const hay = JSON.stringify(snaps.map((s) => s.data));
  const sus = [];
  const re = /(\d[\d,.]*\s?[kKmM]?)\s*(?:\+\s*)?(users|downloads|installs|customers|subscribers|stars|forks|contributors|commits|revenue|MRR|ARR|DAU|MAU|per month|\/month|%)/g;
  let m;
  while ((m = re.exec(prose))) {
    const n = m[1].replace(/[,\s]/g, '');
    const before = prose.slice(Math.max(0, m.index - 40), m.index);
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sourced = new RegExp('(?<![\\d.,])' + esc + '(?![\\d])').test(hay); // whole-number match, not a substring like 20 in 2020
    if (!sourced && !/\b(target|at least|least|within)\b/i.test(before)) sus.push(m[0]);
  }
  add('no_invented_metrics', !sus.length, sus.length ? 'unsourced: ' + sus.slice(0, 4).join(', ') : 'none found');
  add('has_next_priority', str(out.next_priority.acceptance_criterion, 15), 'next_priority with acceptance criterion');
  const C = {
    stars_caveat: () => /star|fork/i.test(out.limits.join(' ')) && /(user|revenue|adoption|customer|usage)/i.test(out.limits.join(' ')),
    unknowns_listed: () => out.unknowns.filter((u) => str(u, 5)).length >= 1,
    measurable_acceptance: () => /\d/.test(out.next_priority.acceptance_criterion),
    fact_coverage: () => snaps.every((s) => (perRepo[s.data.full_name] || 0) >= 3),
  };
  for (const id of checkIds) if (C[id]) add(id, C[id](), CHECK_CATALOG[id]);
  const final = results.filter((r) => checkIds.includes(r.id));
  return { checks: final, allPassed: final.every((r) => r.pass), verifiedFacts: ok };
}
module.exports = { validate, extractJson, CHECK_CATALOG, BASE_CHECKS, FIELDS };
