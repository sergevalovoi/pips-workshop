'use strict';
// Thin i18n layer. UI strings written in Russian in the source are looked up in a dictionary (i18n-en.js) and
// fall back to the original text. Language is chosen by localStorage 'bo.lang' (default: the page's <meta name="bay-default-lang">).
// User content and model output are NEVER passed through tr()/trp(). Switching language reloads the page.
(function () {
  const meta = document.querySelector('meta[name="bay-default-lang"]');
  let lang = (meta && meta.content) || 'en';
  try { const v = localStorage.getItem('bo.lang'); if (v === 'en' || v === 'ru') lang = v; } catch { /* ignore */ }
  const EN = window.BAY_EN || {}, STATIC = window.BAY_EN_STATIC || {};
  const fill = (t, vals) => { let i = 0; return t.replace(/\{\}/g, () => String(vals[i++] ?? '')); };
  function tr(s, ...vals) {
    if (Array.isArray(s)) { // tagged template: tr`…${x}…`
      const key = s.join('{}');
      if (lang === 'ru' || !EN[key]) return s.reduce((a, p, i) => a + p + (i < vals.length ? vals[i] : ''), '');
      return fill(EN[key], vals);
    }
    return lang === 'ru' ? s : (EN[s] || s);
  }
  // server-authored text (system chat lines, hold reasons, notes). Exact keys, templates and prefix keys; captured params are translated recursively.
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let pats = null;
  function build() {
    pats = [];
    for (const k of Object.keys(EN)) {
      if (k.includes('{}')) { if (k.length > 12) pats.push({ re: new RegExp('^' + k.split('{}').map(esc).join('([\\s\\S]*?)') + '$'), en: EN[k] }); } else if (/[:\s]$/.test(k)) pats.push({ re: new RegExp('^' + esc(k) + '([\\s\\S]*)$'), en: EN[k] + '{}' });
    }
    pats.sort((a, b) => b.re.source.length - a.re.source.length);
  }
  function trp(s) {
    if (lang === 'ru' || typeof s !== 'string' || !/[А-Яа-я]/.test(s)) return s;
    if (EN[s]) return EN[s];
    if (!pats) build();
    for (const p of pats) { const m = s.match(p.re); if (m) return fill(p.en, m.slice(1).map(trParam)); }
    // composite: sentences joined by space (several server notes are concatenated)
    const parts = s.split(/(?<=[.!?…])\s+/);
    if (parts.length > 1) return parts.map((x) => (EN[x] ? EN[x] : trpOne(x))).join(' ');
    return s;
  }
  // captured parameters may be user-authored (names, roles): never exact-label translate them, only template-pattern matches
  function trParam(s) { if (lang === 'ru' || typeof s !== 'string' || !/[А-Яа-я]/.test(s)) return s; if (!pats) build(); for (const p of pats) { const m = s.match(p.re); if (m) return fill(p.en, m.slice(1).map(trParam)); } return s; }
  function trpOne(s) { if (!pats) build(); for (const p of pats) { const m = s.match(p.re); if (m) return fill(p.en, m.slice(1).map(trParam)); } return s; }
  function staticPass() {
    if (lang === 'ru') return;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
    for (const n of nodes) { const v = n.nodeValue; if (STATIC[v]) n.nodeValue = STATIC[v]; else if (STATIC[v.trim()]) n.nodeValue = v.replace(v.trim(), STATIC[v.trim()]); }
    for (const e of document.querySelectorAll('[title],[aria-label],[placeholder],[alt]')) for (const a of ['title', 'aria-label', 'placeholder', 'alt']) { const v = e.getAttribute(a); if (v && STATIC[v]) e.setAttribute(a, STATIC[v]); }
    if (STATIC[document.title]) document.title = STATIC[document.title];
    document.documentElement.lang = 'en';
  }
  function setLang(l) { try { localStorage.setItem('bo.lang', l); } catch { /* ignore */ } location.reload(); }
  document.documentElement.lang = lang;
  window.tr = tr; window.trp = trp; window.BAY_LANG = lang; window.baySetLang = setLang; window.bayStaticPass = staticPass;
  document.addEventListener('DOMContentLoaded', staticPass);
})();
