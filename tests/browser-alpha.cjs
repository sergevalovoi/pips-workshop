'use strict';
// Browser regression for the alpha UI in English and Russian, against the STUB UI server (tests/ui-server.js): no Claude, no model, no network.
// Usage: node tests/browser-alpha.cjs [shotsDir]   (needs Playwright: devDependency, or PLAYWRIGHT_PATH=<path to playwright module>)
const fs = require('fs'); const os = require('os'); const path = require('path'); const net = require('net');
const { spawn } = require('child_process');
let playwright; try { playwright = require(process.env.PLAYWRIGHT_PATH || 'playwright'); } catch { console.log('Playwright not installed: npm i -D playwright, or set PLAYWRIGHT_PATH'); process.exit(2); }
const shots = process.argv[2] || null; if (shots) fs.mkdirSync(shots, { recursive: true });
const EN = (() => { const w = {}; new Function('window', fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n-en.js'), 'utf8'))(w); return w.BAY_EN; })();
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function runLang(lang) {
  const T = (ru) => (lang === 'ru' ? ru : (EN[ru] || ru));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-ui-')); const port = await freePort();
  const srv = spawn(process.execPath, [path.join(__dirname, 'ui-server.js'), String(port), dataDir], { env: { ...process.env, UI_FAST_SCHED: '1' }, stdio: 'ignore', windowsHide: true });
  const out = { lang, steps: [], errors: [], external: [] };
  const ok = (n, c) => { out.steps.push((c ? 'PASS ' : 'FAIL ') + n); if (!c) out.errors.push(n); };
  try {
    for (let i = 0; i < 60 && !fs.existsSync(path.join(dataDir, 'launch-url.txt')); i++) await wait(100);
    const link = fs.readFileSync(path.join(dataDir, 'launch-url.txt'), 'utf8').trim();
    const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript((l) => { if (!localStorage.getItem('bo.lang')) localStorage.setItem('bo.lang', l); }, lang);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => out.errors.push('pageerror ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console ' + m.text()); });
    page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1:' + port)) out.external.push(r.url()); });
    const state = async () => (await page.request.get(`http://127.0.0.1:${port}/api/state`)).json();
    await page.goto(link); await page.waitForSelector('#peopleDock .invite');
    ok('html lang', (await page.getAttribute('html', 'lang')) === lang);
    ok('header chrome translated', (await page.innerText('#btn-new-agent')).includes(lang === 'ru' ? 'Создать агента' : 'Create agent'));
    ok('9 rooms drawn (scene intact)', (await page.locator('#world .room').count()) === 9);
    ok('room label translated', (await page.locator('#world').textContent()).includes(lang === 'ru' ? 'Общий зал' : 'Common hall'));
    if (shots) await page.screenshot({ path: path.join(shots, `alpha-${lang}-empty.png`) });
    // guide + setup (no model call)
    const calls0 = (await state()).allowance.callsUsed;
    await page.click('#guideBtn'); await page.waitForSelector('#setup-line');
    ok('guide shows setup + six steps', (await page.locator('#modalBody ol li').count()) === 6 && (await page.innerText('#setup-line')).length > 10);
    ok('honesty: not retrained', /retrained|не дообучается/.test(await page.innerText('#modalBody')));
    if (shots) await page.screenshot({ path: path.join(shots, `alpha-${lang}-guide.png`) });
    await page.click('#closeModal');
    // create agent via preset
    await page.click('#btn-new-agent'); await page.waitForSelector('#form-agent'); await page.click('#preset-notes');
    ok('preset fills fields', (await page.inputValue('[name=name]')) === (lang === 'ru' ? 'Репортёр по заметкам' : 'Project Notes Reporter'));
    ok('four original appearances', (await page.locator('.av-opt').count()) === 4);
    await page.fill('[name=name]', 'Тест-пилот'); // user content stays as typed
    await page.click('#form-agent button.primary'); await page.waitForSelector('#world .agent-hit');
    ok('agent name untouched by i18n', /Тест-пилот/.test(await page.locator('#world .agent-name').textContent()));
    if (lang === 'en') ok('default process localized', (await (await state()).agents[0].procs[0].name) === 'Main process');
    const userTask = 'Напиши бриф: <img src=x onerror=alert(1)> Launch plan';
    await page.fill('[data-draft^="task-"]', userTask); await page.click(`text=${T('Отправить задачу')}`);
    await page.waitForSelector('.msg.agent .acts', { timeout: 15000 });
    ok('user text not translated/mutated', (await page.locator('.msg.user').first().innerText()).includes(userTask) && (await page.locator('.msg.user img').count()) === 0);
    ok('model result text untouched (stub, Russian)', /заглушка/.test(await page.locator('.msg.agent pre').first().innerText()));
    // teach rule
    await page.click(`.msg.agent >> text=${T('Научить')}`); await page.fill('[data-draft="teach-note"]', 'Always end with a price'); await page.selectOption('[data-draft="teach-ctype"]', 'contains_phrase'); await page.fill('[data-draft="teach-cval"]', 'Цена:');
    await page.click(`text=${T('Сохранить правило')}`); await page.waitForSelector(`text=${lang === 'ru' ? 'Сохранено как версия v2' : 'Saved as version v2'}`);
    await page.locator(`.msg.agent button:has-text("${T('Повторить')}")`).first().click();
    await page.waitForFunction((acc) => [...document.querySelectorAll('.msg.agent .acts button')].some((b) => b.textContent === acc && !b.disabled), T('Принять'), { timeout: 15000 });
    await page.locator(`.msg.agent button:has-text("${T('Принять')}")`).first().click(); await page.waitForTimeout(500);
    if (shots) await page.screenshot({ path: path.join(shots, `alpha-${lang}-chat.png`) });
    // second, different case
    await page.click('#newTask'); await page.waitForSelector('#modalBody textarea'); await page.fill('#modalBody [data-draft^="task-"]', 'Second brief on a different request');
    await page.click(`#modalBody >> text=${T('Отправить задачу')}`);
    await page.waitForFunction((acc) => [...document.querySelectorAll('.msg.agent .acts button')].some((b) => b.textContent === acc && !b.disabled), T('Принять'), { timeout: 15000 });
    await page.locator(`.msg.agent button:has-text("${T('Принять')}")`).first().click(); await page.waitForTimeout(600);
    await page.click('#panelTabs [data-panel=control]'); await page.waitForSelector(`text=${T('Выдать ограниченное право')}`); await page.click(`text=${T('Выдать право')}`); await page.waitForSelector(`text=${lang === 'ru' ? 'Право выдано' : 'Permission granted'}`);
    await page.click('#panelTabs [data-panel=plan]'); await page.waitForSelector(`text=${T('Запустить расписание')}`); await page.click(`text=${T('Запустить расписание')}`); await page.waitForSelector(`button:has-text("${T('Пауза')}")`);
    if (shots) await page.screenshot({ path: path.join(shots, `alpha-${lang}-schedule.png`) });
    await page.click(`button:has-text("${T('Пауза')}")`); await page.click(`.panel-box button:has-text("${T('Отменить')}")`); await page.waitForTimeout(500);
    await page.click('#panelTabs [data-panel=control]'); await page.click(`text=${T('Отозвать право')}`); await page.waitForSelector(`text=${lang === 'ru' ? 'Нужно 2 принятых' : 'You need 2 accepted'}`);
    // idle + export + setup check: no model calls, no external hosts
    const callsBefore = (await state()).allowance.callsUsed; await page.waitForTimeout(7500);
    const ex = await page.request.get(`http://127.0.0.1:${port}/api/export/milestones`); const exj = await ex.json();
    ok('export has milestone events with stub provenance', exj.events.length >= 5 && exj.events.some((e) => e.provenance === 'stub') && !exj.events.some((e) => e.provenance === 'real'));
    ok('export has no UI text', !JSON.stringify(exj).includes('Тест-пилот') && !JSON.stringify(exj).includes('Launch plan'));
    ok('idle/export did not call the model', (await state()).allowance.callsUsed === callsBefore && calls0 === 0);
    ok('no external requests', out.external.length === 0);
    // language toggle persists
    await page.click('#langBtn'); await page.waitForSelector('#peopleDock .person, #peopleDock .invite'); await page.waitForTimeout(700);
    const other = lang === 'ru' ? 'en' : 'ru'; ok('toggle switches language', (await page.getAttribute('html', 'lang')) === other);
    await page.reload(); await page.waitForSelector('#world .agent-hit'); ok('language persists after reload', (await page.getAttribute('html', 'lang')) === other);
    ok('agent survives language switch', /Тест-пилот/.test(await page.locator('#world .agent-name').textContent()));
    // keyboard focus
    await page.keyboard.press('Tab'); ok('keyboard focus reaches a control', await page.evaluate(() => document.activeElement && document.activeElement !== document.body));
    // mobile
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await m.addInitScript((l) => localStorage.setItem('bo.lang', l), lang);
    const mp = await m.newPage(); await mp.goto(link); await mp.waitForSelector('#world .agent-hit');
    ok('mobile no horizontal overflow', await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    if (shots) await mp.screenshot({ path: path.join(shots, `alpha-${lang}-mobile.png`) });
    await browser.close();
  } finally { srv.kill(); }
  return out;
}
(async () => {
  const res = []; for (const l of ['en', 'ru']) res.push(await runLang(l));
  console.log(JSON.stringify(res, null, 1));
  process.exit(res.every((r) => r.errors.length === 0) ? 0 : 1);
})().catch((e) => { console.log('UI TEST CRASH', e.stack || e.message); process.exit(1); });
