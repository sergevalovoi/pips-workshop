'use strict';
// Allowlisted public GitHub sources. No arbitrary URLs/paths are ever accepted from clients.
const crypto = require('crypto');
const REPOS = {
  ours: 'sergevalovoi/pips-workshop',
  pixel: 'pixel-agents-hq/pixel-agents',
  office: 'paulrobello/claude-office',
  claw3d: 'iamlukethedev/Claw3D',
};
const BATCHES = {
  A: { id: 'A', label: 'Baseline: ours + Pixel Agents', repos: ['ours', 'pixel'] },
  B: { id: 'B', label: 'New batch: ours + Claude Office', repos: ['ours', 'office'] },
  C: { id: 'C', label: 'Held-out batch: ours + Claw3D', repos: ['ours', 'claw3d'] },
};
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const README_MAX = 6000;

async function ghGet(url, accept, fetchImpl) {
  const hops = [];
  for (let i = 0; i < 4; i++) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'api.github.com') throw new Error('host_not_allowed');
    const res = await fetchImpl(url, {
      redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'fastpay-live-pilot', Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' },
    });
    const remaining = res.headers.get('x-ratelimit-remaining');
    if ([301, 302, 307, 308].includes(res.status)) {
      hops.push({ from: url, status: res.status });
      url = new URL(res.headers.get('location'), url).href;
      continue;
    }
    const text = (await res.text()).slice(0, 400000);
    return { url, status: res.status, text, remaining: remaining == null ? null : Number(remaining), hops };
  }
  throw new Error('too_many_redirects');
}

// Fetch repo metadata + README + latest release. Returns an immutable snapshot object.
async function fetchSnapshot(key, fetchImpl = fetch) {
  const slug = REPOS[key];
  if (!slug) throw new Error('repo_not_allowlisted');
  const fetchedAt = new Date().toISOString();
  const items = [];
  const base = `https://api.github.com/repos/${slug}`;
  const meta = await ghGet(base, 'application/vnd.github+json', fetchImpl);
  items.push({ kind: 'repo', requestedUrl: base, url: meta.url, status: meta.status, fetchedAt, sha256: sha(meta.text), redirects: meta.hops });
  const snap = { key, requested: slug, fetchedAt, items, available: false, data: null, canonical: null, rateRemaining: meta.remaining };
  if (meta.status !== 200) { snap.error = `repo_http_${meta.status}`; return finish(snap); }
  const m = JSON.parse(meta.text);
  const data = {
    full_name: m.full_name, html_url: m.html_url, description: m.description ?? null,
    stargazers_count: m.stargazers_count, forks_count: m.forks_count, open_issues_count: m.open_issues_count,
    subscribers_count: m.subscribers_count ?? null, language: m.language ?? null,
    license: m.license ? m.license.spdx_id : null, created_at: m.created_at, pushed_at: m.pushed_at,
    archived: m.archived, default_branch: m.default_branch, topics: m.topics || [],
  };
  snap.canonical = { requested: slug, actual: m.full_name, redirected: m.full_name.toLowerCase() !== slug.toLowerCase() || meta.hops.length > 0 };
  const rd = await ghGet(`${base}/readme`, 'application/vnd.github.raw+json', fetchImpl);
  items.push({ kind: 'readme', requestedUrl: `${base}/readme`, url: rd.url, status: rd.status, fetchedAt: new Date().toISOString(), sha256: sha(rd.text), redirects: rd.hops });
  if (![200, 404].includes(rd.status)) { snap.error = `readme_http_${rd.status}`; return finish(snap); }
  data.readme_text = rd.status === 200 ? rd.text.slice(0, README_MAX) : null;
  data.readme_truncated = rd.status === 200 && rd.text.length > README_MAX;
  const rl = await ghGet(`${base}/releases/latest`, 'application/vnd.github+json', fetchImpl);
  items.push({ kind: 'release', requestedUrl: `${base}/releases/latest`, url: rl.url, status: rl.status, fetchedAt: new Date().toISOString(), sha256: sha(rl.text), redirects: rl.hops });
  if (![200, 404].includes(rl.status)) { snap.error = `release_http_${rl.status}`; return finish(snap); }
  if (rl.status === 200) { const r = JSON.parse(rl.text); data.latest_release_tag = r.tag_name; data.latest_release_date = r.published_at; }
  else { data.latest_release_tag = null; data.latest_release_date = null; }
  snap.data = data; snap.available = true;
  snap.rateRemaining = rl.remaining ?? rd.remaining ?? meta.remaining;
  return finish(snap);
}
function finish(snap) {
  snap.hash = sha(JSON.stringify({ r: snap.requested, d: snap.data ? { ...snap.data } : null, s: snap.items.map((i) => [i.kind, i.status]) }));
  snap.id = snap.hash.slice(0, 16);
  return snap;
}
module.exports = { REPOS, BATCHES, fetchSnapshot, sha };
