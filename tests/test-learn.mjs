// test-learn.mjs - ST1h. Cole: "will the studio keep learning from these trial runs im doing and can you help it
// learn?" Real core behind the function URL (fake store, fake Claude). The editor cuts a reel, the owner changes it
// by hand (real-time detail shot between time-lapse), exports -> the change is saved as a lesson, shown under
// What It Has Learned, and sent with the next Auto Edit. Usage: node tests/test-learn.mjs [studio.html] [shots-dir]
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import * as C from '../netlify/lib/studio-core.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(process.argv[2] || path.join(here, '..', 'studio.html'));
const SHOTS = path.resolve(process.argv[3] || path.join(here, 'shots'));
const FIX = path.join(here, 'fixtures');
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(FIX, { recursive: true });
const mk = (name, args) => { if (!fs.existsSync(path.join(FIX, name))) execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, path.join(FIX, name)]); };
mk('long-portrait.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=540x960:rate=30:duration=24', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
mk('clipB-portrait.mp4', ['-f', 'lavfi', '-i', 'smptebars=size=1080x1920:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
let pass = 0, fail = 0;
const check = (n, ok, msg) => { if (ok) { pass++; console.log('ok   ' + n + ' ' + msg); } else { fail++; console.log('FAIL ' + n + ' ' + msg); } };
const store = { m: new Map(),
  async get(k, o) { if (!this.m.has(k)) return null; const v = this.m.get(k); return o && o.type === 'json' ? JSON.parse(v) : v; },
  async setJSON(k, v) { this.m.set(k, JSON.stringify(v)); }, async delete(k) { this.m.delete(k); } };
const env = { ANTHROPIC_API_KEY: 'sk-test', STUDIO_PASSCODE: 'gold-shop-77' };
const calls = [];
const fakeClaude = async (url, opt) => {
  const body = JSON.parse(opt.body); calls.push(body);
  await new Promise(r => setTimeout(r, 300));
  const input = { template: 'walk', cut: 'hard', title: 'Model 3', service: 'Ceramic Coating', footage_notes: [{ footage: 1, what: 'coating going on the hood, long take' }, { footage: 2, what: 'finished car' }],
    shots: [{ footage: 1, in: 0, out: 16, speed: 8, what: 'coating application time-lapse' }, { footage: 1, in: 16, out: 20, speed: 4, what: 'polish going on the pad' }, { footage: 2, in: 0, out: 3, what: 'finished car' }],
    caption: 'Glass.', hashtags: ['ceramic'], why: 'Time-lapse then the finish.' };
  return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_edit', input }], usage: { input_tokens: 10, output_tokens: 5 } }) };
};
const html = fs.readFileSync(FILE);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (st, obj, type) => { res.writeHead(st, { 'content-type': type || 'application/json' }); res.end(type ? obj : JSON.stringify(obj)); };
  let raw = ''; for await (const ch of req) raw += ch;
  if (url.pathname === '/') return send(200, html, 'text/html');
  if (url.pathname === '/.netlify/functions/studio-api') {
    if (!C.authOk(req.headers['x-studio-key'], env)) return send(401, { error: 'Wrong passcode' });
    let body = null; if (req.method === 'POST') { try { body = JSON.parse(raw); } catch (e) { return send(400, { error: 'Bad JSON' }); } }
    const r = await C.handleApi({ method: req.method, op: url.searchParams.get('op'), query: Object.fromEntries(url.searchParams), body, store, env });
    return send(r.status, r.json);
  }
  if (url.pathname === '/.netlify/functions/studio-plan-background') {
    send(202, {});
    if (req.method === 'POST' && C.authOk(req.headers['x-studio-key'], env)) C.runPlan({ body: JSON.parse(raw), store, fetchImpl: fakeClaude, env });
    return;
  }
  send(404, { error: 'nope' });
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port + '/';
const b = await chromium.launch();
const errors = [];
try {
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.route('https://static.wixstatic.com/**', r => r.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(here, '..', 'vendor', 'logo.png')) }));
  await ctx.addInitScript(() => { try { localStorage.setItem('xl_studio_key', 'gold-shop-77'); } catch (e) {} });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE);
  await page.waitForFunction(() => window.XLStudio);
  check(1, /^ST1[h-z]-/.test(await page.evaluate(() => window.XL_STUDIO_BUILD)), 'build marker');
  await page.waitForFunction(() => /Nothing yet/.test(document.getElementById('learned').innerText), null, { timeout: 8000 });
  check(2, true, 'What It Has Learned shows the empty state');
  await page.setInputFiles('#file-clips', [path.join(FIX, 'long-portrait.mp4'), path.join(FIX, 'clipB-portrait.mp4')]);
  await page.waitForFunction(() => document.querySelectorAll('.clip').length === 2, null, { timeout: 30000 });
  await page.click('#btn-auto');
  await page.waitForFunction(() => window.XLStudio.S.clips.length === 3 && document.getElementById('review').classList.contains('on'), null, { timeout: 30000 });
  const cut = await page.evaluate(() => window.XLStudio.S.clips.map(c => [c.speed, c.what]));
  const P0 = await page.evaluate(() => window.XLStudio.plan().segs.map(s => +s.dur.toFixed(2)));
  check(3, cut[0][0] === 8 && cut[1][0] === 4 && cut[0][1] === 'coating application time-lapse' && P0[0] === 2 && P0[1] === 1, '8x time-lapse plays 16s in 2s; shots carry what they show ' + JSON.stringify(P0));
  const silent = await page.evaluate(async () => { const X = window.XLStudio; X.seekTo(0.5); await new Promise(r => setTimeout(r, 300)); return X.S.clips[0].el.muted; });
  check(4, silent, 'a time-lapse plays silent');
  // the owner's fix: polish on the pad at real time, more of it
  await page.click('.clip:nth-of-type(2) [data-a="more"]');
  await page.click('.clip:nth-of-type(2) [data-a="speed"][data-v="1"]');
  await page.click('.clip:nth-of-type(2) [data-a="speed"][data-v="1"]').catch(() => {});
  const spd2 = await page.evaluate(() => window.XLStudio.S.clips[1].speed);
  check(5, spd2 === 1, 'the polish shot set to real time by hand');
  const ok = await page.evaluate(async () => !!(await window.XLStudio.exportReel()));
  await page.waitForFunction(() => /slowed "polish going on the pad" from 4x to real time/.test(document.getElementById('learned').innerText), null, { timeout: 10000 });
  const style = JSON.parse(store.m.get('style'));
  check(6, ok && style.lessons.length === 1 && /slowed "polish going on the pad" from 4x to real time \(1x\)/.test(style.lessons[0].text), 'export saved the change as a lesson: ' + style.lessons[0].text);
  check(7, /From your changes/.test(await page.evaluate(() => document.getElementById('learned').innerText)), 'it shows under What It Has Learned');
  await page.evaluate(() => document.getElementById('learned').scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: path.join(SHOTS, 'learn-ipad.png') });
  // exporting the same thing again does not log it twice
  await page.evaluate(async () => { await window.XLStudio.exportReel(); });
  await new Promise(r => setTimeout(r, 800));
  check(8, JSON.parse(store.m.get('style')).lessons.length === 1, 'the same export twice -> one lesson');
  // the next Auto Edit carries it
  await page.click('#btn-auto');
  await page.waitForFunction(n => n, calls.length, { timeout: 100 }).catch(() => {});
  await new Promise(r => setTimeout(r, 4000));
  const last = calls[calls.length - 1];
  const txt = last.messages[0].content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  check(9, calls.length === 2 && /What the owner changed by hand on your recent cuts/.test(txt) && /slowed "polish going on the pad"/.test(txt), 'the next Auto Edit is told what the owner changed');
  // forget it
  await page.click('#learned [data-learn="lesson"]');
  await page.waitForFunction(() => !document.querySelector('#learned [data-learn="lesson"]'), null, { timeout: 8000 });
  check(10, JSON.parse(store.m.get('style')).lessons.length === 0, 'a lesson can be forgotten');
  // phone
  const ph = await ctx.newPage(); await ph.setViewportSize({ width: 390, height: 844 });
  await ph.goto(BASE); await ph.waitForFunction(() => window.XLStudio);
  await ph.evaluate(() => document.getElementById('learned').scrollIntoView({ block: 'center' }));
  await ph.screenshot({ path: path.join(SHOTS, 'learn-phone.png') });
  check(11, errors.length === 0, 'no page errors ' + JSON.stringify(errors.slice(0, 2)));
} catch (e) { console.error(e); fail++; }
await b.close(); server.close();
console.log('\n' + (fail ? 'RESULT FAIL' : 'RESULT PASS') + ' (' + pass + ' pass, ' + fail + ' fail)');
process.exit(fail ? 1 : 0);
