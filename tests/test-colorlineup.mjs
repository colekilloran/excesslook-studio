// test-colorlineup.mjs - ST1i. Cole: "what if i gave the studio a few pictures of a car and 10 different wrap colors.
// could it do a montage of that car in all the colors?" -> option 2. Real core behind both function URLs (fake store,
// fake OpenAI that returns a solid-color JPEG per color). Usage: node tests/test-colorlineup.mjs [studio.html] [shots-dir]
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
mk('car-side.jpg', ['-f', 'lavfi', '-i', 'testsrc2=size=1600x1066', '-frames:v', '1']);
mk('car-front.jpg', ['-f', 'lavfi', '-i', 'smptebars=size=1600x1066', '-frames:v', '1']);
mk('ppf-swatch.jpg', ['-f', 'lavfi', '-i', 'color=c=0x3A3D40:s=800x800', '-frames:v', '1']);
const solid = {};
for (const [k, hex] of [['blue', '0x1E6FD9'], ['black', '0x111111'], ['green', '0x4B5320'], ['purple', '0x7A2BB5'], ['stealth', '0xB0B4B8']]) {
  const f = path.join(FIX, 'solid-' + k + '.jpg');
  if (!fs.existsSync(f)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=' + hex + ':s=1536x1024', '-frames:v', '1', f]);
  solid[k] = fs.readFileSync(f).toString('base64');
}
let pass = 0, fail = 0;
const check = (n, ok, msg) => { if (ok) { pass++; console.log('ok   ' + n + ' ' + msg); } else { fail++; console.log('FAIL ' + n + ' ' + msg); } };
const store = { m: new Map(),
  async get(k, o) { if (!this.m.has(k)) return null; const v = this.m.get(k); return o && o.type === 'json' ? JSON.parse(v) : v; },
  async setJSON(k, v) { this.m.set(k, JSON.stringify(v)); }, async delete(k) { this.m.delete(k); } };
const env = { ANTHROPIC_API_KEY: 'sk-test', STUDIO_PASSCODE: 'gold-shop-77', OPENAI_API_KEY: 'sk-oa' };
const oa = [], oaImgs = []; let purpleFails = 1;
const fakeOA = async (url, opt) => {
  const f = {}; for (const [k, v] of opt.body.entries()) f[k] = typeof v === 'string' ? v : v;
  oa.push(f.prompt); oaImgs.push(opt.body.getAll('image[]').length);
  if (opt.body.getAll('image[]').length === 2) { await new Promise(r => setTimeout(r, 250)); return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ b64_json: solid.stealth }] }) }; }
  await new Promise(r => setTimeout(r, 250));
  if (/Purple/.test(f.prompt) && purpleFails-- > 0) return { ok: false, status: 500, text: async () => JSON.stringify({ error: { message: 'Server busy' } }) };
  const key = /Blue/.test(f.prompt) ? 'blue' : /Black/.test(f.prompt) ? 'black' : /Green/.test(f.prompt) ? 'green' : 'purple';
  return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ b64_json: solid[key] }] }) };
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
  if (url.pathname === '/.netlify/functions/studio-recolor-background') {
    send(202, {});
    if (req.method === 'POST' && C.authOk(req.headers['x-studio-key'], env)) C.runRecolor({ body: JSON.parse(raw), store, fetchImpl: fakeOA, env });
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
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.route('https://static.wixstatic.com/**', r => r.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(here, '..', 'vendor', 'logo.png')) }));
  await ctx.addInitScript(() => { try { localStorage.setItem('xl_studio_key', 'gold-shop-77'); } catch (e) {} });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE); await page.waitForFunction(() => window.XLStudio);
  return page;
}
const mean = (page, t) => page.evaluate(async t => { const X = window.XLStudio, P = X.plan(); const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1920; const x = cv.getContext('2d'); x.__sc = 1; X.drawFrame(x, t, P);
  const d = x.getImageData(100, 700, 880, 500).data; let r = 0, g = 0, bb = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; bb += d[i + 2]; } const n = d.length / 4; return [r / n, g / n, bb / n].map(v => Math.round(v)); }, t);
try {
  const page = await open({ width: 1180, height: 820 }, false);
  check(1, /^ST1[i-z]-/.test(await page.evaluate(() => window.XL_STUDIO_BUILD)) && /Add 1 to 4 photos/.test(await page.evaluate(() => document.getElementById('cl-photos').innerText)), 'build marker; asks for car photos first');
  await page.setInputFiles('#file-clips', [path.join(FIX, 'car-side.jpg'), path.join(FIX, 'car-front.jpg'), path.join(FIX, 'ppf-swatch.jpg')]);
  await page.waitForFunction(() => document.querySelectorAll('.cl-ph.on').length === 3, null, { timeout: 20000 });
  check(2, true, 'photos from Footage start as CAR');
  await page.click('.cl-ph:nth-of-type(2)'); await page.click('.cl-ph:nth-of-type(2)');   // front: car -> swatch -> not used
  await page.click('.cl-ph:nth-of-type(3)');                                               // the PPF photo: car -> swatch
  const roles = await page.evaluate(() => [...document.querySelectorAll('.cl-ph')].map(b => b.className.includes(' on') ? 'car' : b.className.includes(' sw') ? 'swatch' : 'off'));
  await page.fill('[data-sw]', 'XPEL Stealth');
  check(14, JSON.stringify(roles) === '["car","off","swatch"]' && (await page.evaluate(() => document.querySelectorAll('[data-sw]').length)) === 1, 'tap marks a photo car / swatch / not used; a swatch gets a name box ' + JSON.stringify(roles));
  await page.fill('#cl-colors', 'Gloss Miami Blue\nSatin Black\nMatte Military Green\nGloss Purple');
  await page.click('#cl-go');
  await page.waitForFunction(() => window.XLStudio.CL.tiles.length === 5 && window.XLStudio.CL.tiles.every(t => t.status === 'done' || t.status === 'error'), null, { timeout: 40000 });
  const t1 = await page.evaluate(() => window.XLStudio.CL.tiles.map(t => [t.color, t.status]));
  check(3, t1[0][0] === 'XPEL Stealth' && t1.filter(x => x[1] === 'done').length === 4 && t1[4][1] === 'error' && oa.length === 5 && /Satin Black as a professional vinyl wrap, satin finish/.test(oa.join('\n'))
    && oaImgs[oa.findIndex(x => /XPEL Stealth/.test(x))] === 2 && /second image/.test(oa.find(x => /XPEL Stealth/.test(x))), 'the swatch renders from the PPF photo (car + swatch sent together), plus four typed colors; one failed ' + JSON.stringify(t1));
  check(4, /4 renders ready, 1 failed/.test(await page.evaluate(() => document.getElementById('cl-st').textContent)) && /Server busy/.test(await page.evaluate(() => document.getElementById('cl-grid').innerText)), 'the failure says why');
  await page.screenshot({ path: path.join(SHOTS, 'colorlineup-ipad-grid.png') });
  await page.click('.cl-tile:nth-of-type(5) [data-rr]');
  await page.waitForFunction(() => window.XLStudio.CL.tiles[4].status === 'done', null, { timeout: 20000 });
  check(5, true, 're-roll renders it again');
  await page.click('.cl-tile:nth-of-type(4)');
  check(6, await page.evaluate(() => window.XLStudio.CL.tiles[3].keep === false && /4 of 5 renders in/.test(document.getElementById('cl-count').textContent)), 'tap a tile to leave it out');
  // there is a shot already -> it asks before replacing
  await page.click('#cl-make');
  await page.waitForSelector('#xl-dlg.on');
  await page.click('#xl-dlg .xl-o');
  await page.waitForFunction(() => window.XLStudio.S.clips.length === 5 && window.XLStudio.S.clips[4].render, null, { timeout: 20000 });
  const lin = await page.evaluate(() => { const S = window.XLStudio.S; return { shots: S.clips.map(c => [c.text, !!c.render, +(c.outT - c.inT).toFixed(2), c.src.name]), cut: S.cut, hl: S.look.headline, srcs: S.sources.length }; });
  check(7, lin.shots[0][0] === 'WHICH COLOR WOULD YOU PICK?' && !lin.shots[0][1] && lin.shots[1][0] === 'XPEL STEALTH' && lin.shots[2][0] === 'GLOSS MIAMI BLUE' && lin.shots[2][1] && lin.shots[3][0] === 'SATIN BLACK' && lin.shots[4][0] === 'GLOSS PURPLE' && lin.shots[2][2] === 1.1 && lin.cut === 'hard' && lin.hl === 'none' && lin.srcs === 7,
    'the lineup: real car hook, then each kept color with its name; hard cuts; renders added to Footage ' + JSON.stringify(lin.shots));
  // the frames really show the colors and carry the render tag
  const P = await page.evaluate(() => window.XLStudio.plan().segs.map(s => s.start));
  const stealth = await mean(page, P[1] + 0.5), blue = await mean(page, P[2] + 0.5), black = await mean(page, P[3] + 0.5);
  check(8, blue[2] > blue[0] + 60 && black[0] < 40 && black[2] < 40 && stealth[0] > 150, 'the reel shows the rendered colors (swatch ' + stealth + ', blue ' + blue + ', black ' + black + ')');
  const tag = await page.evaluate(t => { const X = window.XLStudio, P = X.plan(); const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1920; const x = cv.getContext('2d'); x.__sc = 1; X.drawFrame(x, t, P); const d = x.getImageData(90, 250, 200, 24).data; let w = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) w++; return w; }, P[2] + 0.5);
  check(9, tag > 80, 'each render carries the COLOR RENDER tag (' + tag + ' white px)');
  check(13, (await page.evaluate(() => document.querySelectorAll('.cl-ph').length)) === 3, 'renders are not offered back as photos');
  check(10, ![...store.m.keys()].some(k => k.startsWith('cl/')), 'the server copy is cleared once the lineup is made');
  await page.evaluate(() => window.XLStudio.seekTo(window.XLStudio.plan().segs[2].start + 0.5));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, 'colorlineup-ipad-reel.png') });
  // phone
  const ph = await open({ width: 390, height: 844 }, true);
  await ph.setInputFiles('#file-clips', [path.join(FIX, 'car-side.jpg')]);
  await ph.waitForFunction(() => document.querySelectorAll('.cl-ph.on').length === 1, null, { timeout: 20000 });
  await ph.fill('#cl-colors', 'Gloss Miami Blue\nSatin Black');
  await ph.click('#cl-go');
  await ph.waitForFunction(() => window.XLStudio.CL.tiles.length === 2 && window.XLStudio.CL.tiles.every(t => t.status === 'done'), null, { timeout: 30000 });
  await ph.evaluate(() => document.getElementById('cl').scrollIntoView({ block: 'start' }));
  await ph.screenshot({ path: path.join(SHOTS, 'colorlineup-phone.png') });
  const over = await ph.evaluate(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > w + 1 && !e.closest('.xl-toast') && !e.closest('#vid-holder') && !e.closest('#pj-sheet'); }).map(e => e.className || e.tagName).slice(0, 5); });
  check(11, over.length === 0, 'phone: nothing past the edge ' + JSON.stringify(over));
  check(12, errors.length === 0, 'no page errors ' + JSON.stringify(errors.slice(0, 2)));
} catch (e) { console.error(e); fail++; }
await b.close(); server.close();
console.log('\n' + (fail ? 'RESULT FAIL' : 'RESULT PASS') + ' (' + pass + ' pass, ' + fail + ' fail)');
process.exit(fail ? 1 : 0);
