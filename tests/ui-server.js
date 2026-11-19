'use strict';
// Stub-provider server for BROWSER tests only (port from argv, temp data dir). Not the real app.
// UI_FAST_SCHED=1 (test-only): pulls the due time of ACTIVE schedules into the past so the stub run need not wait minutes. The real server never does this.
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createApp } = require('../src/app');
const port = parseInt(process.argv[2] || '8193', 10);
const dataDir = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'fp-ui-'));
const FAST = process.env.UI_FAST_SCHED === '1';
const calls = [];
const provider = {
  name: 'ui-stub', real: false,
  async run({ prompt }) {
    calls.push(1); await new Promise((r) => setTimeout(r, 700));
    const text = '## Бриф\nЧерновик ответа №' + calls.length + ' (заглушка). ' + (/PREVIOUS ANSWER/.test(prompt) ? 'Короче: на основе предыдущего ответа. ' : '') + (/Факт-Альфа/.test(prompt) ? 'Учтён Факт-Альфа. ' : '') + (/Факт-Бета/.test(prompt) ? 'Учтён Факт-Бета. ' : '') + (/Факт-Гамма/.test(prompt) ? 'Учтён Факт-Гамма. ' : '') + (/Цена/.test(prompt) ? 'Цена: 10 USD. ' : '') + 'Достаточно длинный текст.';
    return { ok: true, text, model: 'claude-haiku-stub', costUsd: 0.01, usage: {}, durationMs: 700 };
  },
  shutdown() {}, cancel() {},
};
const app = createApp({ dataDir, provider, tickMs: 1000 });
app.listen(port).then((p) => { fs.writeFileSync(path.join(dataDir, 'launch-url.txt'), `http://127.0.0.1:${p}/auth?k=${app.launchToken}\n`); console.log('ui-stub on', p, 'data', dataDir); });
if (FAST) setInterval(() => { for (const sc of Object.values(app.getState().schedules)) if (sc.status === 'active' && sc.intervalMin < 60 && sc.nextAt && Date.parse(sc.nextAt) > Date.now()) sc.nextAt = new Date(Date.now() - 100).toISOString(); }, 700);
