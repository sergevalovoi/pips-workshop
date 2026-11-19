'use strict';
// Thin display adapter: current real MVP API (/api/state) -> original Bay Office v11 shell/scene (public/bay/*).
// All behaviour (chat, learning versions, grants, finite schedules, budget) stays in the unchanged backend. DOM is built with textContent only.
(function () {
  const byId = (id) => document.getElementById(id);
  const ERR = {
    name_required: tr('Укажите имя.'), role_required: tr('Опишите роль агента.'), bad_avatar: tr('Выберите аватар из списка.'), bad_text: tr('Некорректный текст.'), text_too_long: tr('Текст слишком длинный.'),
    task_required: tr('Напишите задачу.'), note_required: tr('Напишите замечание обычными словами.'), unknown_agent: tr('Агент не найден.'), unknown_process: tr('Процесс не найден.'),
    duplicate_input_and_version: tr('Это тот же ввод на той же версии процесса — не новое свидетельство. Измените задачу/данные или сначала научите агента (новая версия).'),
    agent_busy: tr('У агента уже есть незавершённые задачи — дождитесь результата.'), budget_halted: tr('Расход остановлен после сигнала лимита. Ничего не запускается.'),
    call_limit_reached: tr('Достигнут общий лимит вызовов. Новые запуски невозможны.'), cost_limit_reached: tr('Достигнут лимит стоимости. Новые запуски невозможны.'),
    insufficient_evidence: tr('Недостаточно свидетельств: нужно 2 принятых результата на разных вводах этого процесса и его текущей версии.'),
    grant_already_active: tr('Право на черновики уже выдано.'), scope_not_allowed: tr('Недопустимая область права.'), no_active_grant_for_current_version: tr('Сначала выдайте право на черновики для текущей версии.'),
    bad_interval: tr('Недопустимый интервал.'), bad_count: tr('Повторов может быть от 1 до 3.'), schedule_exists_for_process: tr('У процесса уже есть расписание (активное или на паузе). Отмените его, чтобы создать новое.'),
    grant_allows_fewer_runs: tr('Право на черновики допускает меньше повторов.'), source_must_be_accepted_run_at_current_version: tr('Выберите принятый результат на текущей версии.'),
    cannot_accept_failed_checks: tr('Нельзя принять: не пройдены механические проверки.'), stale_version: tr('Результат на устаревшей версии — запустите заново.'), run_not_awaiting_review: tr('Результат уже не ждёт проверки.'),
    unknown_check: tr('Неизвестный тип проверки.'), check_value_required: tr('У проверки должно быть значение.'), check_value_must_be_positive_integer: tr('Для длины нужно целое положительное число.'), too_many_rules: tr('Слишком много правил.'),
    process_name_taken: tr('Процесс с таким именем уже есть.'), too_many_processes: tr('Достигнут лимит процессов у агента.'), too_many_agents: tr('Достигнут лимит агентов.'), delegation_not_active: tr('Делегирование неактивно на текущей версии — выдайте его заново.'),
    no_session: tr('Сессия истекла. Откройте ссылку запуска заново.'), bad_csrf: tr('Сессия устарела. Обновите страницу.'), bad_json: tr('Некорректный запрос.'), body_too_large: tr('Слишком большой запрос.'), network: tr('Нет связи с локальным сервером.'), not_cancellable: tr('Уже нельзя отменить.'),
  };
  Object.assign(ERR, {
    followup_hint: '', no_prior_result: tr('Нет предыдущего ответа для доработки — начните «Новую задачу».'), prior_not_finished: tr('Предыдущий ответ ещё не готов.'), retry_not_allowed: tr('Повторить можно только отклонённый, упавший или прерванный результат.'), case_has_open_attempt: tr('По этому случаю уже есть попытка в работе или на проверке.'),
    rule_needs_referent: tr('Замечание ссылается на «так/это», но не привязано к ответу.'), rules_limit: tr('Слишком много правил.'), checks_limit: tr('Слишком много проверок.'), rules_too_long: tr('Правила слишком длинные в сумме.'), check_conflict: tr('Правила противоречат друг другу.'), no_changes: tr('Изменений нет.'), nothing_to_change: tr('Нечего менять.'), bad_rules: tr('Некорректный список правил.'), bad_checks: tr('Некорректный список проверок.'),
    no_source: tr('Заметки проекта ещё не созданы.'), source_missing: tr('Файл заметок не найден или недоступен. Модель не вызывалась.'), source_not_regular_file: tr('Заметка не является обычным файлом (ссылки запрещены).'), source_too_large: tr('Заметка слишком большая.'), source_not_utf8: tr('Заметка не в UTF-8.'), source_binary: tr('В заметке бинарные/управляющие символы — нужен обычный текст.'), source_empty: tr('Заметка пустая.'), source_filetype: tr('Допустимы только файлы .md и .txt.'), source_text_required: tr('Введите текст заметки.'), source_run_required: tr('Для «новой сводки» нужен принятый результат, построенный по заметкам.'), snapshot_missing: tr('Снимок заметок не найден.'), snapshot_corrupt: tr('Снимок заметок повреждён.'), prompt_too_large: tr('Запрос слишком большой: сократите правила, задачу или заметки.'), bad_mode: tr('Недопустимый тип расписания.'), not_recreatable: tr('Это расписание нельзя создать заново.'),
  });
  const STATUS = { queued: [tr('в очереди'), 'warn'], running: [tr('выполняется'), 'warn'], 'needs-review': [tr('ждёт проверки'), 'warn'], accepted: [tr('принят'), 'ok'], rejected: [tr('отклонён'), 'bad'], failed: [tr('ошибка'), 'bad'], interrupted: [tr('прервано'), 'bad'], cancelled: [tr('отменено'), 'bad'], completed: [tr('черновик готов (не проверен человеком)'), 'ok'] };
  const STATE_RU = { idle: tr('свободен'), working: tr('работает'), queued: tr('в очереди'), review: tr('ждёт проверки'), learning: tr('учится'), delegated: tr('повтор по расписанию') };
  const SCH_RU = { 'done-nochange': tr('завершено: заметки не менялись, модель не вызывалась'), active: tr('активно'), paused: tr('пауза'), done: tr('завершено (результат получен)'), draining: tr('все повторы запущены — ждём результат последнего'), 'done-failed': tr('все повторы запущены; последний завершился ошибкой'), 'done-interrupted': tr('последний повтор прерван'), 'done-cancelled': tr('последний повтор отменён'), 'done-needs-review': tr('последний повтор вернулся на проверку'), 'done-rejected': tr('последний повтор отклонён'), cancelled: tr('отменено') };
  const TAB_TITLES = { sheet: tr('Карточка'), queue: tr('Доска'), control: tr('Контроль'), messages: tr('Обсуждения'), growth: tr('Развитие'), charter: tr('Устав'), activity: tr('Действия'), plan: tr('План') };
  const DEPT_ROOMS = ['sales', 'finance', 'product', 'hr', 'lab', 'life'];
  const ROOM_ORDER = ['commons', 'sales', 'finance', 'product', 'hr', 'lab', 'life', 'kitchen', 'review'];
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  let rmode = lsGet('bo.rmode', 'owner') === 'agent' ? 'agent' : 'owner';
  const rv = () => (rmode === 'agent' ? { reviewer: 'agent' } : {});
  let S = null, sel = null, procSel = {}, teachRun = null, retryHint = {}, flash = {}, pollTimer = null, panelSig = '', busy = false, lastOk = null;
  const drafts = {};
  let roomPrefs = {};
  try { const o = JSON.parse(lsGet('bo.rooms', '{}')); if (o && typeof o === 'object') roomPrefs = o; } catch { roomPrefs = {}; }

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  const LOC = window.BAY_LANG === 'ru' ? 'ru-RU' : 'en-US', TZ = window.BAY_LANG === 'ru' ? 'Europe/Moscow' : undefined;
  const fmt = (iso) => iso ? new Date(iso).toLocaleString(LOC, { hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit' }) : '—';
  const hm = (iso) => iso ? new Date(iso).toLocaleTimeString(LOC, TZ ? { hour: '2-digit', minute: '2-digit', timeZone: TZ } : { hour: '2-digit', minute: '2-digit' }) : '—';
  const errText = (j, status) => (j && ERR[j.error]) ? ERR[j.error] + (j.detail ? ' (' + trp(j.detail) + ')' : '') : (j && j.error ? tr('Ошибка: ') + j.error : tr('Ошибка ') + status);
  const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  function toast(text) { const t = byId('toast'); t.textContent = text; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3500); }

  async function api(method, path, body) {
    try {
      const r = await fetch(path, { method, credentials: 'same-origin', headers: method === 'POST' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': S ? S.csrf : '' } : {}, body: body === undefined ? undefined : JSON.stringify(body) });
      let j = null; try { j = await r.json(); } catch { /* none */ }
      return { ok: r.ok, status: r.status, json: j };
    } catch { return { ok: false, status: 0, json: { error: 'network' } }; }
  }
  const curAgent = () => S && S.agents.find((a) => a.id === (selection.type === 'person' ? selection.id : null)) || null;
  const agentById = (id) => S && S.agents.find((a) => a.id === id) || null;
  const roomOf = (a) => (DEPT_ROOMS.includes(roomPrefs[a.id]) ? roomPrefs[a.id] : 'product');
  const roomAgents = (room) => !S ? [] : DEPT_ROOMS.includes(room) ? S.agents.filter((a) => roomOf(a) === room) : S.agents;
  const openRun = (r) => ['queued', 'running', 'needs-review'].includes(r.status);

  // ---------- adapter: current state -> original office model ----------
  function adapt() {
    const counters = {}, people = [], tasks = [], activity = [], hot = { queue: {}, messages: {}, control: {}, growth: {} };
    const bump = (k, room, n = 1) => { hot[k][room] = (hot[k][room] || 0) + n; };
    for (const a of S.agents) {
      const room = roomOf(a); counters[room] = (counters[room] || 0);
      OFFICE_HOME[a.id] = { room, slot: counters[room]++ };
      people.push({ id: a.id, name: a.name.length > 13 ? a.name.slice(0, 12) + '…' : a.name, img: '/assets/bay/' + (S.avatars.includes(a.avatar) ? a.avatar : 'mark') + '.webp', ready: true, engine: 'Claude', role: a.role });
      for (const r of a.runs) {
        const st = { queued: 'queued', running: 'running', 'needs-review': 'review', accepted: 'accepted', completed: 'accepted' }[r.status] || 'closed';
        tasks.push({ id: r.id, title: clip(r.task || r.procName, 70), owner: a.id, department: room, status: st, realStatus: r.status, attempts: 0, createdAt: r.createdAt });
        if (['queued', 'running', 'needs-review'].includes(r.status)) { bump('queue', room); bump('queue', 'commons'); }
        if (r.status === 'needs-review') { bump('control', 'commons'); bump('control', 'review'); }
        activity.push({ id: r.id + ':c', created: r.createdAt, actor: a.id, room, title: (r.mode === 'scheduled' ? tr('Повтор по расписанию: ') : tr('Задача: ')) + clip(r.task, 60), detail: a.name + ' · ' + r.procName + ' ' + r.versionId + ' · ' + (STATUS[r.status] || [r.status])[0], task_id: r.id });
        if (r.review) activity.push({ id: r.id + ':r', created: r.review.at || r.finishedAt || r.createdAt, actor: a.id, room, title: (r.review.decision === 'accept' ? tr('Принято: ') : tr('Отклонено: ')) + clip(r.task, 50), detail: (r.effectiveActor || r.review.actor) + (r.review.note ? ' — ' + r.review.note : ''), task_id: r.id });
      }
      for (const p of a.procs) {
        const extra = p.versions.length - 1; if (extra > 0) { bump('growth', room, extra); bump('growth', 'review', extra); }
        for (const v of p.versions) if (v.n > 1) activity.push({ id: p.id + ':' + v.id, created: v.createdAt, actor: a.id, room, title: tr('Новая версия процесса ') + v.id, detail: a.name + ' · ' + p.name + ' · ' + clip(v.note, 100) });
      }
      bump('messages', 'kitchen', a.chat.filter((m) => m.role === 'user').length);
    }
    activity.sort((x, y) => String(y.created).localeCompare(String(x.created)));
    const names = new Set(S.agents.map((a) => a.id));
    for (const k of Object.keys(OFFICE_HOME)) if (!names.has(k) && !['serge', 'dina', 'teia', 'mark', 'nora', 'atlas'].includes(k)) delete OFFICE_HOME[k];
    state = { people, tasks, runs: [], activity: activity.slice(0, 80), phase: 'work', settings: {}, helps: [], reflections: [], dispatch: {}, supervision: {}, hot, departments: ROOM_ORDER.map(dept) };
  }

  async function refresh() {
    const r = await api('GET', '/api/state');
    if (!r.ok) { byId('connection').textContent = tr('Нет связи — данные могут быть устаревшими'); byId('connectionDot').className = ''; if (!S) byId('panelContent').textContent = errText(r.json, r.status); schedulePoll(); return; }
    S = r.json; lastOk = Date.now(); adapt(); render(); schedulePoll();
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    const pending = S && S.agents.some((a) => a.runs.some((x) => ['queued', 'running'].includes(x.status)) || a.procs.some((p) => p.schedules.some((s) => s.status === 'active')));
    pollTimer = setTimeout(() => { if (!document.hidden) refresh(); else schedulePoll(); }, pending ? 1500 : 6000); // read-only polling never calls the model
  }

  function render() {
    if (selection.type === 'person' && !agentById(selection.id)) selection = { type: 'room', id: 'commons' };
    renderChrome(); renderTabs(); renderDock(); renderPanelHead(); renderPanel(false); drawWorld();
  }
  function renderChrome() {
    byId('connection').textContent = tr('Локальный офис · состояние на этом ПК · ') + hm(new Date(lastOk).toISOString()) + tr(' МСК');
    byId('connectionDot').className = 'good';
    const al = S.allowance, b = byId('banner');
    if (al.halted) { b.hidden = false; b.className = 'banner err'; b.textContent = tr('Расход остановлен: ') + (trp(al.haltReason) || tr('сигнал лимита')) + tr('. Новые запуски не выполняются.'); }
    else if (al.callsRemaining === 0) { b.hidden = false; b.className = 'banner err'; b.textContent = tr('Общий лимит вызовов исчерпан. Новые запуски невозможны.'); }
    else b.hidden = true;
    const sch = S.agents.flatMap((a) => a.procs.flatMap((p) => p.schedules)).filter((s) => ['active', 'paused'].includes(s.status));
    byId('lastScan').textContent = tr`Вызовов осталось ${al.callsRemaining} из ${al.maxCalls} · ≈ $${al.usd.toFixed(3)} · ` + (al.queue ? tr`в работе/очереди: ${al.queue}` : tr('очередь пуста'));
    byId('nextScan').textContent = sch.length ? tr('Расписаний активно/на паузе: ') + sch.length : tr('Активных расписаний нет');
    const ph = byId('dayPhase'); ph.textContent = S.mode === 'LIVE-LOCAL' ? tr('Claude (подписка)') : tr('ТЕСТОВАЯ ЗАГЛУШКА');
  }
  function renderTabs() {
    const t = byId('departmentTabs'); const items = ['sales', 'finance', 'product', 'hr', 'lab', 'life', 'commons', 'kitchen', 'review'];
    t.replaceChildren(...items.map((id) => { const n = DEPT_ROOMS.includes(id) ? roomAgents(id).length : 0; return h('button', { 'data-room': id, class: selection.type === 'room' && selection.id === id ? 'active' : '' }, h('i', {}), dept(id).name + (n ? ' · ' + n : '')); }));
  }
  function renderDock() {
    const d = byId('peopleDock');
    if (!S.agents.length) { d.replaceChildren(h('div', { class: 'invite' }, tr('Агентов пока нет. Комнаты пусты — «＋ Создать агента» в шапке добавит первого (имя, роль, цель, один из четырёх оригинальных образов).'))); return; }
    d.replaceChildren(...S.agents.map((a) => {
      const img = h('img', { src: '/assets/bay/' + (S.avatars.includes(a.avatar) ? a.avatar : 'mark') + '.webp', alt: '', width: '42', height: '44' });
      return h('button', { class: 'person' + (selection.type === 'person' && selection.id === a.id ? ' selected' : ''), 'data-person': a.id },
        h('i', { class: 'status ready' }), h('div', { class: 'person-top' }, h('span', { class: 'mini-av' }, img), h('div', {}, h('strong', {}, a.name), h('small', {}, STATE_RU[a.state] || a.state), h('span', { class: 'mini' }, dept(roomOf(a)).name))));
    }));
  }
  function renderPanelHead() {
    const a = curAgent();
    byId('sheetTab').hidden = !a;
    if (!a && panel === 'sheet') panel = 'queue';
    for (const b of document.querySelectorAll('#panelTabs [data-panel]')) b.classList.toggle('active', b.dataset.panel === panel);
    byId('panelEyebrow').textContent = a ? dept(roomOf(a)).name + ' · ' + (STATE_RU[a.state] || a.state) : (selection.type === 'room' ? tr('Комната') : '');
    byId('panelTitle').textContent = a ? a.name : selection.id === 'commons' ? tr('Пульс компании') : dept(selection.id).name;
    byId('panelBadge').textContent = TAB_TITLES[panel] || tr('Факты');
  }

  // ---------- selection / panel ----------
  function setPanelOpen(open) {
    panelOpen = open; byId('inspector').classList.toggle('collapsed', !open); document.querySelector('.app').classList.toggle('panel-collapsed', !open);
    byId('panelToggle').setAttribute('aria-expanded', String(open)); byId('panelToggle').textContent = open ? tr('Панель ›') : tr('‹ Панель');
    if (typeof applyCamera === 'function') setTimeout(applyCamera, 30);
  }
  function select(type, id, pn) {
    selection = { type, id }; if (type === 'person') { sel = id; teachRun = null; }
    panel = pn || (type === 'person' ? 'messages' : id === 'kitchen' ? 'messages' : id === 'review' ? 'control' : 'queue');
    if (!panelOpen) setPanelOpen(true);
    if (S) render(); if (type === 'room') focusRoom(id);
    if (matchMedia('(max-width:850px)').matches) byId('inspector').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  window.select = select;
  function setPanel(p) { panel = p; renderPanelHead(); renderPanel(true); }

  // ---------- panel rendering ----------
  function captureFocus() { const e = document.activeElement; return e && e.dataset && e.dataset.draft && byId('panelContent').contains(e) ? { k: e.dataset.draft, s: e.selectionStart, e: e.selectionEnd } : null; }
  function restoreFocus(f) { if (!f) return; const e = document.querySelector(`[data-draft="${f.k}"]`); if (e) { e.focus(); try { e.setSelectionRange(f.s, f.e); } catch { /* ignore */ } } }
  function field(kind, key, attrs) { const e = h(kind, { 'data-draft': key, ...attrs }); e.value = drafts[key] || ''; e.addEventListener('input', () => { drafts[key] = e.value; }); return e; }
  const setFlash = (a, t) => { flash[a.id] = t; panelSig = ''; };
  function procOf(a) { const id = procSel[a.id] && a.procs.find((p) => p.id === procSel[a.id]) ? procSel[a.id] : a.procs[0].id; return a.procs.find((p) => p.id === id); }
  function empty(text, ...kids) { return h('div', { class: 'empty' }, text, ...kids); }
  const ctaCreate = () => h('div', { class: 'panel-actions' }, h('button', { class: 'primary', onclick: openCreate }, tr('Создать агента')));

  function renderPanel(force) {
    const box = byId('panelContent'); const a = curAgent();
    const rel = a ? [a] : roomAgents(selection.id);
    const sig = JSON.stringify([selection, panel, rel, a && procSel[a.id], flash, S.allowance.callsRemaining, S.allowance.halted, busy, teachRun, retryHint, rmode]);
    if (!force && sig === panelSig) return; panelSig = sig;
    const f = captureFocus(); const old = box.querySelector('.chat'); const atBottom = !old || old.scrollHeight - old.scrollTop - old.clientHeight < 40; const top = box.scrollTop;
    box.replaceChildren();
    if (a && flash[a.id]) box.append(h('div', { class: 'panel-box', role: 'status' }, flash[a.id]));
    const R = { sheet: sheetPanel, queue: queuePanel, control: controlPanel, messages: messagesPanel, growth: growthPanel, charter: charterPanel, activity: activityPanel, plan: planPanel }[panel] || queuePanel;
    R(box, a, rel);
    const ch = box.querySelector('.chat'); if (ch && atBottom) ch.scrollTop = ch.scrollHeight; else box.scrollTop = top;
    restoreFocus(f); tickCountdown();
  }

  function taskCard(a, r) {
    const [stT, stC] = STATUS[r.status] || [r.status, ''];
    return h('article', { class: 'review-card' }, h('div', { class: 'panel-actions' }, h('span', { class: 'badge-s ' + stC }, stT), h('span', { class: 'pill' }, a.name), h('span', { class: 'pill' }, `${r.procName} ${r.versionId}`), r.mode === 'scheduled' ? h('span', { class: 'pill' }, tr('повтор №') + r.occurrence) : null),
      h('p', {}, clip(r.task, 160)), r.result ? h('details', {}, h('summary', {}, tr('Результат')), h('div', { class: 'result-text' }, r.result)) : null,
      h('div', { class: 'hint meta' }, fmt(r.createdAt) + (r.finishedAt ? ' → ' + fmt(r.finishedAt) : '')), h('div', { class: 'panel-actions' }, h('button', { onclick: () => select('person', a.id, 'messages') }, tr('Открыть чат'))));
  }
  function queuePanel(box, a, rel) {
    box.append(h('p', { class: 'hint' }, tr('Реальные задачи и результаты агентов. Новые задачи ставятся из чата или кнопкой «+ Задача».')));
    const runs = rel.flatMap((x) => x.runs.map((r) => [x, r])).sort((p, q) => q[1].createdAt.localeCompare(p[1].createdAt));
    if (!runs.length) { box.append(empty(rel.length ? tr('У выбранных агентов задач пока нет.') : tr('В этой комнате никого нет — это не имитация занятости.'), ...(rel.length ? [h('div', { class: 'panel-actions' }, h('button', { class: 'primary', onclick: openTask }, tr('+ Задача')))] : [ctaCreate()]))); return; }
    for (const [x, r] of runs.slice(0, 40)) box.append(taskCard(x, r));
  }

  function runCard(a, m, r) {
    const [stT, stC] = STATUS[r.status] || [r.status, ''];
    const kids = [h('div', { class: 'meta' }, `${a.name} · ${r.procName} ${r.versionId}${r.mode === 'scheduled' ? tr` · повтор по расписанию №${r.occurrence}` : ''} · `, h('span', { class: 'badge-s ' + stC }, stT))];
    const modeRu = { new: tr('новая задача'), followup: tr('доработка (тот же случай)'), retry: tr`повтор №${r.attempt} (тот же случай)`, scheduled: tr('по расписанию') }[r.taskMode];
    if (modeRu) kids.push(h('div', { class: 'meta' }, tr('Тип: ') + modeRu + (r.legacyCase ? '' : tr` · случай ${r.caseId.slice(-6)}`)));
    if (r.sourceSnapshot) kids.push(h('div', { class: 'meta' }, tr`Заметки: ревизия ${r.sourceSnapshot.rev == null ? '?' : r.sourceSnapshot.rev} · ${r.sourceSnapshot.hash.slice(0, 8)} · снято ${fmt(r.sourceSnapshot.fetchedAt)}${r.sourceSnapshot.reused ? tr(' · снимок предыдущего ответа, не обновлялся') : ''}`));
    if (r.dialogue) kids.push(h('div', { class: 'meta' }, tr`Контекст доработки: предыдущий ответ ${r.dialogue.priorTruncated ? tr`обрезан (${r.dialogue.priorShown} из ${r.dialogue.priorTotal} симв.)` : tr('целиком')}, запросов владельца: ${r.dialogue.turns}${r.dialogue.droppedTurns ? tr` (ещё ${r.dialogue.droppedTurns} старых не передано)` : ''}`));
    kids.push(h('pre', {}, r.result || m.text || ''));
    if (r.validation) kids.push(h('div', { class: 'checks' }, tr('Механические проверки: '), r.validation.checks.map((c) => h('span', { class: c.pass ? 'ok' : 'no', title: c.detail }, (c.pass ? '✓ ' : '✗ ') + trp(c.label) + (c.base ? '' : ` «${c.value}»`) + '; '))));
    if (r.holdReason) kids.push(h('div', { class: 'checks no' }, tr('Возвращено на проверку: ') + trp(r.holdReason)));
    if (r.mode === 'scheduled') kids.push(h('div', { class: 'checks' }, tr('Это повторное выполнение, а не новое свидетельство обучения.')));
    if (r.review) kids.push(h('div', { class: 'checks' }, `${r.review.decision === 'accept' ? tr('Принял') : tr('Отклонил')}: ${r.effectiveActor || r.review.actor}${r.review.note ? ' — ' + r.review.note : ''}`));
    if (r.qualityCorrection) kids.push(h('div', { class: 'checks no' }, tr('Поправка качества (ошибка ревьюера): ') + r.qualityCorrection.finding + ' ' + r.qualityCorrection.effect));
    if (r.actorCorrected) kids.push(h('div', { class: 'checks no', title: tr('Исходная запись сохранена без изменений; добавлена поправка провенанса') }, tr`Поправка провенанса: исходная запись «${r.review.actor}», фактически решение принято автоматизацией (тест-пилот), не владельцем.`));
    const acts = h('div', { class: 'acts' });
    if (r.status === 'needs-review') {
      acts.append(h('button', { class: 'primary', disabled: !(r.validation && r.validation.allPassed) || busy, title: r.validation && !r.validation.allPassed ? tr('Не пройдены механические проверки') : '', onclick: () => doReview(a, r, 'accept') }, tr('Принять')),
        h('button', { disabled: busy, onclick: () => doReview(a, r, 'reject') }, tr('Отклонить')));
    }
    if (r.mode === 'manual' && !['queued', 'running'].includes(r.status)) {
      if (r.result) { acts.append(h('button', { onclick: () => { drafts['mode-' + a.id] = 'followup'; if (procSel[a.id] !== r.procId) procSel[a.id] = r.procId; rerender(); const t = document.querySelector('[data-draft="task-' + a.id + '"]'); if (t) t.focus(); } }, tr('Доработать'))); acts.append(h('button', { onclick: () => { teachRun = r.id; panel = 'messages'; panelSig = ''; renderPanelHead(); renderPanel(true); const t = document.querySelector('[data-draft="teach-note"]'); if (t) t.focus(); } }, tr('Научить'))); }
      const can = ['rejected', 'failed', 'interrupted', 'cancelled'].includes(r.status);
      if (can) acts.append(h('button', { disabled: busy, title: tr('Тот же ввод и текущая версия правил; это не новый случай и не новое свидетельство'), onclick: () => retry(a, r) }, tr('Повторить')));
    }
    if (acts.children.length) kids.push(acts);
    return h('div', { class: 'msg agent' }, kids);
  }
  function teachBox(box, a) {
    const r = a.runs.find((x) => x.id === teachRun); if (!teachRun || !r) return;
    const typeSel = h('select', { 'data-draft': 'teach-ctype', 'aria-label': tr('Тип проверки') }, h('option', { value: '' }, tr('— без проверки —')), Object.entries(S.checkTypes).map(([k, v]) => h('option', { value: k }, v)));
    typeSel.value = drafts['teach-ctype'] || ''; typeSel.addEventListener('change', () => { drafts['teach-ctype'] = typeSel.value; });
    if (drafts['teach-anchor'] === undefined) drafts['teach-anchor'] = true;
    box.append(h('div', { class: 'panel-box teach' }, h('h3', {}, tr('Научить: замечание к этому результату')),
      h('div', { class: 'hint' }, tr('К ответу: «') + (r.result || '').slice(0, 90).replace(/\s+/g, ' ') + '…»'),
      h('label', {}, tr('Что исправить — обычными словами'), field('textarea', 'teach-note', { rows: 3, maxlength: 2000, placeholder: tr('Например: всегда указывай одну главную цель и ограничения в конце') })),
      h('label', { class: 'mode-opt' }, h('input', { type: 'checkbox', checked: drafts['teach-anchor'] ? 'checked' : null, onchange: (e) => { drafts['teach-anchor'] = e.target.checked; } }), tr(' Привязать правило к этому ответу (нужно для «не пиши так», «это лишнее»)')),
      h('label', {}, tr('Фрагмент ответа, о котором речь (необязательно; иначе — начало ответа)'), field('input', 'teach-excerpt', { maxlength: 160, placeholder: tr('скопируйте фразу из ответа') })),
      h('div', { class: 'hint' }, tr('Замечание станет новой версией процесса (старая останется в истории). Модель не переобучается: правило добавляется в инструкцию. Модель при сохранении не вызывается. Править и удалять правила можно во вкладке «Развитие».')),
      h('label', {}, tr('Простая проверка (необязательно)'), typeSel, field('input', 'teach-cval', { maxlength: 200, placeholder: tr('фраза, заголовок раздела или число символов') })),
      h('div', { class: 'form-err', id: 'teach-err', role: 'alert' }),
      h('div', { class: 'row' }, h('button', { onclick: () => { teachRun = null; rerender(); } }, tr('Отмена')), h('button', { class: 'primary', disabled: busy, onclick: () => saveTeach(a, r) }, tr('Сохранить правило')))));
  }
  const NOTE_TASK = tr('Сделай краткую сводку по актуальным заметкам проекта: что нового, ключевые факты, риски и следующие шаги.');
  const ui = { srcOpen: {}, ruleEdit: {} };
  const radio = (name, value, label, on, cb) => h('label', { class: 'mode-opt' }, h('input', { type: 'radio', name, value, checked: on ? 'checked' : null, onchange: cb }), ' ' + label);
  const rerender = () => { panelSig = ''; renderPanel(true); };
  const allowanceLine = () => tr`Осталось вызовов модели: ${S.allowance.callsRemaining} из ${S.allowance.maxCalls} (оценка по прайс-листу $${S.allowance.usd.toFixed(2)} из $${S.allowance.maxUsd.toFixed(2)}; это не счёт — используется подписка).`;
  const isFollow = (a) => drafts['mode-' + a.id] === 'followup' && procOf(a).thread.canFollowup;

  function guidedCard(box, a) {
    const p = procOf(a); const runs = a.runs.filter((r) => r.procId === p.id && r.mode === 'manual');
    const live = runs.find((r) => ['queued', 'running'].includes(r.status)); const open = runs.find((r) => r.status === 'needs-review');
    const acc = p.evidence.distinct; const sched = p.schedules.find((s) => s.status === 'active');
    const steps = [tr('Задача'), tr('Ответ'), tr('Правила'), tr('Второй случай'), tr('Повторение')];
    let cur = 0, text = '', acts = [];
    const go = (panelName) => h('button', { class: 'primary', onclick: () => select('person', a.id, panelName) }, panelName === 'control' ? tr('Открыть «Контроль»') : panelName === 'plan' ? tr('Открыть «План»') : tr('Открыть «Развитие»'));
    if (live) { cur = 1; text = tr('Агент работает. Ответ появится в чате ниже.'); }
    else if (!runs.length) {
      cur = 0; text = tr('Выберите, с чего начать. «Сводка по заметкам» берёт актуальный файл заметок проекта; «Своя задача» — обычная постановка текстом.');
      acts = [h('button', { class: 'primary', onclick: () => { ui.srcOpen[a.id] = true; drafts['src-' + a.id] = true; drafts['mode-' + a.id] = 'new'; if (!drafts['task-' + a.id]) drafts['task-' + a.id] = NOTE_TASK; rerender(); } }, tr('Сводка по заметкам')),
        h('button', { onclick: () => { drafts['src-' + a.id] = false; drafts['mode-' + a.id] = 'new'; rerender(); const t = document.querySelector('[data-draft="task-' + a.id + '"]'); if (t) t.focus(); } }, tr('Своя задача'))];
    } else if (open) { cur = 1; text = tr('Проверьте ответ ниже: «Принять», «Отклонить», «Доработать» (например, «сделай короче») или «Научить» — поправить правила.'); }
    else if (acc < 1) { cur = 2; text = tr('Пока нет принятого ответа. Поправьте правила («Развитие») или «Повторить» отклонённый результат — повтор тот же случай, не новое свидетельство.'); acts = [go('growth')]; }
    else if (acc < 2) { cur = 3; text = tr`Принято случаев: ${acc} из 2. Теперь запустите другую задачу или другие данные как «Новую задачу» (доработка и повтор — тот же случай) и примите её.`; }
    else if (!p.activeGrant) { cur = 4; text = tr('Два разных случая приняты. Можно явно разрешить ограниченное повторение: только локальные черновики, конечное число раз.'); acts = [go('control')]; }
    else if (!sched) { cur = 4; text = tr('Право выдано. Создайте конечное расписание: «новая сводка по актуальным заметкам» или «повтор сохранённого задания».'); acts = [go('plan')]; }
    else { cur = 4; text = tr('Расписание идёт: каждый срок конечен, при неизменных заметках срок пропускается без вызова модели.'); acts = [go('plan')]; }
    box.append(h('section', { class: 'panel-box guide', 'aria-label': tr('Первая задача: следующий шаг') }, h('h3', {}, tr('Следующий шаг')),
      h('ol', { class: 'guide-steps' }, steps.map((s, i) => h('li', { class: i < cur ? 'done' : i === cur ? 'cur' : '', 'aria-current': i === cur ? 'step' : null }, s))),
      h('p', {}, text), acts.length ? h('div', { class: 'row' }, acts) : null,
      h('div', { class: 'hint' }, allowanceLine() + tr(' Это шаги по реальным случаям и разрешениям, а не оценка «компетентности» агента.'))));
  }

  function sourceBox(box, a) {
    const p = procOf(a); const src = p.source; const key = 'srctext-' + p.id;
    const err = h('div', { class: 'form-err', id: 'src-err', role: 'alert' });
    const save = async () => {
      const text = drafts[key] || ''; err.textContent = '';
      const r = await api('POST', `/api/agents/${a.id}/source`, { procId: p.id, text, filename: drafts['srcname-' + p.id] || undefined });
      if (!r.ok) { err.textContent = errText(r.json, r.status); return; }
      ui.srcOpen[a.id] = false; delete drafts[key]; setFlash(a, tr`Заметки сохранены: ревизия ${r.json.source.rev}. Версия процесса и права не менялись.`); await refresh(); rerender();
    };
    const load = async () => { const r = await api('GET', `/api/agents/${a.id}/source?procId=${p.id}`); if (!r.ok) { err.textContent = errText(r.json, r.status); return; } drafts[key] = r.json.source.text; rerender(); };
    const file = h('input', { type: 'file', accept: '.md,.txt,text/plain,text/markdown', 'aria-label': tr('Импортировать .md или .txt'), onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return; if (!/[.](md|txt)$/i.test(f.name)) { err.textContent = ERR.source_filetype; return; } if (f.size > S.limits.source * 3) { err.textContent = ERR.source_too_large; return; }
      drafts[key] = await f.text(); drafts['srcname-' + p.id] = f.name; rerender(); } });
    const d = h('details', { class: 'panel-box source-box', open: ui.srcOpen[a.id] || (!src && ui.srcOpen[a.id] !== false) ? 'open' : null },
      h('summary', {}, src ? tr`Заметки проекта · ревизия ${src.rev} · изменить` : tr('Заметки проекта (источник для сводки)')),
      h('details', { class: 'src-tech' }, h('summary', {}, tr('Технические детали')), h('div', { class: 'hint' }, tr('Один текстовый файл заметок на процесс. Содержимое — данные, а не инструкции для агента. Берётся заново при каждом запуске; в отчёте указана ревизия и время снимка. Лимит: ') + S.limits.source + tr(' байт, только текст (.md/.txt).')),
      src ? h('div', { class: 'hint mono' }, tr`Файл: data/${src.relPath} · ревизия ${src.rev} · ${src.hash} · можно править и снаружи (изменение станет новой ревизией)`) : null),
      h('label', {}, tr('Текст заметок'), field('textarea', key, { rows: 6, maxlength: 20000, placeholder: tr('Например: что изменилось в проекте, решения, риски…') })),
      h('label', {}, tr('Импорт из файла .md/.txt (не путь, а выбор файла)'), file), err,
      h('div', { class: 'row' }, src ? h('button', { onclick: load }, tr('Показать текущий файл')) : null, h('button', { class: 'primary', disabled: busy, onclick: save }, src ? tr('Сохранить новую ревизию') : tr('Создать заметки'))));
    d.addEventListener('toggle', () => { ui.srcOpen[a.id] = d.open; });
    box.append(d);
  }

  function composer(box, a) {
    const proc = procOf(a); const stop = S.allowance.halted || S.allowance.callsRemaining === 0; const follow = isFollow(a); const canF = proc.thread.canFollowup;
    const procSelEl = a.procs.length > 1 ? h('label', {}, tr('Процесс (в нём живут правила)'), (() => { const s = h('select', { 'aria-label': tr('Процесс'), onchange: (e) => { procSel[a.id] = e.target.value; rerender(); } }, a.procs.map((p) => h('option', { value: p.id }, `${p.name} · ${p.versions[p.current - 1].id}`))); s.value = proc.id; return s; })()) : null;
    const modeEl = canF ? h('div', { class: 'mode-switch', role: 'radiogroup', 'aria-label': tr('Тип сообщения') }, radio('mode-' + a.id, 'new', tr('Новая задача (новый случай)'), !follow, () => { drafts['mode-' + a.id] = 'new'; rerender(); }), radio('mode-' + a.id, 'followup', tr('Доработать предыдущий ответ'), follow, () => { drafts['mode-' + a.id] = 'followup'; rerender(); })) : null;
    const srcEl = !follow && proc.source ? h('label', { class: 'mode-opt' }, h('input', { type: 'checkbox', checked: drafts['src-' + a.id] ? 'checked' : null, onchange: (e) => { drafts['src-' + a.id] = e.target.checked; rerender(); } }), tr` Использовать заметки проекта (сейчас ревизия ${proc.source.rev}; файл читается заново при запуске)`) : null;
    box.append(h('div', { class: 'compose' }, procSelEl, modeEl,
      h('label', {}, follow ? tr`Что поправить в предыдущем ответе «${a.name}»` : tr`Задача для «${a.name}»`, field('textarea', 'task-' + a.id, { rows: 3, maxlength: 4000, placeholder: follow ? tr('Например: сделай короче') : tr('Что нужно сделать. Можно по-русски или по-английски.') })),
      srcEl,
      follow ? h('div', { class: 'hint' }, tr('Доработка опирается на предыдущий ответ этого агента и процесса. ') + trp(S.dialoguePolicy) + tr(' Это не новый случай и не новое свидетельство.')) : h('details', {}, h('summary', {}, tr('Вставить данные/контекст (текст)')), field('textarea', 'ctx-' + a.id, { rows: 4, maxlength: 12000, placeholder: tr('Вставьте сюда текст, цифры, переписку — агент увидит только это.') })),
      h('div', { class: 'hint' }, tr`Задача, данные и заметки отправляются в сервис Claude (процесс «${proc.name}», ${proc.versions[proc.current - 1].id}). Состояние хранится локально. У агента нет браузера, чтения файлов и отправки сообщений — результат это черновик.`),
      h('div', { class: 'form-err', id: 'task-err', role: 'alert' }, stop ? tr('Новые запуски недоступны: исчерпан лимит или остановка расхода.') : ''),
      h('div', { class: 'row' }, h('button', { class: 'primary', disabled: busy || stop, onclick: () => sendTask(a) }, follow ? tr('Отправить доработку') : tr('Отправить задачу')))));
  }
  function messagesPanel(box, a, rel) {
    if (!a) {
      box.append(h('p', { class: 'hint' }, tr('Обсуждения ведутся с конкретным агентом: выберите его в офисе или внизу в списке команды.')));
      if (!rel.length) { box.append(empty(tr('В этой комнате пока нет агентов.'), ctaCreate())); return; }
      for (const x of rel) { const last = x.chat[x.chat.length - 1]; box.append(h('article', { class: 'event' }, h('strong', {}, x.name + ' · ' + dept(roomOf(x)).name), h('p', {}, last ? clip(last.role === 'user' || last.role === 'agent' ? last.text : trp(last.text), 140) : tr('Переписки пока нет.')), h('button', { class: 'pill', onclick: () => select('person', x.id, 'messages') }, tr('Открыть чат')))); }
      return;
    }
    const chat = h('div', { class: 'chat', 'aria-live': 'polite', 'aria-label': tr('Переписка с агентом') });
    if (!a.chat.length) chat.append(h('div', { class: 'msg system' }, tr('Переписки пока нет. Напишите задачу ниже и, если нужно, вставьте данные. Реальный ответ появится только после вашей отправки.')));
    for (const m of a.chat) {
      const r = m.runId && a.runs.find((x) => x.id === m.runId);
      if (m.role === 'agent' && r) chat.append(runCard(a, m, r));
      else if (m.role === 'user') chat.append(h('div', { class: 'msg user' }, h('div', { class: 'meta' }, m.kind === 'feedback' ? tr('Ваше замечание') : m.kind === 'scheduled' ? tr`Расписание: задача повторяется (№${m.occurrence}, ${m.versionId})` : tr`Вы${m.versionId ? ' · ' + m.versionId : ''}${m.kind === 'followup' ? tr(' · доработка предыдущего ответа') : m.retry ? tr(' · повтор (тот же случай)') : m.newThread ? tr(' · новая задача') : ''}${m.usesSource ? tr(' · по заметкам') : ''}`), h('pre', {}, m.text), m.contextChars ? h('div', { class: 'meta' }, tr`+ данные: ${m.contextChars} симв.`) : null));
      else chat.append(h('div', { class: 'msg ' + (m.role === 'error' ? 'error' : 'system') }, friendly(m.text) || trp(m.text)));
    }
    const live = a.runs.find((r) => ['queued', 'running'].includes(r.status));
    if (live) chat.append(h('div', { class: 'msg system' }, live.status === 'running' ? tr('Агент выполняет задачу… ') : tr('Задача в очереди (общая очередь на все агенты). '), h('button', { onclick: () => api('POST', `/api/runs/${live.id}/cancel`, {}).then(refresh) }, tr('Отменить'))));
    guidedCard(box, a); box.append(chat); teachBox(box, a); sourceBox(box, a); composer(box, a);
  }
  async function sendTask(a, errEl) {
    const proc = procOf(a); const follow = isFollow(a);
    const task = drafts['task-' + a.id] || '', context = follow ? '' : (drafts['ctx-' + a.id] || '');
    const showErr = (t) => { const e = errEl || byId('task-err'); if (e) e.textContent = t; };
    if (!task.trim()) { showErr(ERR.task_required); return false; }
    const body = { task, context, procId: proc.id };
    if (follow) body.followup = true; else if (proc.source && drafts['src-' + a.id]) body.useSource = true;
    busy = true; rerender();
    const r = await api('POST', `/api/agents/${a.id}/tasks`, body);
    busy = false;
    if (!r.ok) { rerender(); showErr(errText(r.json, r.status)); return false; }
    drafts['task-' + a.id] = ''; drafts['ctx-' + a.id] = ''; drafts['mode-' + a.id] = 'new'; delete flash[a.id]; await refresh(); return true;
  }
  async function retry(a, r) {
    busy = true; rerender();
    const res = await api('POST', `/api/agents/${a.id}/tasks`, { task: r.task, procId: r.procId, retryOf: r.id });
    busy = false; panelSig = '';
    if (!res.ok) { setFlash(a, errText(res.json, res.status)); renderPanel(true); return; }
    delete flash[a.id]; await refresh();
  }
  async function doReview(a, r, decision) {
    busy = true; panelSig = ''; renderPanel(true);
    const res = await api('POST', `/api/runs/${r.id}/review`, { decision, note: '', ...rv() });
    busy = false; if (!res.ok) setFlash(a, errText(res.json, res.status)); else delete flash[a.id]; await refresh(); panelSig = ''; renderPanel(true);
  }
  async function saveTeach(a, r) {
    const note = (drafts['teach-note'] || '').trim(); if (!note) { byId('teach-err').textContent = ERR.note_required; return; }
    const ct = drafts['teach-ctype'] || '', cv = (drafts['teach-cval'] || '').trim();
    const body = { note, runId: r ? r.id : undefined, procId: r ? r.procId : procOf(a).id, anchor: !!(r && drafts['teach-anchor'] !== false), excerpt: (drafts['teach-excerpt'] || '').trim() || undefined, ...rv() };
    if (ct) body.checks = [{ type: ct, value: cv }];
    busy = true; panelSig = ''; renderPanel(true);
    const res = await api('POST', `/api/agents/${a.id}/feedback`, body); busy = false;
    if (!res.ok) { panelSig = ''; renderPanel(true); byId('teach-err').textContent = errText(res.json, res.status); return; }
    const v = res.json.version;
    drafts['teach-note'] = ''; drafts['teach-excerpt'] = ''; drafts['teach-cval'] = ''; drafts['teach-ctype'] = ''; teachRun = null;
    setFlash(a, tr`Сохранено как версия ${v.id}. Правила: ${v.rules.length}. Отклонённый ответ можно «Повторить» (тот же случай), правило видно во вкладке «Развитие». Делегирование и расписания по этому процессу сброшены.`);
    await refresh(); panelSig = ''; renderPanel(true);
  }

  function procPicker(a) {
    const p = procOf(a);
    const s = h('select', { 'aria-label': tr('Процесс'), onchange: (e) => { procSel[a.id] = e.target.value; panelSig = ''; renderPanel(true); } }, a.procs.map((x) => h('option', { value: x.id }, `${x.name} · ${x.versions[x.current - 1].id}`))); s.value = p.id; return s;
  }
  function sheetPanel(box, a) {
    if (!a) return;
    box.append(h('div', { class: 'panel-box' }, h('h3', {}, tr('Карточка агента')), h('div', { class: 'kv' }, h('span', {}, tr('Комната (только вид)')), h('b', {}, dept(roomOf(a)).name), h('span', {}, tr('Состояние')), h('b', {}, STATE_RU[a.state] || a.state), h('span', {}, tr('Создан')), h('b', {}, fmt(a.createdAt))),
      h('label', {}, tr('Показывать в комнате (не меняет задачи, версии и права)'), (() => { const s = h('select', { 'aria-label': tr('Комната'), onchange: (e) => { if (DEPT_ROOMS.includes(e.target.value)) { roomPrefs[a.id] = e.target.value; lsSet('bo.rooms', JSON.stringify(roomPrefs)); adapt(); render(); } } }, DEPT_ROOMS.map((r) => h('option', { value: r }, dept(r).name))); s.value = roomOf(a); return s; })())));
    box.append(h('div', { class: 'panel-box' }, h('h3', {}, tr('Процесс')), h('p', { class: 'hint' }, tr('Процесс — отдельная линия работы агента со своими правилами и своим делегированием. Чему научили один процесс, другой не знает.')), procPicker(a)));
    box.append(h('div', { class: 'panel-box' }, h('h3', {}, tr('Новый процесс')), h('label', {}, tr('Название'), field('input', 'newproc-' + a.id, { maxlength: 60, placeholder: tr('например, Письма клиентам') })), h('div', { class: 'form-err', id: 'proc-err', role: 'alert' }),
      h('div', { class: 'row' }, h('button', { disabled: busy, onclick: async () => { const r = await api('POST', `/api/agents/${a.id}/processes`, { name: drafts['newproc-' + a.id] || '' }); if (!r.ok) { byId('proc-err').textContent = errText(r.json, r.status); return; } drafts['newproc-' + a.id] = ''; procSel[a.id] = r.json.process.id; await refresh(); panelSig = ''; renderPanel(true); } }, tr('Создать процесс')))));
    const edit = h('div', { class: 'panel-box' }, h('h3', {}, tr('Роль и цель агента')),
      h('label', {}, tr('Роль'), field('textarea', 'er-' + a.id, { rows: 2, maxlength: 600 })), h('label', {}, tr('Цель'), field('textarea', 'eg-' + a.id, { rows: 2, maxlength: 600 })),
      h('div', { class: 'hint' }, tr('Изменение роли/цели создаёт новую версию каждого процесса, снимает делегирование и ставит расписания на паузу.')), h('div', { class: 'form-err', id: 'edit-err', role: 'alert' }),
      h('div', { class: 'row' }, h('button', { disabled: busy, onclick: async () => { const r = await api('POST', `/api/agents/${a.id}/update`, { role: drafts['er-' + a.id] ?? a.role, goal: drafts['eg-' + a.id] ?? a.goal }); if (!r.ok) { byId('edit-err').textContent = errText(r.json, r.status); return; } setFlash(a, tr('Роль/цель обновлены: новая версия процессов, делегирование снято.')); await refresh(); panelSig = ''; renderPanel(true); } }, tr('Сохранить роль/цель'))));
    const [er, eg] = edit.querySelectorAll('textarea'); if (drafts['er-' + a.id] === undefined) { drafts['er-' + a.id] = a.role; drafts['eg-' + a.id] = a.goal; er.value = a.role; eg.value = a.goal; }
    box.append(edit);
  }
  function reviewerBox(box) {
    const ms = h('select', { 'aria-label': tr('Кто принимает решения'), onchange: (e) => { rmode = e.target.value === 'agent' ? 'agent' : 'owner'; lsSet('bo.rmode', rmode); panelSig = ''; renderPanel(true); } }, h('option', { value: 'owner' }, tr('Владелец (вы)')), h('option', { value: 'agent' }, tr('Агент-ревьюер (автоматизация по делегированию, НЕ владелец)')));
    ms.value = rmode;
    box.append(h('div', { class: 'panel-box rmode' + (rmode === 'agent' ? ' agentmode' : '') }, h('label', {}, tr('Кто принимает решения (принять, научить, право, отзыв)'), ms), h('div', { class: 'hint' }, rmode === 'agent' ? tr('Включён режим агента-ревьюера: решения подписываются как «агент по делегированию», а не как владелец. Используйте для автоматизированной проверки.') : tr('Решения подписываются как владелец локальной сессии.'))));
  }
  function controlPanel(box, a, rel) {
    reviewerBox(box);
    const pend = rel.flatMap((x) => x.runs.filter((r) => r.status === 'needs-review').map((r) => [x, r]));
    box.append(h('h3', {}, tr('Ждут проверки')));
    if (!pend.length) box.append(empty(tr('Нет результатов, ожидающих вашего решения.')));
    for (const [x, r] of pend) box.append(runCard(x, { text: r.result }, r));
    if (!a) { if (!rel.length) box.append(ctaCreate()); return; }
    const p = procOf(a), v = p.versions[p.current - 1];
    box.append(h('div', { class: 'panel-box' }, h('h3', {}, tr('Повтор без вашего клика')), procPicker(a),
      h('p', { class: 'hint' }, tr`Нужно 2 принятых РАЗНЫХ случая этого процесса на ${v.id}. Сейчас: ${p.evidence.distinct}/2. Доработки, повторы, косметические правки того же текста и результаты расписания не считаются; это простая проверка, а не оценка компетентности. Право узкое: только локальные черновики, конечное число раз.`),
      h('p', {}, p.activeGrant ? h('span', { class: 'badge-s ok' }, tr`Право выдано: черновиков до ${p.activeGrant.maxRuns}, использовано ${p.activeGrant.used}`) : h('span', { class: 'badge-s warn' }, trp(p.grantReason)))));
    if (p.canGrant) {
      const n = h('select', { 'aria-label': tr('Сколько черновиков'), 'data-draft': 'grant-n' }, [1, 2, 3].map((k) => h('option', { value: k }, k))); n.value = drafts['grant-n'] || '1'; n.addEventListener('change', () => { drafts['grant-n'] = n.value; });
      box.append(h('div', { class: 'panel-box' }, h('h3', {}, tr('Выдать ограниченное право')), h('label', {}, tr('Максимум черновиков (создание локальных текстовых черновиков; без отправки наружу)'), n), h('div', { class: 'form-err', id: 'grant-err', role: 'alert' }),
        h('div', { class: 'row' }, h('button', { class: 'primary', disabled: busy, onclick: async () => { const r = await api('POST', `/api/agents/${a.id}/grant`, { procId: p.id, scope: S.grantScopeAgents, maxRuns: Number(n.value), ...rv() }); if (!r.ok) { byId('grant-err').textContent = errText(r.json, r.status); return; } await refresh(); } }, tr('Выдать право')))));
    }
    if (p.activeGrant) box.append(h('div', { class: 'panel-box' }, h('div', { class: 'form-err', id: 'rev-err', role: 'alert' }), h('div', { class: 'row' }, h('button', { class: 'danger', disabled: busy, onclick: async () => { const r = await api('POST', `/api/agents/${a.id}/grant/revoke`, { procId: p.id, ...rv() }); if (!r.ok) { byId('rev-err').textContent = errText(r.json, r.status); return; } await refresh(); } }, tr('Отозвать право')))));
  }
  function rulesEditor(box, a, p) {
    const v = p.versions[p.current - 1]; const baseChecks = v.checks.filter((c) => !c.base).map((c) => ({ type: c.type, value: c.value }));
    let ed = ui.ruleEdit[p.id]; if (!ed || ed.n !== v.n) ed = ui.ruleEdit[p.id] = { n: v.n, rules: [...v.rules], checks: baseChecks.map((c) => ({ ...c })) };
    const dirty = JSON.stringify([ed.rules, ed.checks]) !== JSON.stringify([v.rules, baseChecks]);
    const err = h('div', { class: 'form-err', id: 'rules-err', role: 'alert' });
    const lim = S.limits;
    const ruleRows = ed.rules.map((r, i) => { const t = h('textarea', { rows: 2, 'data-draft': `re-${p.id}-${i}`, 'aria-label': tr('Правило ') + (i + 1) }); t.value = r; t.addEventListener('input', () => { ed.rules[i] = t.value; }); return h('div', { class: 'rule-row' }, t, h('button', { class: 'danger', 'aria-label': tr('Убрать правило ') + (i + 1), onclick: () => { ed.rules.splice(i, 1); rerender(); } }, tr('Убрать'))); });
    const checkRows = ed.checks.map((c, i) => h('div', { class: 'rule-row' }, h('span', {}, `${S.checkTypes[c.type]}: «${c.value}»`), h('button', { class: 'danger', 'aria-label': tr('Убрать проверку ') + (i + 1), onclick: () => { ed.checks.splice(i, 1); rerender(); } }, tr('Убрать'))));
    const nt = h('select', { 'aria-label': tr('Тип новой проверки'), 'data-draft': 'nc-type' }, Object.entries(S.checkTypes).map(([k, lbl]) => h('option', { value: k }, lbl))); nt.value = drafts['nc-type'] || Object.keys(S.checkTypes)[0]; nt.addEventListener('change', () => { drafts['nc-type'] = nt.value; });
    const effChars = [...v.checks.filter((c) => c.base), ...ed.checks];
    box.append(h('section', { class: 'panel-box rules-editor', 'aria-label': tr('Правила процесса') }, h('h3', {}, tr`Что агент соблюдает сейчас (${v.id})`),
      h('div', { class: 'hint' }, tr`Правил: ${ed.rules.length} из ${lim.rules}; проверок: ${ed.checks.length} из ${lim.checks}. Любое сохранение создаёт новую версию, снимает право и ставит расписания на паузу. Старые версии остаются в истории. Модель при сохранении не вызывается.`),
      ed.rules.length ? ruleRows : h('div', { class: 'hint' }, tr('Правил пока нет.')),
      h('label', {}, tr('Добавить правило (самостоятельная фраза: что делать или чего не делать)'), field('textarea', 'newrule-' + p.id, { rows: 2, maxlength: 2000 })),
      h('div', { class: 'row' }, h('button', { onclick: () => { const t = (drafts['newrule-' + p.id] || '').trim(); if (!t) return; ed.rules.push(t); drafts['newrule-' + p.id] = ''; rerender(); } }, tr('Добавить в список'))),
      h('h3', {}, tr('Проверки текста')), ed.checks.length ? checkRows : h('div', { class: 'hint' }, tr('Дополнительных проверок нет (всегда действуют базовые: от 20 до 20000 символов).')),
      h('label', {}, tr('Добавить проверку'), nt, field('input', 'nc-val', { maxlength: 200, placeholder: tr('фраза, заголовок или число') })),
      h('div', { class: 'row' }, h('button', { onclick: () => { const val = (drafts['nc-val'] || '').trim(); if (!val) { err.textContent = ERR.check_value_required; return; } ed.checks.push({ type: nt.value, value: val }); drafts['nc-val'] = ''; rerender(); } }, tr('Добавить проверку'))),
      h('div', { class: 'preview', 'aria-live': 'polite' }, h('strong', {}, tr('Что получится: ')), tr`${ed.rules.filter((r) => r.trim()).length} правил, ${effChars.length} проверок (из них базовых ${effChars.filter((c) => c.base).length}). Агент получит этот список в инструкции; текст ответа проверяется механически, а не по смыслу.`),
      err, h('div', { class: 'row' }, h('button', { disabled: !dirty, onclick: () => { delete ui.ruleEdit[p.id]; rerender(); } }, tr('Сбросить правки')),
        h('button', { class: 'primary', disabled: !dirty || busy, onclick: async () => {
          const r = await api('POST', `/api/agents/${a.id}/rules`, { procId: p.id, rules: ed.rules.map((x) => x.trim()).filter(Boolean), checks: ed.checks, ...rv() });
          if (!r.ok) { err.textContent = errText(r.json, r.status); return; }
          delete ui.ruleEdit[p.id]; setFlash(a, tr`Сохранено как версия ${r.json.version.id}. Право на повторение снято, расписания на паузе — выдайте заново после новых принятых случаев.`); await refresh(); rerender(); } }, tr('Сохранить как новую версию')))));
  }
  function casesBox(box, a, p) {
    const ev = p.evidence; const v = p.versions[p.current - 1];
    box.append(h('section', { class: 'panel-box', 'aria-label': tr('Принятые случаи') }, h('h3', {}, tr`Принятые случаи на ${v.id}: ${ev.distinct} из 2`),
      ev.cases.length ? ev.cases.map((c) => h('div', { class: 'ver cur' }, h('strong', {}, clip(c.task, 90)), h('div', { class: 'hint' }, tr`${c.versionId} · принял: ${c.actor || '—'} · ${fmt(c.acceptedAt)}${c.source ? tr(' · заметки: ') + c.source : ''}${c.legacy ? tr(' · старая запись (до разделения случаев)') : ''}`),
        h('div', { class: 'hint' }, c.criteria.length ? tr('Критерии: ') + c.criteria.join('; ') : tr('Только базовая проверка длины.')))) : h('div', { class: 'hint' }, tr('На текущей версии пока нет принятых случаев (правка правил начинает набор заново).')),
      ev.merged.length ? h('div', { class: 'hint' }, tr`Не засчитано как отдельные: ${ev.merged.length} (доработка, повтор или то же самое с точностью до регистра/пробелов/пунктуации).`) : null,
      h('div', { class: 'hint' }, trp(ev.note))));
  }
  function growthPanel(box, a, rel) {
    if (!a) {
      box.append(h('p', { class: 'hint' }, tr('Развитие = версии процессов и правила, полученные из ваших замечаний.')));
      if (!rel.length) { box.append(empty(tr('Нет агентов — учить пока некого.'), ctaCreate())); return; }
      for (const x of rel) for (const p of x.procs) box.append(h('article', { class: 'review-card' }, h('h3', {}, `${x.name} · ${p.name}`), h('p', {}, tr`Версий: ${p.versions.length}, текущая ${p.versions[p.current - 1].id}, правил: ${p.versions[p.current - 1].rules.length}, принято случаев: ${p.evidence.distinct}`), h('button', { class: 'pill', onclick: () => select('person', x.id, 'growth') }, tr('Открыть'))));
      return;
    }
    const last = [...a.runs].reverse().find((r) => r.mode === 'manual' && !['queued', 'running'].includes(r.status) && r.result);
    guidedCard(box, a);
    const p = procOf(a); box.append(procPicker(a));
    if (!teachRun && last) box.append(h('div', { class: 'panel-box' }, h('h3', {}, tr('Обучение по результату')), h('p', { class: 'hint' }, tr('Замечание к последнему результату станет правилом (с привязкой к ответу).')), h('button', { class: 'primary', onclick: () => { teachRun = last.id; rerender(); } }, tr('Научить по последнему результату'))));
    teachBox(box, a); rulesEditor(box, a, p); casesBox(box, a, p);
    box.append(h('h3', {}, tr('История версий (неизменяемая)')));
    for (const v of [...p.versions].reverse()) box.append(h('div', { class: 'ver' + (v.n === p.current ? ' cur' : '') }, h('strong', {}, `${v.id}${v.n === p.current ? tr(' (текущая)') : ''}`), ` · ${fmt(v.createdAt)} · `, h('span', { class: 'mono' }, v.hash),
      h('div', {}, tr(v.note)), v.changes ? h('div', { class: 'hint' }, tr`+${v.changes.addedRules.length}/−${v.changes.removedRules.length} правил, +${v.changes.addedChecks.length}/−${v.changes.removedChecks.length} проверок`) : null, v.rules.length ? h('ul', {}, v.rules.map((r) => h('li', {}, r))) : h('div', { class: 'hint' }, tr('Правил пока нет.')), v.checks.filter((c) => !c.base).length ? h('div', { class: 'hint' }, tr('Проверки: ') + v.checks.filter((c) => !c.base).map((c) => `${S.checkTypes[c.type]} «${c.value}»`).join('; ')) : null));
    box.append(h('details', { class: 'panel-box' }, h('summary', {}, tr('Технические детали')), h('div', { class: 'hint' }, tr`Процесс ${p.id} · ${p.versions[p.current - 1].id} · хэш ${p.versions[p.current - 1].hash} · модель ${p.versions[p.current - 1].model}`), (S.provenance || []).length ? h('div', { class: 'hint' }, tr('Поправки провенанса (append-only): ') + S.provenance.map((x) => `${x.kind} ${x.targetId} → ${x.effectiveActor}`).join('; ')) : null, a.runs.filter((r) => r.procId === p.id).map((r) => h('div', { class: 'mono' }, tr`${r.id} ${r.versionId} ${r.mode}/${r.taskMode} ${r.status} случай:${r.caseId} поп.${r.attempt} вход:${r.inputHash} промпт:${(r.promptSha || '—').slice(0, 12)}`))));
  }
  function charterPanel(box, a, rel) {
    box.append(h('p', { class: 'hint' }, tr('Устав здесь — это реальные роль, цель и текущие правила процессов агента. Политик отделов, выдуманных регламентов и прав доступа вне выданных вами нет.')));
    if (!rel.length) { box.append(empty(tr('В этой комнате нет агентов — устава нет.'), ctaCreate())); return; }
    for (const x of rel) { box.append(h('article', { class: 'review-card' }, h('h3', {}, x.name), h('p', {}, tr('Роль: ') + x.role), h('p', {}, tr('Цель: ') + (x.goal || '—')), x.procs.map((p) => { const v = p.versions[p.current - 1]; return h('div', { class: 'ver cur' }, h('strong', {}, `${p.name} · ${v.id}`), v.rules.length ? h('ul', {}, v.rules.map((r) => h('li', {}, r))) : h('div', { class: 'hint' }, tr('Правил пока нет.'))); }))); if (a) break; }
  }
  function activityPanel(box, a, rel) {
    box.append(h('p', { class: 'hint' }, tr('Наблюдаемые события из сохранённого состояния: задачи, решения, новые версии. Ничего не симулируется.')));
    const ids = new Set(rel.map((x) => x.id)); const ev = state.activity.filter((e) => ids.has(e.actor));
    if (!ev.length) { box.append(empty(tr('Событий пока нет. Здесь появятся только сохранённые действия.'))); return; }
    for (const e of ev.slice(0, 50)) box.append(h('article', { class: 'event' }, h('time', {}, hm(e.created) + tr(' МСК · ') + fmt(e.created)), h('strong', {}, e.title), h('p', {}, e.detail), e.task_id ? h('button', { class: 'pill', onclick: () => { const o = S.agents.find((x) => x.id === e.actor); if (o) select('person', o.id, 'messages'); } }, tr('Открыть чат')) : null));
  }
  function scheduleCards(box, x, p) {
    for (const s of p.schedules) {
      const runs = x.runs.filter((r) => r.scheduleId === s.id), acts = h('div', { class: 'acts' });
      if (s.status === 'active') acts.append(h('button', { onclick: () => sact(x, s, 'pause') }, tr('Пауза')));
      if (s.phase === 'draining') acts.append(h('button', { class: 'danger', onclick: () => sact(x, s, 'cancel') }, tr('Остановить последний запуск')));
      if (s.status === 'paused' && !s.stale) acts.append(h('button', { class: 'primary', onclick: () => sact(x, s, 'resume') }, tr('Возобновить (без догоняющих запусков)')));
      if (s.status === 'paused' && s.stale) acts.append(h('button', { class: 'primary', disabled: !p.activeGrant, title: p.activeGrant ? '' : tr('Сначала выдайте право заново («Контроль»)'), onclick: () => sact(x, s, 'recreate') }, tr('Создать заново')));
      if (['active', 'paused'].includes(s.status)) acts.append(h('button', { class: 'danger', onclick: () => sact(x, s, 'cancel') }, tr('Отменить')));
      const kind = s.mode === 'fresh_summary' ? tr('новая сводка по актуальным заметкам') : tr('повтор сохранённого задания');
      box.append(h('div', { class: 'panel-box' }, h('strong', {}, `${x.name} · ${p.name} · ${kind} · ${SCH_RU[s.phase] || SCH_RU[s.status]}`), h('div', {}, tr`Каждые ${s.intervalMin} мин · сроков не наступило: ${s.remaining} из ${s.total}${s.skipped ? tr` · пропущено без вызова (заметки не менялись): ${s.skipped}` : ''}${s.phase === 'draining' ? tr(' · новых стартов не будет') : ''}`),
        s.nextAt ? h('div', {}, tr('Следующий срок: '), fmt(s.nextAt), ' (', h('span', { 'data-countdown': s.nextAt }, ''), ')') : null, s.pauseReason ? h('div', { class: 'checks no' }, tr('Причина паузы: ') + trp(s.pauseReason)) : null,
        s.status === 'paused' && s.stale ? h('div', { class: 'hint' }, tr('Право или версия изменились: это расписание не возобновляется само. «Создать заново» откроет новое (при выданном праве), а это останется в истории.')) : null,
        s.replacedBy ? h('div', { class: 'hint' }, tr('Заменено новым расписанием; запись оставлена для аудита.')) : null,
        h('div', { class: 'hint' }, tr('Задача: «') + s.task.slice(0, 80) + '»' + (s.mode === 'fresh_summary' ? tr(' — сводка по заметкам на момент срока') : '')),
        runs.map((r) => h('div', { class: 'hint' }, tr`Запуск №${r.occurrence}: ${(STATUS[r.status] || [r.status])[0]} · ${fmt(r.finishedAt || r.createdAt)}${r.sourceSnapshot ? tr` · заметки: ревизия ${r.sourceSnapshot.rev == null ? '?' : r.sourceSnapshot.rev}` : ''}${r.error ? ' · ' + r.error : ''}`)), acts));
    }
  }
  function planPanel(box, a, rel) {
    box.append(h('p', { class: 'hint' }, tr('Конечные повторы: только пока включены этот ПК и сервер, без бесконечных циклов. Каждый запуск тратит реальный вызов из общего лимита; пропущенный срок — нет.')));
    if (!a) {
      const any = rel.flatMap((x) => x.procs.flatMap((p) => p.schedules.map((s) => [x, p, s])));
      if (!any.length) box.append(empty(rel.length ? tr('Расписаний нет. Откройте агента → «План», чтобы создать конечный повтор (нужно выданное право).') : tr('В этой комнате нет агентов — планировать нечего.')));
      for (const x of rel) for (const p of x.procs) scheduleCards(box, x, p);
      if (!rel.length) box.append(ctaCreate());
      return;
    }
    const p = procOf(a), v = p.versions[p.current - 1]; box.append(procPicker(a));
    if (p.activeGrant) {
      const accepted = a.runs.filter((r) => r.procId === p.id && r.status === 'accepted' && r.mode === 'manual' && r.versionId === v.id);
      const src = h('select', { 'aria-label': tr('Исходная задача'), 'data-draft': 'sch-src' }, accepted.map((r) => h('option', { value: r.id }, `«${r.task.slice(0, 40)}»${r.usesSource ? tr(' (заметки)') : ''} (${fmt(r.createdAt)})`))); src.value = drafts['sch-src'] || (accepted[0] && accepted[0].id) || ''; src.addEventListener('change', () => { drafts['sch-src'] = src.value; rerender(); });
      const srcRun = accepted.find((r) => r.id === src.value) || accepted[0];
      const canFresh = !!(p.source && srcRun && srcRun.usesSource);
      if (!canFresh && drafts['sch-mode'] === 'fresh_summary') drafts['sch-mode'] = 'repeat';
      const md = h('select', { 'aria-label': tr('Что делать в срок'), 'data-draft': 'sch-mode' }, h('option', { value: 'repeat' }, tr('Повтор сохранённого задания (те же данные и снимок заметок)')), canFresh ? h('option', { value: 'fresh_summary' }, tr('Новая сводка по актуальным заметкам')) : null); md.value = drafts['sch-mode'] || 'repeat'; md.addEventListener('change', () => { drafts['sch-mode'] = md.value; rerender(); });
      const iv = h('select', { 'aria-label': tr('Интервал'), 'data-draft': 'sch-iv' }, S.intervals.map((m) => h('option', { value: m }, m === 1 ? tr('каждую 1 минуту (для проверки)') : m < 60 ? tr`каждые ${m} минут` : m === 60 ? tr('каждый час') : tr('каждые сутки')))); iv.value = drafts['sch-iv'] || '1'; iv.addEventListener('change', () => { drafts['sch-iv'] = iv.value; });
      const cn = h('select', { 'aria-label': tr('Сроков'), 'data-draft': 'sch-n' }, [1, 2, 3].map((k) => h('option', { value: k }, k))); cn.value = drafts['sch-n'] || '1'; cn.addEventListener('change', () => { drafts['sch-n'] = cn.value; });
      const has = p.schedules.some((s) => s.status === 'active' || (s.status === 'paused' && !s.stale));
      const staleN = p.schedules.filter((s) => s.status === 'paused' && s.stale).length;
      box.append(h('div', { class: 'panel-box' }, h('h3', {}, tr('Расписание (конечное)')), h('label', {}, tr('Исходный принятый случай (его задача станет основой; «сделай короче» и другие доработки в расписание не попадают)'), src), h('label', {}, tr('Что делать в срок'), md),
        md.value === 'fresh_summary' ? h('div', { class: 'hint' }, tr`Каждый срок берёт файл заметок заново и пишет сводку с указанием ревизии. Если заметки не менялись с прошлой успешной сводки — срок пропускается без вызова модели и не тратит право. Сроков конечное число (до ${cn.value || 1}).`) : h('div', { class: 'hint' }, tr('Повторяет то же задание на тех же данных (для заметок — на сохранённом снимке).')),
        h('label', {}, tr('Интервал'), iv), h('label', {}, tr('Сроков (1–3)'), cn),
        staleN ? h('div', { class: 'hint' }, tr`Прежних остановленных расписаний: ${staleN}. При создании нового они закроются как запись аудита (сами не возобновятся).`) : null,
        h('div', { class: 'form-err', id: 'sch-err', role: 'alert' }, has ? tr('У процесса уже есть активное или возобновляемое расписание — отмените его, чтобы создать новое.') : ''),
        h('div', { class: 'row' }, h('button', { class: 'danger', disabled: busy, onclick: async () => { const r = await api('POST', `/api/agents/${a.id}/grant/revoke`, { procId: p.id, ...rv() }); if (!r.ok) { byId('sch-err').textContent = errText(r.json, r.status); return; } await refresh(); } }, tr('Отозвать право')),
          h('button', { class: 'primary', disabled: busy || has || !accepted.length, onclick: async () => { const r = await api('POST', `/api/agents/${a.id}/schedules`, { procId: p.id, sourceRunId: src.value, intervalMin: Number(iv.value), count: Number(cn.value), mode: md.value, ...rv() }); if (!r.ok) { byId('sch-err').textContent = errText(r.json, r.status); return; } await refresh(); } }, tr('Запустить расписание')))));
    } else box.append(h('div', { class: 'panel-box' }, h('span', { class: 'badge-s warn' }, trp(p.grantReason)), h('div', { class: 'hint' }, tr('Право выдаётся на вкладке «Контроль». После отзыва и новой выдачи прежние расписания сами не оживают — создайте новое или «Создать заново».'))));
    for (const q of a.procs) scheduleCards(box, a, q);
  }
  async function sact(a, s, act) { const r = await api('POST', `/api/schedules/${s.id}/${act}`, {}); if (!r.ok) setFlash(a, errText(r.json, r.status)); await refresh(); panelSig = ''; renderPanel(true); }

  // ---------- modals ----------
  function modal(title, ...nodes) { byId('modalTitle').textContent = title; byId('modalBody').replaceChildren(...nodes); byId('modalError').textContent = ''; if (!byId('modal').open) byId('modal').showModal(); }
  byId('closeModal').onclick = () => byId('modal').close();
  function openCreate() {
    const choices = h('div', { class: 'avatar-choices', role: 'radiogroup', 'aria-label': tr('Образ') });
    S.avatars.forEach((k, i) => choices.append(h('label', { class: 'av-opt', title: LABELS[k] || k }, h('input', { type: 'radio', name: 'avatar', value: k, checked: i === 0 ? 'checked' : null, 'aria-label': tr('Образ ') + (LABELS[k] || k) }), h('img', { src: '/assets/bay/' + k + '.webp', alt: '' }), h('em', {}, LABELS[k] || k))));
    const f = h('form', { class: 'dlg-form', autocomplete: 'off', id: 'form-agent' },
      h('label', {}, tr('Имя'), h('input', { name: 'name', maxlength: 60, required: true, placeholder: tr('например, Редактор брифов') })),
      h('label', {}, tr('Роль — чем занимается'), h('textarea', { name: 'role', rows: 3, maxlength: 600, required: true, placeholder: tr('Пишет краткие брифы и черновики по тексту, который я дам') })),
      h('label', {}, tr('Цель (необязательно)'), h('textarea', { name: 'goal', rows: 2, maxlength: 600, placeholder: tr('Что считается хорошим результатом') })), choices,
      h('p', { class: 'hint' }, tr('Агент работает только с текстом: задача и вставленные вами данные отправляются в сервис Claude. У него нет браузера, чтения файлов и отправки сообщений.')),
      h('div', { class: 'row' }, h('button', { type: 'button', id: 'preset-notes', onclick: () => { f.elements.name.value = PRESET.name; f.elements.role.value = PRESET.role; f.elements.goal.value = PRESET.goal; } }, L('Use: Project Notes Reporter', 'Взять: Репортёр по заметкам'))),
      h('p', { class: 'form-err', id: 'agent-err', role: 'alert' }), h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => byId('modal').close() }, tr('Отмена')), h('button', { class: 'primary', type: 'submit' }, tr('Создать'))));
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); const body = { name: f.elements.name.value, role: f.elements.role.value, goal: f.elements.goal.value, lang: window.BAY_LANG, avatar: (f.querySelector('input[name=avatar]:checked') || {}).value };
      const r = await api('POST', '/api/agents', body); if (!r.ok) { byId('agent-err').textContent = errText(r.json, r.status); return; }
      byId('modal').close(); await refresh(); select('person', r.json.agent.id, 'messages');
    });
    modal(tr('Новый агент'), f); f.elements.name.focus();
  }
  function openTask() {
    if (!S.agents.length) { modal(tr('Новая задача'), h('p', {}, tr('Сначала нужен агент.')), ctaCreate()); return; }
    const cur = curAgent() || S.agents[0]; let ag = cur; const holder = h('div', {});
    const draw = () => { holder.replaceChildren(); const pr = procOf(ag);
      const ps = h('select', { 'aria-label': tr('Процесс'), onchange: (e) => { procSel[ag.id] = e.target.value; draw(); } }, ag.procs.map((p) => h('option', { value: p.id }, `${p.name} · ${p.versions[p.current - 1].id}`))); ps.value = pr.id;
      const err = h('p', { class: 'form-err', role: 'alert' });
      holder.append(h('label', {}, tr('Процесс'), ps), h('label', {}, tr('Задача'), field('textarea', 'task-' + ag.id, { rows: 4, maxlength: 4000, placeholder: tr('Что нужно сделать') })), h('label', {}, tr('Данные/контекст (необязательно)'), field('textarea', 'ctx-' + ag.id, { rows: 4, maxlength: 12000 })),
        h('p', { class: 'hint' }, tr('Задача и данные отправляются в сервис Claude; результат — черновик, сам агент ничего не отправляет и не читает файлы.')), err,
        h('div', { class: 'row' }, h('button', { type: 'button', onclick: () => byId('modal').close() }, tr('Отмена')), h('button', { class: 'primary', disabled: S.allowance.halted || S.allowance.callsRemaining === 0, onclick: async () => { if (await sendTask(ag, err)) { byId('modal').close(); select('person', ag.id, 'messages'); } } }, tr('Отправить задачу'))));
    };
    const as = h('select', { 'aria-label': tr('Агент'), onchange: (e) => { ag = agentById(e.target.value) || ag; draw(); } }, S.agents.map((x) => h('option', { value: x.id }, x.name))); as.value = ag.id;
    modal(tr('Новая задача'), h('label', {}, tr('Агент'), as), holder); draw();
  }
  function modelInfo() {
    const al = S.allowance; const models = [...new Set(S.agents.flatMap((a) => a.procs.map((p) => p.versions[p.current - 1].model)))];
    modal(tr('Модель и лимиты'), h('div', { class: 'kv' }, h('span', {}, tr('Режим')), h('b', {}, S.mode === 'LIVE-LOCAL' ? tr('Реальный Claude') : tr('ТЕСТОВАЯ ЗАГЛУШКА')), h('span', {}, tr('Провайдер')), h('b', {}, S.providerName), h('span', {}, tr('Модель текущих версий')), h('b', {}, models.join(', ') || '—'), h('span', {}, tr('Вызовов использовано')), h('b', {}, tr`${al.callsUsed} из ${al.maxCalls}`), h('span', {}, tr('Осталось вызовов')), h('b', {}, String(al.callsRemaining)), h('span', {}, tr('Оценка по прайс-листу')), h('b', {}, tr`$${al.usd.toFixed(4)} из $${al.maxUsd.toFixed(2)}`)),
      h('p', { class: 'hint' }, tr`Это оценка, не счёт: используется подписка. До $${al.perCallUsd} и ${al.timeoutMs / 1000} с на вызов. Страница и опрос состояния никогда не вызывают модель. Задача и вставленный текст отправляются в сервис Claude; состояние офиса хранится локально.`),
      h('p', { class: 'hint' }, tr`Режим: ${S.mode} · схема ${S.schema} · инструменты модели отключены, привязка к 127.0.0.1, проверки Host/Origin/CSRF.`), h('p', {}, h('a', { href: '/legacy.html' }, tr('Прошлая итерация (GitHub-бриф, архив)'))));
  }
  function founder() {
    const al = S.allowance, runs = S.agents.flatMap((a) => a.runs), by = (st) => runs.filter((r) => r.status === st).length;
    const sch = S.agents.flatMap((a) => a.procs.flatMap((p) => p.schedules.map((s) => [a, s])));
    const pend = runs.filter((r) => r.status === 'needs-review');
    modal(tr('Режим основателя'), h('p', { class: 'hint' }, tr('Реальные итоги из локального состояния. Ничего не выдумано: метрик внедрения и подключений здесь нет.')),
      h('div', { class: 'kv' }, h('span', {}, tr('Агентов')), h('b', {}, String(S.agents.length)), h('span', {}, tr('Запусков всего')), h('b', {}, String(runs.length)), h('span', {}, tr('Принято')), h('b', {}, String(by('accepted'))), h('span', {}, tr('Ждут проверки')), h('b', {}, String(pend.length)), h('span', {}, tr('Ошибки/прервано/отклонено')), h('b', {}, String(by('failed') + by('interrupted') + by('rejected'))), h('span', {}, tr('Активных расписаний')), h('b', {}, String(sch.filter(([, s]) => s.status === 'active').length)), h('span', {}, tr('Расписаний на паузе')), h('b', {}, String(sch.filter(([, s]) => s.status === 'paused').length)), h('span', {}, tr('Вызовов')), h('b', {}, tr`${al.callsUsed} из ${al.maxCalls} (осталось ${al.callsRemaining})`), h('span', {}, tr('Остановка расхода')), h('b', {}, al.halted ? tr('да: ') + (al.haltReason || '') : tr('нет'))),
      h('h3', {}, tr('Требует внимания')), pend.length ? pend.map((r) => { const a = S.agents.find((x) => x.runs.includes(r)); return h('div', { class: 'schedule-row' }, h('time', {}, hm(r.createdAt)), h('div', {}, `${a.name}: ${clip(r.task, 70)}`, h('small', {}, h('button', { onclick: () => { byId('modal').close(); select('person', a.id, 'control'); } }, tr('Открыть проверку'))))); }) : h('p', { class: 'hint' }, tr('Ничего не ждёт вашего решения.')),
      h('h3', {}, tr('Интеграции')), h('p', { class: 'hint' }, tr('Календарь, почта, мессенджеры и другие внешние подключения не настроены — этих возможностей у агентов нет.')));
  }
  const LABELS = { teia: tr('Тея'), mark: tr('Марк'), atlas: tr('Атлас'), nora: tr('Нора') };

  function tickCountdown() { document.querySelectorAll('[data-countdown]').forEach((e) => { const s = Math.round((Date.parse(e.dataset.countdown) - Date.now()) / 1000); e.textContent = s > 0 ? tr`через ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : tr('сейчас'); }); }
  setInterval(tickCountdown, 1000);
  function clock() { byId('clock').textContent = new Date().toLocaleTimeString(LOC, TZ ? { hour: '2-digit', minute: '2-digit', timeZone: TZ } : { hour: '2-digit', minute: '2-digit' }); }
  setInterval(clock, 1000); clock();

  // ---------- wiring ----------
  byId('world').onclick = (e) => { const hot = e.target.closest('[data-hot]'), p = e.target.closest('[data-person]'), r = e.target.closest('[data-room]'); if (!S) return; if (hot) select('room', hot.dataset.room, hot.dataset.hot); else if (p) select('person', p.dataset.person); else if (r) select('room', r.dataset.room); };
  byId('world').onkeydown = (e) => { if (['Enter', ' '].includes(e.key)) { const t = e.target.closest('[data-hot],[data-person],[data-room]'); if (t && S) { e.preventDefault(); if (t.dataset.hot) select('room', t.dataset.room, t.dataset.hot); else select(t.dataset.person ? 'person' : 'room', t.dataset.person || t.dataset.room); } } };
  byId('departmentTabs').onclick = (e) => { const b = e.target.closest('[data-room]'); if (b && S) select('room', b.dataset.room); };
  byId('peopleDock').onclick = (e) => { const b = e.target.closest('[data-person]'); if (b && S) select('person', b.dataset.person); };
  document.querySelectorAll('[data-panel]').forEach((b) => { b.onclick = () => setPanel(b.dataset.panel); });
  document.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => { if (!S) return; document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('active', x === b)); const v = b.dataset.view; if (v === 'office') select('room', 'commons'); else if (v === 'review') select('room', 'review', 'growth'); else { selection = { type: 'room', id: 'commons' }; panel = v === 'board' ? 'queue' : v; render(); if (!panelOpen) setPanelOpen(true); } }; });
  byId('refresh').onclick = refresh; byId('btn-new-agent').onclick = () => S && openCreate(); byId('newTask').onclick = () => S && openTask(); byId('aboutModel').onclick = () => S && modelInfo(); byId('godMode').onclick = () => S && founder();
  byId('panelToggle').onclick = () => setPanelOpen(!panelOpen); byId('panelClose').onclick = () => setPanelOpen(false);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.matches('[data-draft^="task-"]')) { const a = agentById(e.target.dataset.draft.slice(5)); if (a) sendTask(a); } });
  // ===== alpha additions: language toggle, guide/setup/export, presets, friendly provider errors =====
  const L = (en, ru) => (window.BAY_LANG === 'ru' ? ru : en);
  const RUN_ERR = {
    auth_not_claude_ai: L('Claude Code is not signed in with a Claude subscription account, so no model call was made. Open the “?” guide → “Check connection”.', 'Claude Code не авторизован через подписку Claude, поэтому вызов модели не выполнялся. Откройте «?» → «Проверить подключение».'),
    spawn_failed: L('Claude Code could not be started on this computer (is it installed?). No call was made. Open the “?” guide → “Check connection”.', 'Не удалось запустить Claude Code на этом компьютере (установлен ли он?). Вызов не выполнялся. Откройте «?» → «Проверить подключение».'),
    timeout: L('The model did not answer in time. It was stopped and NOT retried automatically; you can retry it yourself.', 'Модель не ответила вовремя. Запуск остановлен и автоматически НЕ повторяется; повторить можно вручную.'),
    rate_limited: L('Claude reported a usage/rate limit for your account. Wait for it to reset, then retry. Nothing was retried automatically.', 'Claude сообщил о лимите использования вашего аккаунта. Дождитесь сброса и повторите вручную. Автоповторов не было.'),
    cli_error: L('Claude Code returned an error. Nothing was retried automatically; run “Check connection” in the “?” guide.', 'Claude Code вернул ошибку. Автоповторов не было; запустите «Проверить подключение» в «?».'),
    unparseable_cli_output: L('Claude Code returned an unreadable answer. Nothing was retried automatically.', 'Claude Code вернул нечитаемый ответ. Автоповторов не было.'),
  };
  function friendly(text) { const m = /^(?:Ошибка выполнения|Запуск остановлен до вызова модели): ?([a-z_]+)/.exec(String(text || '')); return m && RUN_ERR[m[1]] ? RUN_ERR[m[1]] : null; }
  function setupLine(s) {
    if (!s || s.cli === 'unchecked') return [L('Not checked yet. Press “Check connection”. Checking does not call the model.', 'Ещё не проверялось. Нажмите «Проверить подключение». Проверка не вызывает модель.'), 'warn'];
    if (s.cli === 'missing') return [L('Claude Code is not installed. Install the official Claude Code (https://code.claude.com/docs/en/quickstart), open a NEW terminal, run “claude” once to sign in with YOUR OWN Claude account, then press Check again.', 'Claude Code не установлен. Установите официальный Claude Code (https://code.claude.com/docs/en/quickstart), откройте НОВЫЙ терминал, один раз запустите «claude» и войдите СВОИМ аккаунтом Claude, затем нажмите «Проверить».'), 'bad'];
    if (s.cli !== 'found') return [L('Claude Code could not be run. Reinstall it from the official page.', 'Claude Code не запускается. Переустановите его с официальной страницы.'), 'bad'];
    if (s.auth === 'signed_in') return [L('Claude Code found (v' + (s.version || '?') + ') and signed in with a Claude subscription account. Ready.', 'Claude Code найден (v' + (s.version || '?') + '), вход через подписку Claude выполнен. Готово.'), 'ok'];
    if (s.auth === 'not_signed_in') return [L('Claude Code is installed but not signed in. In a terminal run “claude” and finish the browser sign-in with your own account, then press Check again.', 'Claude Code установлен, но вход не выполнен. В терминале запустите «claude», завершите вход в браузере своим аккаунтом и нажмите «Проверить».'), 'bad'];
    if (s.auth === 'unsupported_method') return [L('Claude Code is signed in with a method this alpha was not tested with (only claude.ai subscription sign-in is supported). Run “claude auth login” and choose the Claude subscription account.', 'Claude Code авторизован способом, с которым альфа не тестировалась (поддерживается только вход через подписку claude.ai). Выполните «claude auth login» и выберите подписку Claude.'), 'bad'];
    return [L('Could not read the sign-in status. Run “claude auth status” in a terminal.', 'Не удалось прочитать статус входа. Выполните «claude auth status» в терминале.'), 'bad'];
  }
  async function openGuide() {
    try { localStorage.setItem('bo.guideSeen', '1'); } catch { /* ignore */ }
    const status = h('p', { class: 'badge-s warn', id: 'setup-line', role: 'status' }, '…');
    const paint = (s) => { const [t, k] = setupLine(s); status.textContent = t; status.className = 'badge-s ' + k; };
    const r0 = await api('GET', '/api/setup'); paint(r0.ok ? r0.json : null);
    const chk = h('button', { class: 'primary', type: 'button', id: 'setup-check', onclick: async () => { chk.disabled = true; status.textContent = L('Checking… (no model call)', 'Проверяем… (без вызова модели)'); const r = await api('POST', '/api/setup/check', {}); paint(r.ok ? r.json : null); chk.disabled = false; } }, L('Check connection', 'Проверить подключение'));
    const al = S ? S.allowance : null;
    const steps = [
      L('Create an agent (use “Project Notes Reporter”, or describe your own).', 'Создайте агента («Репортёр по заметкам» или свой).'),
      L('Add notes: paste text or import a .md/.txt file in the agent’s panel.', 'Добавьте заметки: вставьте текст или импортируйте .md/.txt в панели агента.'),
      L('Send a real task, read the answer, ask a follow-up (“make it shorter”) if you want.', 'Отправьте реальную задачу, прочитайте ответ, при желании уточните («сделай короче»).'),
      L('Teach: write a rule (“Growth” tab or “Teach” on a result). The rule is added to the agent’s instruction.', 'Научите: запишите правило (вкладка «Развитие» или «Научить» у ответа). Правило добавляется в инструкцию агента.'),
      L('Review two real, different cases (new data, new task) and accept them.', 'Проверьте два реальных разных случая (новые данные, новая задача) и примите их.'),
      L('Only then permit bounded repeats (“Control”, then “Plan”): finite, local drafts only.', 'Только после этого разрешите ограниченные повторы («Контроль», затем «План»): конечно, только локальные черновики.')];
    modal(L('Getting started', 'Начало работы'),
      h('div', { class: 'panel-box' }, h('strong', {}, L('1. Connect your own Claude account', '1. Подключите свой аккаунт Claude')),
        h('p', { class: 'hint' }, L('Bay Office uses the official Claude Code installed on THIS computer and signed in with YOUR account. It never asks for or stores your password or token, and nothing is sent to anyone but Claude.', 'Bay Office использует официальный Claude Code, установленный на ЭТОМ компьютере и авторизованный ВАШИМ аккаунтом. Пароль и токен не запрашиваются и не хранятся; данные уходят только в Claude.')), status, h('div', { class: 'row' }, chk)),
      h('div', { class: 'panel-box' }, h('strong', {}, L('2. Try it in six steps', '2. Попробуйте за шесть шагов')),
        h('ol', { class: 'hint' }, ...steps.map((t) => h('li', {}, t))),
        h('p', { class: 'hint' }, L('Honest limits: rules are instructions and examples added to the prompt — the model is not retrained. Two accepted cases only permit narrow drafts; they are not a competence score.', 'Честные границы: правила — это инструкции и примеры в промпте, модель не дообучается. Два принятых случая допускают только узкие черновики и не являются оценкой компетентности.'))),
      h('div', { class: 'panel-box' }, h('strong', {}, L('3. Allowance', '3. Лимит')),
        h('p', { class: 'hint' }, al ? L(`This alpha allows ${al.maxCalls} model calls in total (${al.callsRemaining} left) and up to 3 scheduled repeats per schedule. It is a fixed alpha limit of this app, not your Claude quota. Your Claude usage limits still apply.`, `Эта альфа допускает ${al.maxCalls} вызовов модели всего (осталось ${al.callsRemaining}) и до 3 повторов на расписание. Это фиксированный лимит приложения, а не ваша квота Claude; лимиты Claude действуют отдельно.`) : '')),
      h('div', { class: 'panel-box' }, h('strong', {}, L('4. Local milestone export (optional)', '4. Локальный экспорт вех (по желанию)')),
        h('p', { class: 'hint' }, L('A small file with timestamps of milestones (agent created, first result, rule corrected…) and real-vs-stub counts. It has NO task text, results, names, paths or credentials, is created on this computer and is never uploaded. Download and share it only if you want to.', 'Небольшой файл с отметками времени вех (агент создан, первый результат, правило исправлено…) и счётчиками real/stub. В нём НЕТ текста задач, ответов, имён, путей и ключей; он создаётся на этом компьютере и никуда не отправляется. Скачивайте и передавайте только по желанию.')),
        h('div', { class: 'row' }, h('a', { class: 'btn', href: '/api/export/milestones?format=json', download: 'bay-office-milestones.json', id: 'exp-json' }, L('Download JSON', 'Скачать JSON')), h('a', { class: 'btn', href: '/api/export/milestones?format=csv', download: 'bay-office-milestones.csv', id: 'exp-csv' }, L('Download CSV', 'Скачать CSV')))));
  }
  const PRESET = {
    name: L('Project Notes Reporter', 'Репортёр по заметкам'),
    role: L('Reads my project notes and writes a short status summary: what is new, key facts, risks and next steps. Says plainly what the notes do not cover.', 'Читает мои заметки по проекту и пишет короткую сводку: что нового, ключевые факты, риски и следующие шаги. Прямо говорит, чего в заметках нет.'),
    goal: L('A one-screen summary I can read in two minutes, with no invented facts.', 'Сводка на один экран, читается за две минуты, без выдуманных фактов.'),
  };
  function mountAlphaChrome() {
    const top = document.querySelector('.top-actions'); if (!top) return;
    const g = h('button', { id: 'guideBtn', type: 'button', title: L('Getting started, connection check, export', 'Начало работы, проверка подключения, экспорт'), 'aria-label': L('Getting started', 'Начало работы'), onclick: () => openGuide() }, '? ' + L('Guide', 'Гид'));
    const lg = h('button', { id: 'langBtn', type: 'button', title: L('Switch language', 'Сменить язык'), 'aria-label': L('Switch language to Russian', 'Switch language to English'), onclick: () => window.baySetLang(window.BAY_LANG === 'ru' ? 'en' : 'ru') }, window.BAY_LANG === 'ru' ? 'EN' : 'RU');
    top.prepend(lg); top.prepend(g);
  }
  mountAlphaChrome();
  window.__boReady = () => !!S;
  refresh();
})();
