// test-autoedit.mjs - Auto Edit end to end. Serves studio.html over http with
// the REAL studio-core behind the two function URLs (fake store, fake Claude),
// then drives the page in Chromium: passcode, stills upload, background job,
// plan applied, notes, redo, rules, export, approval.
// Usage: node tests/test-autoedit.mjs [studio.html] [shots-dir]
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
mk('clipA-landscape.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
mk('clipB-portrait.mp4', ['-f', 'lavfi', '-i', 'smptebars=size=1080x1920:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
mk('photo.jpg', ['-f', 'lavfi', '-i', 'mandelbrot=size=1200x1600', '-frames:v', '1']);

let pass = 0, fail = 0;
const check = (n, ok, msg) => { if (ok) { pass++; console.log('ok   ' + n + ' ' + msg); } else { fail++; console.log('FAIL ' + n + ' ' + msg); } };

/* ── the fake Netlify: real core, fake store, fake Claude ─────────────── */
const store = { m: new Map(),
  async get(k, o) { if (!this.m.has(k)) return null; const v = this.m.get(k); return o && o.type === 'json' ? JSON.parse(v) : v; },
  async setJSON(k, v) { this.m.set(k, JSON.stringify(v)); }, async delete(k) { this.m.delete(k); } };
const env = { ANTHROPIC_API_KEY: 'sk-test', STUDIO_PASSCODE: 'gold-shop-77' };
const claudeCalls = [];
const fakeClaude = async (url, opt) => {
  const body = JSON.parse(opt.body);
  claudeCalls.push(body);
  const txt = body.messages[0].content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  const redo = /Cut it faster/.test(txt);
  await new Promise(r => setTimeout(r, 900));                    // the AI takes a moment
  const input = redo
    ? { template: 'reveal', title: 'G-Wagon', service: 'Ceramic Coating', shots: [{ footage: 3, in: 0, out: 2 }, { footage: 1, in: 0.5, out: 2 }], caption: 'Faster cut.', hashtags: ['ceramiccoating'], why: 'Cut faster as asked.' }
    : { template: 'ba', title: '2024 G-Wagon', service: 'Paint Correction + Ceramic Coating',
        shots: [{ footage: 2, in: 0.5, out: 2.0, label: 'before' },
                { footage: 1, in: 1.0, out: 3.0, fit: 'fit', blur: [{ x: 0.40, y: 0.60, w: 0.20, h: 0.10, what: 'plate' }] },
                { footage: 3, in: 0, out: 2.5, label: 'AFTER' }],
        caption: 'Glass finish — booked out through December.', hashtags: ['#ceramiccoating', 'detailing'], why: 'Opened on the before so the after lands.' };
  return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_edit', input }], usage: { input_tokens: 6200, output_tokens: 380 } }) };
};
const html = fs.readFileSync(FILE);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (st, obj, type) => { res.writeHead(st, { 'content-type': type || 'application/json' }); res.end(type ? obj : JSON.stringify(obj)); };
  let raw = ''; for await (const ch of req) raw += ch;
  if (url.pathname === '/' ) return send(200, html, 'text/html');
  if (url.pathname === '/fonts/bebas.ttf') return send(200, fs.readFileSync(path.join(here, 'fonts', 'BebasNeue-Regular.ttf')), 'font/ttf');
  if (url.pathname === '/.netlify/functions/studio-api') {
    if (!C.authOk(req.headers['x-studio-key'], env)) return send(401, { error: 'Wrong passcode' });
    let body = null; if (req.method === 'POST') { try { body = JSON.parse(raw); } catch (e) { return send(400, { error: 'Bad JSON' }); } }
    const r = await C.handleApi({ method: req.method, op: url.searchParams.get('op'), query: Object.fromEntries(url.searchParams), body, store, env });
    return send(r.status, r.json);
  }
  if (url.pathname === '/.netlify/functions/studio-plan-background') {
    send(202, {});                                               // Netlify answers at once...
    if (req.method === 'POST' && C.authOk(req.headers['x-studio-key'], env)) {
      C.runPlan({ body: JSON.parse(raw), store, fetchImpl: fakeClaude, env });   // ...and runs it in the background
    }
    return;
  }
  send(404, { error: 'nope' });
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port + '/';

const b = await chromium.launch();
const errors = [];
async function open(vp, mobile) {
  const ctx = await b.newContext(Object.assign({ viewport: vp }, mobile ? { isMobile: true, hasTouch: true } : {}));
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: "@font-face{font-family:'Bebas Neue';src:url(" + BASE + "fonts/bebas.ttf) format('truetype')}" }));
  await ctx.route('https://static.wixstatic.com/**', r => r.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(here, '..', 'vendor', 'logo.png')) }));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: "@font-face{font-family:'Bebas Neue';src:url(" + BASE + "fonts/bebas.ttf) format('truetype')}" }));
  await page.route('https://static.wixstatic.com/**', r => r.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(here, '..', 'vendor', 'logo.png')) }));
  await page.goto(BASE);
  await page.waitForFunction(() => window.XLStudio);
  return page;
}
try {
  const page = await open({ width: 1180, height: 820 });
  check(1, /^ST1[b-z]-/.test(await page.evaluate(() => window.XL_STUDIO_BUILD)), 'build marker');

  // 2 no footage yet
  await page.click('#btn-auto');
  await page.waitForTimeout(250);
  check(2, /raw footage first/.test(await page.textContent('#xl-toast .tt')), 'Make My Reel with no footage asks for it');

  await page.setInputFiles('#file-clips', [path.join(FIX, 'clipA-landscape.mp4'), path.join(FIX, 'clipB-portrait.mp4'), path.join(FIX, 'photo.jpg')]);
  await page.waitForFunction(() => window.XLStudio.S.sources.length === 3, null, { timeout: 30000 });
  const chips = await page.$$eval('#foot .fchip b', e => e.map(x => x.textContent));
  check(3, chips.join(',') === 'F1,F2,F3', 'footage strip numbers the items ' + chips.join(','));

  // 4 wrong passcode, then right
  await page.fill('#ai-note', 'Ceramic on a black G-Wagon');
  await page.click('#btn-auto');
  await page.waitForSelector('#st-key');
  await page.fill('#st-key', 'nope-nope');
  await page.click('#xl-dlg .xl-o');
  await page.waitForTimeout(400);
  const t4 = await page.textContent('#xl-toast .tt');
  check(4, /Wrong passcode/.test(t4) && store.m.size === 0 && claudeCalls.length === 0, 'wrong passcode refused, nothing sent: "' + t4 + '"');
  await page.click('#btn-auto');
  await page.waitForSelector('#xl-dlg.on #st-key');
  await page.fill('#st-key', 'gold-shop-77');
  await page.click('#xl-dlg .xl-o');
  // 5 progress shows while it works; controls locked
  await page.waitForSelector('#ai-prog.on');
  const locked = await page.evaluate(() => document.body.classList.contains('ai'));
  await page.screenshot({ path: path.join(SHOTS, 'ai-working-ipad.png') });
  check(5, locked, 'gold progress shown and the controls locked while editing');
  await page.waitForSelector('#review.on', { timeout: 60000 });

  // 6-12 the plan landed
  const st = await page.evaluate(() => {
    const X = window.XLStudio, S = X.S;
    return { tpl: S.tpl, title: document.getElementById('f-title').value, service: S.service,
      shots: S.clips.map(c => ({ f: c.src.fid, in: c.inT, out: c.outT, label: c.label, fit: c.fit, blurs: c.blurs })),
      cap: document.getElementById('rev-cap').value, tags: document.getElementById('rev-tags').value,
      why: document.getElementById('rev-why').textContent, meta: document.getElementById('rev-meta').textContent,
      total: X.plan().total };
  });
  check(6, st.tpl === 'ba' && st.title === '2024 G-Wagon' && st.service === 'Paint Correction + Ceramic Coating', 'template and text set from the edit');
  check(7, st.shots.map(s => s.f).join(',') === '2,1,3' && st.shots[0].in === 0.5 && st.shots[0].out === 2 && st.shots[0].label === 'BEFORE', 'shots in the editor\'s order with its trims and labels');
  check(8, st.shots[2].in === 0 && Math.abs(st.shots[2].out - 2.5) < 1e-9, 'photo shot gets its length');
  // landscape 1920x1080 shown whole (fit): frame scale 0.5625, top offset 656 of 1920
  const bl = st.shots[1].blurs[0];
  const ex = { x: (0.40 - 0.03) , y: (656.25 + (0.60 - 0.015) * 607.5) / 1920, w: 0.26, h: (0.13 * 607.5) / 1920 };
  check(9, st.shots[1].fit === 'fit' && bl && Math.abs(bl.x - ex.x) < 0.002 && Math.abs(bl.y - ex.y) < 0.002 && Math.abs(bl.w - ex.w) < 0.002 && Math.abs(bl.h - ex.h) < 0.002,
    'plate box moved from the raw frame into the reel frame ' + JSON.stringify(bl && { x: +bl.x.toFixed(3), y: +bl.y.toFixed(3), w: +bl.w.toFixed(3), h: +bl.h.toFixed(3) }));
  check(10, /Glass finish - booked/.test(st.cap) && st.tags === '#ceramiccoating #detailing', 'caption (dash fixed) and hashtags filled in');
  check(11, /before so the after lands/.test(st.why) && /6,200 in/.test(st.meta), 'the editor\'s reasoning and token use shown');
  check(12, Math.abs(st.total - (1.5 + 2 + 2.5 + 2.6)) < 0.01, 'reel length ' + st.total.toFixed(2) + 's');

  // 13-15 what reached the editor
  const c1 = claudeCalls[0];
  const imgs = c1.messages[0].content.filter(c => c.type === 'image');
  const txt1 = c1.messages[0].content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  check(13, imgs.length === 4 + 3 + 1 && imgs.every(i => i.source.data.length > 1000), 'stills sent: 4 + 3 from the videos, 1 photo (' + imgs.length + ')');
  check(14, /Ceramic on a black G-Wagon/.test(txt1) && /F1 - clipA-landscape\.mp4 - video 4\.0s, landscape 1920x1080/.test(txt1), 'the ask and the footage list reached the editor');
  check(15, ![...store.m.keys()].some(k => k.startsWith('frames/')), 'stills deleted from the store after the job');

  await page.evaluate(() => window.XLStudio.seekTo(0.6));
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, 'review-ipad.png') });
  await page.evaluate(() => { document.getElementById('scroller').scrollTop = 420; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, 'review-ipad-scrolled.png') });
  await page.evaluate(() => { document.getElementById('scroller').scrollTop = 0; });

  // 16-19 notes: rule + redo
  await page.click('#btn-redo');
  await page.waitForTimeout(250);
  check(16, /what should change/i.test(await page.textContent('#xl-toast .tt')), 'Redo with no note asks for one');
  await page.fill('#rev-notes', 'Cut it faster and open on the finished car');
  await page.check('#rev-rule');
  await page.click('#btn-redo');
  await page.waitForFunction(() => window.XLStudio.S.tpl === 'reveal', null, { timeout: 60000 });
  const style = JSON.parse(store.m.get('style'));
  check(17, style.rules.includes('Cut it faster and open on the finished car') && style.feedback.length === 1, 'the note was saved and became a rule');
  const txt2 = claudeCalls[1].messages[0].content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  check(18, /previous draft of THIS reel/.test(txt2) && /"footage":2/.test(txt2) && /Cut it faster/.test(txt2) && /owner's rules \(always follow\):\n- Cut it faster/.test(txt2), 'the redo carried the last draft, the note and the new rule');
  check(19, (await page.$$eval('#clips .clip', e => e.length)) === 2 && (await page.inputValue('#rules')).includes('Cut it faster'), 'new cut applied, rules box updated');

  // 20 edit rules directly
  await page.fill('#rules', 'Keep reels under 20 seconds\nOpen on the finished car');
  await page.click('#btn-rules');
  await page.waitForTimeout(500);
  check(20, JSON.parse(store.m.get('style')).rules.length === 2, 'rules saved from the rules box');

  // 21-22 export = approval the editor learns from
  const ok = await page.evaluate(() => window.XLStudio.exportReel().then(b => !!b));
  await page.waitForTimeout(600);
  const ex2 = JSON.parse(store.m.get('style')).examples;
  check(21, ok && ex2.length === 1 && /Reveal, 2 shots, 3\.5s/.test(ex2[0].summary), 'exported reel saved as an approved example: ' + (ex2[0] && ex2[0].summary));
  check(22, (await page.$eval('#result', e => e.classList.contains('on'))), 'export finished');

  // 23 a server-side failure is shown, not swallowed
  env.ANTHROPIC_API_KEY = '';
  await page.click('#btn-auto');
  await page.waitForFunction(() => document.getElementById('ai-status').classList.contains('err'), null, { timeout: 30000 });
  const err = await page.textContent('#ai-status');
  check(23, /ANTHROPIC_API_KEY/.test(err) && !(await page.evaluate(() => document.body.classList.contains('ai'))), 'missing key reported on screen, controls unlocked: ' + err);
  env.ANTHROPIC_API_KEY = 'sk-test';

  // 24 passcode remembered: a new page does not ask again
  const p2 = await page.context().newPage();
  await p2.goto(BASE); await p2.waitForFunction(() => window.XLStudio);
  await p2.waitForTimeout(600);
  check(24, (await p2.inputValue('#rules')).includes('Keep reels under 20 seconds'), 'passcode remembered on this device, rules load on open');

  // 25 phone width
  const ph = await open({ width: 390, height: 844 }, true);
  await ph.setInputFiles('#file-clips', [path.join(FIX, 'clipB-portrait.mp4'), path.join(FIX, 'photo.jpg')]);
  await ph.waitForFunction(() => window.XLStudio.S.sources.length === 2, null, { timeout: 30000 });
  await ph.click('#btn-auto');
  await ph.waitForSelector('#xl-dlg.on #st-key');
  await ph.fill('#st-key', 'gold-shop-77');
  await ph.click('#xl-dlg .xl-o');
  await ph.waitForSelector('#review.on', { timeout: 60000 });
  const over = await ph.evaluate(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > w + 1 && !e.closest('.xl-toast'); }).map(e => e.id || e.className || e.tagName).slice(0, 5); });
  check(25, over.length === 0, 'phone: nothing past the screen edge ' + JSON.stringify(over));
  const ry = await ph.$eval('#ai-note', e => e.getBoundingClientRect().top + document.getElementById('scroller').scrollTop - 60);
  await ph.evaluate(y => { document.getElementById('scroller').scrollTop = y; }, ry);
  await ph.waitForTimeout(500);
  await ph.screenshot({ path: path.join(SHOTS, 'review-phone.png') });

  check(26, errors.length === 0, 'no page errors ' + JSON.stringify(errors.slice(0, 3)));
} catch (e) {
  console.error(e); fail++;
} finally {
  await b.close(); server.close();
}
console.log('\n' + (fail ? 'RESULT FAIL' : 'RESULT PASS') + ' (' + pass + ' pass, ' + fail + ' fail)');
process.exit(fail ? 1 : 0);
