// test-photolight.mjs - ST1n / SC1l. Cole: "I need to be able to tell the studio that the picture of the color card is
// being taken in sunlight, studio light, overcast light or at night so it knows how to read the color better. The last
// grey color I did came out looking lighter than the actual color card and I took the color card photo in direct sunlight.
// I also need to be able to edit the text on every slide. The intro text did not allow me to edit it"
// Real core behind the function URLs; fake Claude and fake OpenAI (scaffold from test-colorcard.mjs).
// Usage: node tests/test-photolight.mjs [studio.html] [shots-dir]
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
mk('sample-card.jpg', ['-f', 'lavfi', '-i', 'color=c=white:s=1200x800', '-vf', 'drawbox=x=120:y=160:w=240:h=240:color=0x1E3A8A:t=fill,drawbox=x=480:y=160:w=240:h=240:color=0x6B6E70:t=fill,drawbox=x=840:y=160:w=240:h=240:color=0xB5121B:t=fill', '-frames:v', '1']);
mk('car-side.jpg', ['-f', 'lavfi', '-i', 'testsrc2=size=1600x1066', '-frames:v', '1']);
mk('ppf-swatch.jpg', ['-f', 'lavfi', '-i', 'color=c=0x3A3D40:s=800x800', '-frames:v', '1']);
mk('clipA-landscape.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
const solid = {};
for (const [k, hex] of [['grey', '0x45484B'], ['purple', '0x3B1F5C']]) {
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
const claude = [], filmCalls = [], oa = [];
const cardCalls = [];
const fakeClaude = async (url, opt) => {
  const b = JSON.parse(opt.body);
  if (b.tools.some(t => t.name === 'submit_card')) {
    cardCalls.push(b); await new Promise(r => setTimeout(r, 300));
    return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_card', input: { brand: 'Paltrix', product_line: 'Color PPF', chips: [
      { name: 'Midnight Sapphire', code: 'P701G', finish: 'gloss', box: { x: 0.1, y: 0.2, w: 0.2, h: 0.3 } },
      { name: 'Nardo Grey', code: 'P702S', finish: 'satin', box: { x: 0.4, y: 0.2, w: 0.2, h: 0.3 } },
      { name: 'Racing Red', code: 'P703G', finish: 'gloss', box: { x: 0.7, y: 0.2, w: 0.2, h: 0.3 }, readable: false }] } }] }) };
  }
  if (b.tools.some(t => t.name === 'submit_film')) {
    filmCalls.push(b);
    const ask = b.messages[0].content.slice(-1)[0].text;
    await new Promise(r => setTimeout(r, 400));
    const purple = /Midnight Purple/.test(ask);
    const input = purple
      ? { brand: 'Inozetek', product_line: 'Super Gloss', color_name: 'Midnight Purple', code: 'SG-MP', film_type: 'vinyl wrap', finish: 'metallic gloss', base_color: 'deep purple, near black in shade',
          hex: { highlight: '#6B3FA0', mid: '#3B1F5C', shadow: '#1A0E29' }, flake: { present: true, color: 'violet-blue', size: 'fine' }, shift: { colors: '' },
          lighting: { sun: 'bright violet with blue flake sparkle', shade: 'deep aubergine, almost black', overcast: 'muted plum', night: 'black with purple streaks' }, render_notes: 'Deep metallic purple...', confidence: 'exact', sources: [{ title: 'Inozetek Midnight Purple', url: 'https://inozetek.com/mp' }] }
      : { brand: '3M', product_line: '2080', color_name: 'Satin Dark Grey', code: '2080-S261', film_type: 'vinyl wrap', finish: 'satin', base_color: 'dark charcoal grey', hex: { highlight: '#6A6D70', mid: '#45484B', shadow: '#2A2C2E' },
          flake: { present: false }, lighting: { sun: 'soft mid grey sheen', shade: 'deep charcoal' }, render_notes: 'Even satin.', confidence: 'close', note: 'S261 is listed as Satin Dark Grey - confirm the roll label.', sources: [{ title: '3M 2080', url: 'https://www.3m.com/2080' }] };
    return { ok: true, status: 200, text: async () => JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'submit_film', input }] }) };
  }
  claude.push(b);
  await new Promise(r => setTimeout(r, 300));
  const input = { template: 'walk', cut: 'hard', title: 'Model 3', service: 'Full Front PPF', shots: [{ footage: 1, in: 0, out: 3, what: 'PPF going on the hood' }], caption: 'Protected.', hashtags: ['ppf'], why: 'Short and clean.' };
  return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_edit', input }], usage: { input_tokens: 1, output_tokens: 1 } }) };
};
const fakeOA = async (url, opt) => {
  const prompt = opt.body.get('prompt'); oa.push({ prompt, imgs: opt.body.getAll('image[]').length });
  await new Promise(r => setTimeout(r, 200));
  return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ b64_json: /Purple/.test(prompt) ? solid.purple : solid.grey }] }) };
};
const html = fs.readFileSync(FILE);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (st, obj, type) => { res.writeHead(st, { 'content-type': type || 'application/json' }); res.end(type ? obj : JSON.stringify(obj)); };
  let raw = ''; for await (const ch of req) raw += ch;
  if (url.pathname === '/') return send(200, html, 'text/html');
  const ok = C.authOk(req.headers['x-studio-key'], env);
  if (url.pathname === '/.netlify/functions/studio-api') {
    if (!ok) return send(401, { error: 'Wrong passcode' });
    let body = null; if (req.method === 'POST') { try { body = JSON.parse(raw); } catch (e) { return send(400, { error: 'Bad JSON' }); } }
    const r = await C.handleApi({ method: req.method, op: url.searchParams.get('op'), query: Object.fromEntries(url.searchParams), body, store, env });
    return send(r.status, r.json);
  }
  const bg = { '/.netlify/functions/studio-plan-background': C.runPlan, '/.netlify/functions/studio-recolor-background': C.runRecolor, '/.netlify/functions/studio-film-background': C.runFilm, '/.netlify/functions/studio-card-background': C.runCard }[url.pathname];
  if (bg) { send(202, {}); if (req.method === 'POST' && ok) bg({ body: JSON.parse(raw), store, fetchImpl: url.pathname.includes('recolor') ? fakeOA : fakeClaude, env }); return; }
  send(404, { error: 'nope' });
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port + '/';
const b = await chromium.launch();
const errors = [];
const vis = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }, sel);
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

const lastAsk = () => filmCalls.slice(-1)[0].messages[0].content.map(x => x.text || '').join(' ');
try {
  const page = await open({ width: 1180, height: 820 }, false);
  check(1, /^ST1[n-z]-/.test(await page.evaluate(() => window.XL_STUDIO_BUILD)), 'build ' + await page.evaluate(() => window.XL_STUDIO_BUILD));
  await page.click('[data-kind-pick="color"]');
  await page.click('#scan-card');
  await page.setInputFiles('#file-card', path.join(FIX, 'sample-card.jpg'));
  await page.waitForFunction(() => document.getElementById('card-sheet').classList.contains('on'), null, { timeout: 30000 });
  check(2, await vis(page, '#card-light') && (await page.evaluate(() => [...document.querySelectorAll('#card-light [data-plight]')].map(b => b.textContent).join('|'))) === 'Sunlight|Shade|Overcast|Studio light|Night',
    'the card sheet asks what light the card photo was taken in: sun, shade, overcast, studio, night');
  await page.click('.card-row[data-chip="1"]');
  const blocked = await page.evaluate(() => ({ t: document.getElementById('card-add').textContent, d: document.getElementById('card-add').disabled, need: document.getElementById('card-light-s').classList.contains('need') }));
  check(3, blocked.t === 'Pick the Light First' && blocked.d && blocked.need, 'a color is picked but Add waits until the light is chosen ' + JSON.stringify(blocked));
  await page.click('#card-light [data-plight="sun"]');
  const ok = await page.evaluate(() => ({ t: document.getElementById('card-add').textContent, d: document.getElementById('card-add').disabled, on: document.querySelector('#card-light .on') && document.querySelector('#card-light .on').dataset.plight, s: document.getElementById('card-light-s').textContent }));
  check(4, ok.t === 'Add 1 Color' && !ok.d && ok.on === 'sun' && /lighter/.test(ok.s), 'Sunlight picked: Add is ready and the tip says sun reads lighter ' + JSON.stringify(ok));
  await page.screenshot({ path: path.join(SHOTS, 'photolight-sheet-ipad.png') });
  await page.click('#card-add');
  await page.waitForFunction(() => window.XLStudio.S.colors.length === 1, null, { timeout: 8000 });
  const col = await page.evaluate(() => ({ pl: window.XLStudio.S.colors[0].photoLight, ui: document.querySelector('#colors .colr .plight') ? document.querySelector('#colors .colr .plight').innerText : '', on: (document.querySelector('#colors [data-a="cplight"].on') || {}).dataset }));
  check(5, col.pl === 'sun' && /Sample photo taken in/i.test(col.ui) && col.on && col.on.v === 'sun', 'the color keeps its photo light and its card shows it, changeable ' + JSON.stringify(col));
  await page.evaluate(() => document.querySelector('#colors .colr').scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: path.join(SHOTS, 'photolight-color-ipad.png') });
  await page.setInputFiles('#file-clips', [path.join(FIX, 'car-side.jpg')]);
  await page.waitForFunction(() => window.XLStudio.S.sources.length === 1, null, { timeout: 20000 });
  await page.click('#go-settings');
  await page.waitForFunction(() => window.XLStudio.S.colors.every(c => c.research === 'done'), null, { timeout: 30000 });
  check(6, filmCalls.length === 1 && filmCalls[0].messages[0].content[0].type === 'image' && /DIRECT SUNLIGHT/.test(lastAsk()) && /DARKER/.test(lastAsk()), 'research is told the sample photo was in direct sun, so the film is darker than it looks');
  await page.click('#cl-go');
  await page.waitForFunction(() => window.XLStudio.CL.tiles.length > 0 && window.XLStudio.CL.tiles.every(t => t.status === 'done'), null, { timeout: 40000 });
  check(7, oa.length >= 1 && oa.every(x => x.imgs === 2 && /DIRECT SUNLIGHT/.test(x.prompt)), 'every render is told the sample photo was sun-lit (' + oa.length + ' renders)');
  // change the light: back to step 2, pick Shade, research runs again with the new reading
  await page.click('#steps [data-go="2"]');
  await page.click('#colors [data-a="cplight"][data-v="shade"]');
  await page.click('#go-settings');
  await page.waitForFunction(() => window.XLStudio.S.colors.every(c => c.research === 'done'), null, { timeout: 30000 });
  await page.waitForFunction(n => window.XLStudio.S.colors[0].research === 'done', 1, { timeout: 30000 });
  check(8, filmCalls.length === 2 && /open shade - close to the film's true color/.test(lastAsk()) && !/DIRECT SUNLIGHT/.test(lastAsk()), 'changing the photo light re-reads the color');
  // the lineup and the intro text
  await page.click('#cl-make');
  await page.waitForFunction(() => window.XLStudio.step === 4, null, { timeout: 20000 });
  const cards = await page.evaluate(() => [...document.querySelectorAll('#clips .clip')].map(el => { const i = el.querySelector('.clip-text [data-a="text"]'); const r = i && i.getBoundingClientRect(); return { v: i ? i.value : null, shown: !!(r && r.width > 0 && r.height > 0), more: !!el.querySelector('.more') }; }));
  check(9, cards.length >= 2 && cards.every(c => c.shown && !c.more) && cards[0].v === 'WHICH COLOR WOULD YOU PICK?', 'every shot card shows its on-screen text right on the card (no More needed), the intro included ' + JSON.stringify(cards));
  await page.evaluate(() => window.XLStudio.S.clips.length && 0);
  const px = () => page.evaluate(() => document.getElementById('pv-canvas').toDataURL('image/png').length);
  await page.click('#clips .clip:nth-of-type(1) .clip-text [data-a="text"]');
  const before = await px();
  await page.fill('#clips .clip:nth-of-type(1) .clip-text [data-a="text"]', 'GREY OR BLUE?');
  let after = before;
  for (let k = 0; k < 30 && after === before; k++) { await page.waitForTimeout(100); after = await px(); }
  const t0 = await page.evaluate(() => window.XLStudio.S.clips[0].text);
  check(10, t0 === 'GREY OR BLUE?' && after !== before, 'the intro text edits straight from its card and the preview redraws ' + JSON.stringify([t0, before, after]));
  await page.click('#clips .clip:nth-of-type(1) [data-a="tpos"][data-v="top"]');
  check(11, (await page.evaluate(() => window.XLStudio.S.clips[0].textPos)) === 'top' && (await page.evaluate(() => document.querySelector('#clips .clip .clip-text [data-a="text"]').value)) === 'GREY OR BLUE?', 'its position moves to Top and the text stays');
  await page.fill('#clips .clip:nth-of-type(2) .clip-text [data-a="text"]', 'NARDO GREY - SATIN');
  check(12, (await page.evaluate(() => window.XLStudio.S.clips[1].text)) === 'NARDO GREY - SATIN', 'a render slide text edits the same way');
  await page.evaluate(() => document.getElementById('clips').scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: path.join(SHOTS, 'photolight-shots-ipad.png') });
  await page.waitForFunction(() => /^Saved /.test(document.getElementById('proj-st').textContent), null, { timeout: 10000 });
  let saved = {};
  for (let k = 0; k < 60; k++) { const e = [...store.m.entries()].find(([x]) => x.startsWith('proj/')); saved = e ? JSON.parse(e[1]) : {}; if (saved.colors && saved.colors[0].photoLight === 'shade' && JSON.stringify(saved).includes('GREY OR BLUE?')) break; await page.waitForTimeout(250); }
  check(13, saved.colors[0].photoLight === 'shade' && JSON.stringify(saved).includes('GREY OR BLUE?'), 'the photo light and the edited text save with the reel');
  // phone
  const ph = await open({ width: 390, height: 844 }, true);
  await ph.click('[data-kind-pick="color"]');
  await ph.click('#scan-card');
  await ph.setInputFiles('#file-card', path.join(FIX, 'sample-card.jpg'));
  await ph.waitForFunction(() => document.getElementById('card-sheet').classList.contains('on'), null, { timeout: 30000 });
  await ph.tap('.card-row[data-chip="0"]');
  await ph.evaluate(() => document.getElementById('card-light').scrollIntoView({ block: 'center' }));
  await ph.screenshot({ path: path.join(SHOTS, 'photolight-sheet-phone.png') });
  await ph.tap('#card-light [data-plight="overcast"]');
  await ph.tap('#card-add');
  await ph.waitForFunction(() => window.XLStudio.S.colors.length === 1, null, { timeout: 8000 });
  await ph.waitForTimeout(700);
  await ph.evaluate(() => document.querySelector('#colors .colr .plight').scrollIntoView({ block: 'center' }));
  await ph.screenshot({ path: path.join(SHOTS, 'photolight-color-phone.png') });
  await ph.setInputFiles('#file-clips', [path.join(FIX, 'clipA-landscape.mp4'), path.join(FIX, 'car-side.jpg')]);
  await ph.waitForFunction(() => window.XLStudio.S.clips.length === 2, null, { timeout: 30000 });
  await ph.evaluate(() => window.XLStudio.setKind && 0);
  const o = await ph.evaluate(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > w + 1 && !e.closest('.xl-toast') && !e.closest('#vid-holder') && !e.closest('#pj-sheet') && !e.closest('#card-sheet'); }).map(e => e.id || e.className || e.tagName).slice(0, 5); });
  check(14, (await ph.evaluate(() => window.XLStudio.S.colors[0].photoLight)) === 'overcast' && !o.length, 'phone: overcast picked and saved on the color; nothing past the edge ' + JSON.stringify(o));
  check(15, errors.length === 0, 'no page errors ' + JSON.stringify(errors.slice(0, 3)));
} catch (e) { console.error(e); fail++; }
await b.close(); server.close();
console.log('\n' + (fail ? 'RESULT FAIL' : 'RESULT PASS') + ' (' + pass + ' pass, ' + fail + ' fail)');
process.exit(fail ? 1 : 0);
