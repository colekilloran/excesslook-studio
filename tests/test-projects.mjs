// test-projects.mjs - ST1e saved reels. Cole: "will it also have a way to save a video and settings for how
// the video was created so i can come back to it?" - chose "settings online, footage on device".
// Real studio-core behind the function URL (fake store). Two browser contexts = two devices.
// Usage: node tests/test-projects.mjs [studio.html] [shots-dir]
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
mk('music.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=220:duration=10', '-c:a', 'libmp3lame']);
const A = path.join(FIX, 'clipA-landscape.mp4'), B = path.join(FIX, 'clipB-portrait.mp4'), MU = path.join(FIX, 'music.mp3');

let pass = 0, fail = 0;
const check = (n, ok, msg) => { if (ok) { pass++; console.log('ok   ' + n + ' ' + msg); } else { fail++; console.log('FAIL ' + n + ' ' + msg); } };
const store = { m: new Map(),
  async get(k, o) { if (!this.m.has(k)) return null; const v = this.m.get(k); return o && o.type === 'json' ? JSON.parse(v) : v; },
  async setJSON(k, v) { this.m.set(k, JSON.stringify(v)); }, async delete(k) { this.m.delete(k); } };
const env = { ANTHROPIC_API_KEY: 'sk-test', STUDIO_PASSCODE: 'gold-shop-77' };
const html = fs.readFileSync(FILE);
let saves = 0;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (st, obj, type) => { res.writeHead(st, { 'content-type': type || 'application/json' }); res.end(type ? obj : JSON.stringify(obj)); };
  let raw = ''; for await (const ch of req) raw += ch;
  if (url.pathname === '/') return send(200, html, 'text/html');
  if (url.pathname === '/fonts/bebas.ttf') return send(200, fs.readFileSync(path.join(here, 'fonts', 'BebasNeue-Regular.ttf')), 'font/ttf');
  if (url.pathname === '/.netlify/functions/studio-api') {
    if (!C.authOk(req.headers['x-studio-key'], env)) return send(401, { error: 'Wrong passcode' });
    let body = null; if (req.method === 'POST') { try { body = JSON.parse(raw); } catch (e) { return send(400, { error: 'Bad JSON' }); } }
    if (url.searchParams.get('op') === 'proj-save') saves++;
    const r = await C.handleApi({ method: req.method, op: url.searchParams.get('op'), query: Object.fromEntries(url.searchParams), body, store, env });
    return send(r.status, r.json);
  }
  send(404, { error: 'nope' });
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port + '/';
const b = await chromium.launch();
const errors = [];
async function device(vp, mobile, key) {
  const ctx = await b.newContext(Object.assign({ viewport: vp }, mobile ? { isMobile: true, hasTouch: true } : {}));
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: "@font-face{font-family:'Bebas Neue';src:url(" + BASE + "fonts/bebas.ttf) format('truetype')}" }));
  await ctx.route('https://static.wixstatic.com/**', r => r.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(here, '..', 'vendor', 'logo.png')) }));
  if (key) await ctx.addInitScript(k => { try { if (!localStorage.getItem('xl_studio_key_set')) { localStorage.setItem('xl_studio_key', k); localStorage.setItem('xl_studio_key_set', '1'); } } catch (e) {} }, key);
  return ctx;
}
async function open(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE);
  await page.waitForFunction(() => window.XLStudio && (window.XLStudio.showAll(), true));
  return page;
}
const projs = () => [...store.m.keys()].filter(k => k.startsWith('proj/'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const st = p => p.evaluate(() => document.getElementById('proj-st').textContent);
try {
  // ── device A: the shop iPad ──
  const ctxA = await device({ width: 1180, height: 820 }, false, 'gold-shop-77');
  let pA = await open(ctxA);
  check(1, /^ST1[e-z]-/.test(await pA.evaluate(() => window.XL_STUDIO_BUILD)) && /New reel/.test(await pA.evaluate(() => document.getElementById('proj-title').textContent)), 'build marker; empty studio says New reel');
  await wait(2500);
  check(2, projs().length === 0 && saves === 0, 'nothing saved before any footage');
  await pA.setInputFiles('#file-clips', [A, B]);
  await pA.waitForFunction(() => document.querySelectorAll('.clip').length === 2, null, { timeout: 30000 });
  await pA.setInputFiles('#file-music', MU);
  await pA.waitForFunction(() => !!window.XLStudio.S.music);
  await pA.evaluate(() => {
    const S = window.XLStudio.S;
    S.clips[0].inT = 0.8; S.clips[0].outT = 3.2;
    S.clips[0].blurs.push({ x: 0.31, y: 0.62, w: 0.4, h: 0.07 });
    S.clips[1].label = 'After';
    S.music.vol = 0.35;
  });
  await pA.click('#tpl-seg [data-tpl="reveal"]');
  await pA.click('#cut-seg [data-cut="dip"]');
  await pA.fill('#f-title', 'G-Wagon Ceramic');
  await pA.fill('#f-service', 'Ceramic Coating');
  await pA.waitForFunction(() => /^Saved /.test(document.getElementById('proj-st').textContent), null, { timeout: 8000 });
  const saved = JSON.parse(store.m.get(projs()[0]) || '{}');
  check(3, projs().length === 1 && saved.shots.length === 2 && saved.shots[0].inT === 0.8 && saved.shots[0].outT === 3.2 && saved.shots[0].blurs[0].w === 0.4
    && saved.shots[1].label === 'After' && saved.tpl === 'reveal' && saved.title === 'G-Wagon Ceramic' && saved.music.name === 'music.mp3' && saved.music.vol === 0.35 && saved.cut === 'dip',
    'the edit saved online by itself: trims, blur box, label, template, text, music');
  check(4, saved.footage.length === 2 && saved.footage.every(f => /\|\d+\|\d+$/.test(f.key) && f.size > 0 && !f.data) && saved.name === 'G-Wagon Ceramic' && /^data:image\/jpeg/.test(saved.thumb)
    && JSON.stringify(saved).length < 40000, 'footage is listed by name|size|date only - no video goes online (' + JSON.stringify(saved).length + ' bytes); named from the headline');
  const n1 = saves;
  await wait(4500);
  check(5, saves === n1, 'no change -> no more saves (' + (saves - n1) + ' extra)');
  // export once: the MP4 is kept on this device with the reel
  const ok = await pA.evaluate(async () => !!(await window.XLStudio.exportReel()));
  await pA.waitForFunction(async () => (await window.XLStudio.idbKeys()).has('exp:' + window.XLStudio.proj.id), null, { timeout: 8000 });
  // ── reopen on the same device: everything comes back, clips included ──
  await pA.close();
  pA = await open(ctxA);
  await pA.waitForFunction(() => window.XLStudio.S.clips.length === 2 && !!window.XLStudio.S.music && /^Saved /.test(document.getElementById('proj-st').textContent), null, { timeout: 20000 });
  const back = await pA.evaluate(() => { const S = window.XLStudio.S; return { n: S.sources.length, in0: S.clips[0].inT, out0: S.clips[0].outT, bl: S.clips[0].blurs.length, l1: S.clips[1].label, tpl: S.tpl,
    title: document.getElementById('f-title').value, vol: S.music.vol, cut: S.cut, miss: S.missing.length, res: document.getElementById('result').classList.contains('on'), th: !!S.sources[0].thumb }; });
  check(6, back.n === 2 && back.in0 === 0.8 && back.out0 === 3.2 && back.bl === 1 && back.l1 === 'After' && back.tpl === 'reveal' && back.title === 'G-Wagon Ceramic' && back.vol === 0.35 && back.cut === 'dip' && back.miss === 0 && back.th,
    'reopened on the same device: clips from the device, every setting back ' + JSON.stringify(back));
  check(7, ok && back.res, 'the exported reel is back too, ready to share');
  await pA.screenshot({ path: path.join(SHOTS, 'projects-ipad.png') });
  await wait(2500);
  check(8, saves === n1 + 0 || saves === n1 + 1, 'opening does not resave a copy (' + (saves - n1) + ')');

  // ── device B: a phone with none of the clips ──
  const ctxB = await device({ width: 390, height: 844 }, true, 'gold-shop-77');
  const pB = await open(ctxB);
  await pB.tap('#btn-projects');
  await pB.waitForSelector('#pj-list .pj-row', { timeout: 8000 });
  await wait(600);
  const rowTxt = await pB.evaluate(() => document.querySelector('#pj-list .pj-row').innerText);
  check(9, /G-Wagon Ceramic/.test(rowTxt) && /Add the clips back/i.test(rowTxt) && /2 shots/.test(rowTxt), 'Projects on the phone lists it, says the clips must be added back: ' + rowTxt.replace(/\n/g, ' | '));
  await pB.screenshot({ path: path.join(SHOTS, 'projects-sheet-phone.png') });
  await pB.tap('#pj-list .pj-row');
  await pB.waitForFunction(() => window.XLStudio.S.missing.length === 2, null, { timeout: 10000 });
  const m0 = await pB.evaluate(() => ({ clips: window.XLStudio.S.clips.length, card: document.getElementById('miss').innerText, tpl: window.XLStudio.S.tpl, t: document.getElementById('f-title').value }));
  check(10, m0.clips === 0 && /2 clips and the music to add back/i.test(m0.card) && /clipA-landscape\.mp4/.test(m0.card) && m0.tpl === 'reveal' && m0.t === 'G-Wagon Ceramic', 'opened without clips: settings in, the card lists what to add back');
  await pB.evaluate(() => document.getElementById('miss').scrollIntoView({ block: 'center' }));
  await wait(300);
  await pB.screenshot({ path: path.join(SHOTS, 'projects-missing-phone.png') });
  // add B first: its shot comes back, still second in line once A is back
  await pB.setInputFiles('#file-clips', [B]);
  await pB.waitForFunction(() => window.XLStudio.S.clips.length === 1, null, { timeout: 20000 });
  const m1 = await pB.evaluate(() => ({ l: window.XLStudio.S.clips[0].label, miss: window.XLStudio.S.missing.length }));
  await pB.setInputFiles('#file-clips', [A]);
  await pB.waitForFunction(() => window.XLStudio.S.clips.length === 2, null, { timeout: 20000 });
  const m2 = await pB.evaluate(() => { const S = window.XLStudio.S; return { order: S.clips.map(c => c.src.name), in0: S.clips[0].inT, bl: S.clips[0].blurs.length, l1: S.clips[1].label, miss: S.missing.length }; });
  check(11, m1.l === 'After' && m1.miss === 1 && m2.miss === 0 && m2.order[0] === 'clipA-landscape.mp4' && m2.order[1] === 'clipB-portrait.mp4' && m2.in0 === 0.8 && m2.bl === 1 && m2.l1 === 'After',
    'adding the clips back drops each shot back in place ' + JSON.stringify(m2));
  await pB.setInputFiles('#file-music', MU);
  await pB.waitForFunction(() => !!window.XLStudio.S.music && !window.XLStudio.S.musicMissing);
  check(12, (await pB.evaluate(() => window.XLStudio.S.music.vol)) === 0.35 && !(await pB.evaluate(() => document.getElementById('miss').classList.contains('on'))), 'music added back at its saved volume; the card is gone');
  // an edit on the phone saves to the same reel
  await pB.evaluate(() => { const i = document.querySelectorAll('.clip')[1].querySelector('input[data-a="label"]'); i.value = 'Finished'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await pB.waitForFunction(() => /^Saved /.test(document.getElementById('proj-st').textContent), null, { timeout: 8000 });
  await wait(2500);
  const s2 = JSON.parse(store.m.get(projs()[0]));
  check(13, projs().length === 1 && s2.shots[1].label === 'Finished', 'the phone edit saved to the same reel, no copy');
  // rename
  await pB.tap('#proj-name');
  await pB.waitForSelector('#pj-name-in');
  await pB.fill('#pj-name-in', 'Smith G-Wagon');
  await pB.tap('#xl-dlg .xl-o');
  await wait(2500);
  check(14, JSON.parse(store.m.get(projs()[0])).name === 'Smith G-Wagon' && /Smith G-Wagon/.test(await pB.evaluate(() => document.getElementById('proj-title').textContent)), 'renamed');
  // New: empty studio, last one still saved
  await pB.tap('#btn-new');
  await wait(400);
  const nw = await pB.evaluate(() => ({ c: window.XLStudio.S.clips.length, s: window.XLStudio.S.sources.length, p: window.XLStudio.proj, t: document.getElementById('f-title').value, tpl: window.XLStudio.S.tpl, cut: window.XLStudio.S.cut, st: document.getElementById('proj-st').textContent, err: document.getElementById('proj-bar').className }));
  check(15, nw.c === 0 && nw.s === 0 && !nw.p && nw.t === '' && nw.tpl === 'ba' && nw.cut === 'hard' && /Add footage to start/.test(nw.st) && !/err|local/.test(nw.err) && projs().length === 1, 'New starts clean; the last reel stays saved; bar reads ' + nw.st);
  const over = await pB.evaluate(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > w + 1 && !e.closest('.xl-toast') && !e.closest('#vid-holder') && !e.closest('#pj-sheet') && !e.closest('#xl-dlg'); }).map(e => e.id || e.className || e.tagName).slice(0, 5); });
  check(16, over.length === 0, 'phone: nothing past the edge ' + JSON.stringify(over));
  await pB.evaluate(() => document.getElementById('scroller').scrollTo(0, 0));
  await pB.screenshot({ path: path.join(SHOTS, 'projects-phone-top.png') });
  // delete from the list
  await pB.tap('#btn-projects');
  await pB.waitForSelector('#pj-list .pj-row', { timeout: 8000 });
  await wait(500);
  await pB.tap('#pj-list .pj-row [data-del]');
  await pB.waitForSelector('#xl-dlg.on');
  const dlg = await pB.evaluate(() => document.getElementById('xl-dlg').innerText);
  await pB.tap('#xl-dlg .xl-o');
  await wait(800);
  check(17, projs().length === 0 && /Photos are not touched/.test(dlg) && !(await pB.evaluate(() => document.querySelector('#pj-list .pj-row'))), 'delete asks first, then removes it everywhere');
  // ── device C: no passcode yet ──
  const ctxC = await device({ width: 390, height: 844 }, true, null);
  const pC = await open(ctxC);
  await pC.setInputFiles('#file-clips', [B]);
  await pC.waitForFunction(() => document.querySelectorAll('.clip').length === 1, null, { timeout: 20000 });
  await pC.waitForFunction(() => /Kept on this device/.test(document.getElementById('proj-st').textContent), null, { timeout: 8000 });
  const loc = await pC.evaluate(() => { const id = localStorage.getItem('xl_studio_last'); return !!id && !!localStorage.getItem('xl_studio_p_' + id); });
  check(18, loc && projs().length === 0, 'no passcode: kept on this device, the bar says so, nothing sent');
  await pC.tap('#proj-name');
  await pC.waitForSelector('#st-key');
  await pC.fill('#st-key', 'gold-shop-77');
  await pC.tap('#xl-dlg .xl-o');
  await pC.waitForFunction(() => /^Saved /.test(document.getElementById('proj-st').textContent), null, { timeout: 8000 });
  check(19, projs().length === 1, 'tap the bar, passcode, and it saves online');
  check(20, errors.length === 0, 'no page errors ' + JSON.stringify(errors.slice(0, 3)));
} catch (e) { console.error(e); fail++; }
await b.close(); server.close();
console.log('\n' + (fail ? 'RESULT FAIL' : 'RESULT PASS') + ' (' + pass + ' pass, ' + fail + ' fail)');
process.exit(fail ? 1 : 0);
