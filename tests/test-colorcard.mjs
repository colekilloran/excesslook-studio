// test-colorcard.mjs - ST1m. Cole: "i only have sample color cards for the brands of all the colors". Scan a photo of the
// sample card, pick chips, each becomes a color with brand / line / name / code / finish and its own chip as the sample.
// (scaffold from test-wizard.mjs) ST1k. Cole: "the studio needs to be super user friendly. I choose the type of video, then provide
// the initial video and optional ppf/vinyl colors in a secondary slot along with a description, then i am shown the
// other advanced settings i can adjust and then i get the final video which i can make changes to. The ppf colors are
// crucial that they are an exact match ... researching the exact color code ... flake color, texture ... showing how
// lighting changes the color." Real core behind all three function URLs; fake Claude (plan + film research) and fake
// OpenAI. No showAll - this walks the steps as Cole does. Usage: node tests/test-wizard.mjs [studio.html] [shots-dir]
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
const over = page => page.evaluate(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > w + 1 && !e.closest('.xl-toast') && !e.closest('#vid-holder') && !e.closest('#pj-sheet'); }).map(e => e.id || e.className || e.tagName).slice(0, 5); });
try {
  for (const [vp, mobile, nm] of [[{ width: 1180, height: 820 }, false, 'ipad'], [{ width: 390, height: 844 }, true, 'phone']]) {
    const page = await open(vp, mobile);
    await page.click('[data-kind-pick="color"]');
    check(nm === 'ipad' ? 1 : 11, /^ST1[m-z]-/.test(await page.evaluate(() => window.XL_STUDIO_BUILD)) && await vis(page, '#scan-card'), nm + ': step 2 offers Scan a color card');
    await page.click('#scan-card');
    await page.setInputFiles('#file-card', path.join(FIX, 'sample-card.jpg'));
    await page.waitForFunction(() => document.getElementById('card-sheet').classList.contains('on'), null, { timeout: 30000 });
    const sh = await page.evaluate(() => ({ boxes: document.querySelectorAll('#card-wrap .card-box').length, rows: document.getElementById('card-list').innerText, sub: document.getElementById('card-sub').textContent, add: document.getElementById('card-add').disabled }));
    check(nm === 'ipad' ? 2 : 12, sh.boxes === 3 && /Midnight Sapphire/.test(sh.rows) && /P702S/.test(sh.rows) && /label hard to read/.test(sh.rows) && /Paltrix Color PPF - 3 colors found/.test(sh.sub) && sh.add,
      nm + ': the card is read - every chip boxed on the photo and listed with its printed name and code; nothing picked yet', sh);
    await page.click('#card-wrap .card-box[data-chip="0"]');
    await page.click('.card-row[data-chip="1"]');
    await page.click('#card-light [data-plight="shade"]');
    check(nm === 'ipad' ? 3 : 13, (await page.evaluate(() => document.getElementById('card-add').textContent)) === 'Add 2 Colors', nm + ': tap a chip on the photo or in the list to pick it');
    await page.screenshot({ path: path.join(SHOTS, 'colorcard-sheet-' + nm + '.png') });
    await page.click('#card-add');
    await page.waitForFunction(() => window.XLStudio.S.colors.length === 2, null, { timeout: 8000 });
    const cs = await page.evaluate(async () => Promise.all(window.XLStudio.S.colors.map(async c => {
      const im = new Image(); im.src = 'data:image/jpeg;base64,' + c.swatches[0].jpg; await im.decode();
      const cv = document.createElement('canvas'); cv.width = 20; cv.height = 20; const x = cv.getContext('2d'); x.drawImage(im, 0, 0, 20, 20);
      const d = x.getImageData(0, 0, 20, 20).data; let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      return [c.brand, c.line, c.name, c.code, c.finish, Math.round(r / 400), Math.round(g / 400), Math.round(b / 400)]; })));
    check(nm === 'ipad' ? 4 : 14, cs[0].slice(0, 5).join('|') === 'Paltrix|Color PPF|Midnight Sapphire|P701G|gloss' && cs[1].slice(0, 5).join('|') === 'Paltrix|Color PPF|Nardo Grey|P702S|satin'
      && cs[0][7] > cs[0][5] + 60 && Math.abs(cs[1][5] - 107) < 25 && Math.abs(cs[1][7] - 112) < 25,
      nm + ': two colors added, filled in from the card, each with its own chip cut from the photo (blue / grey, no white card edge) ' + JSON.stringify(cs));
    await page.screenshot({ path: path.join(SHOTS, 'colorcard-step2-' + nm + '.png') });
    if (nm === 'ipad') {
      await page.setInputFiles('#file-clips', [path.join(FIX, 'car-side.jpg')]);
      await page.waitForFunction(() => window.XLStudio.S.sources.length === 1, null, { timeout: 20000 });
      const before = filmCalls.length;
      await page.click('#go-settings');
      await page.waitForFunction(() => window.XLStudio.S.colors.every(c => c.research === 'done'), null, { timeout: 30000 });
      const fcs = filmCalls.slice(before);
      check(5, fcs.length === 2 && fcs.every(c => c.messages[0].content[0].type === 'image') && fcs.some(c => /Color code: P701G/.test(c.messages[0].content.slice(-1)[0].text)) && /paltrixppf\.com/.test(fcs[0].system),
        'step 3 researches both with their chip photos and codes (Paltrix site in the brief)');
    }
    if (nm === 'phone') {
      const o = await page.evaluate(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > w + 1 && !e.closest('.xl-toast') && !e.closest('#vid-holder') && !e.closest('#pj-sheet') && !e.closest('#card-sheet'); }).map(e => e.id || e.className || e.tagName).slice(0, 5); });
      check(15, !o.length, 'phone: nothing past the edge ' + JSON.stringify(o));
    }
  }
  check(16, cardCalls.length === 2 && cardCalls[0].messages[0].content[0].type === 'image', 'the card photo reached Claude as an image');
  check(17, errors.length === 0, 'no page errors ' + JSON.stringify(errors.slice(0, 3)));
} catch (e) { console.error(e); fail++; }
await b.close(); server.close();
console.log('\n' + (fail ? 'RESULT FAIL' : 'RESULT PASS') + ' (' + pass + ' pass, ' + fail + ' fail)');
process.exit(fail ? 1 : 0);
