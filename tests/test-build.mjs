// test-build.mjs - ST1r / SC1p Custom Build. Cole: "I have a 2008 Volvo C30 T5 that I plan to PPF with a base color and
// another color as the accent color that will cover sections of the exterior. I am also replacing the interior with all
// white leather ... the waterfall dash and other interior pieces will be ppf'd with the accent color ... white adjustable
// bucket seats ... white interior lighting in some accent areas." Chose: a reusable mode, renders only. Then: "rims will be gloss white as well"
// and ST1s: Cole sent the wheel he is fitting (white 9-spoke) - a Wheel photo slot swaps the design in.
// Real core behind the function URLs; fake Claude and fake OpenAI (scaffold from test-photolight.mjs).
// Usage: node tests/test-build.mjs [studio.html] [shots-dir]
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


mk('interior.jpg', ['-f', 'lavfi', '-i', 'testsrc=size=1600x1066', '-frames:v', '1']);
mk('design.jpg', ['-f', 'lavfi', '-i', 'color=c=0x2255AA:s=1200x800', '-frames:v', '1']);
async function setFilm(page, i, v) { for (const [k, x] of Object.entries(v)) await page.fill('#colors .colr:nth-child(' + i + ') [data-cf="' + k + '"]', x); }
try {
  const page = await open({ width: 1180, height: 820 }, false);
  check(1, /^ST1[r-z]-/.test(await page.evaluate(() => window.XL_STUDIO_BUILD)) && await vis(page, '[data-kind-pick="build"]'), 'build ' + await page.evaluate(() => window.XL_STUDIO_BUILD) + ' - a Custom Build card is on step 1');
  await page.click('[data-kind-pick="build"]');
  const st = await page.evaluate(() => ({ cls: document.body.className, s4: getComputedStyle(document.querySelector('#steps [data-go="4"]')).display, refs: !!document.querySelector('#bd-refs [data-bdadd="design"]') && !!document.querySelector('#bd-refs [data-bdadd="seats"]') }));
  check(2, /k-build/.test(st.cls) && !/k-edit|k-color/.test(st.cls) && st.s4 === 'none' && st.refs && await vis(page, '#bd-car'), 'Custom Build: renders only (no reel step), with the car, design layout and seat photo slots ' + JSON.stringify(st));
  await page.fill('#bd-car', '2008 Volvo C30 T5');
  // films: base, accent, calipers
  for (let i = 0; i < 3; i++) await page.click('#add-color');
  await setFilm(page, 1, { brand: 'GSWF', name: 'Satin White', code: 'GSWF-CG-124S' });
  await setFilm(page, 2, { brand: 'Paltrix', name: 'Phantom White to Gold', code: '1003-H-W07' });
  await setFilm(page, 3, { brand: 'Paltrix', name: 'Milan Gold', code: '1004-J-G07' });
  const roles0 = await page.evaluate(() => window.XLStudio.S.colors.map(c => c.role));
  await page.click('#colors .colr:nth-child(3) [data-a="crole"][data-v="parts"]');
  await page.fill('#colors .colr:nth-child(2) [data-cf="where"]', 'roof, mirrors and the side sections in the design');
  // swatch on the accent
  await page.evaluate(() => { window.__sw = 1; });
  await page.click('#colors .colr:nth-child(2) [data-swadd]').catch(() => {});
  await page.setInputFiles('#file-swatch', path.join(FIX, 'ppf-swatch.jpg'));
  await page.waitForFunction(() => window.XLStudio.S.colors[1].swatches.length === 1, null, { timeout: 8000 });
  await page.click('#colors .colr:nth-child(2) [data-a="cplight"][data-v="shade"]');
  const roles = await page.evaluate(() => window.XLStudio.S.colors.map(c => [c.role, c.where, c.finish]));
  check(3, JSON.stringify(roles0) === '["base","accent","accent"]' && roles[2][0] === 'parts' && /side sections/.test(roles[1][1]) && roles[1][2] === 'color shift',
    'each film gets a role (first is the base) and a place; the Paltrix code sets color shift ' + JSON.stringify(roles));
  // references + interior
  await page.click('[data-bdadd="design"]').catch(() => {});
  await page.setInputFiles('#file-bdref', path.join(FIX, 'design.jpg'));
  await page.waitForFunction(() => window.XLStudio.S.build.design && window.XLStudio.S.build.design.jpg, null, { timeout: 8000 });
  await page.click('[data-bdadd="rims"]').catch(() => {});
  await page.setInputFiles('#file-bdref', path.join(FIX, 'ppf-swatch.jpg'));
  await page.waitForFunction(() => window.XLStudio.S.build.rims && window.XLStudio.S.build.rims.jpg, null, { timeout: 8000 });
  await page.click('#bd-int-on');
  await page.fill('#bd-leather', 'All white leather');
  await page.fill('#bd-seats', 'White adjustable bucket seats');
  await page.fill('#bd-light', 'white LED strips along the dash and footwells');
  await page.click('#colors .colr:nth-child(2) [data-a="crole"][data-v="accent"]');
  await page.fill('#ai-note', 'My own C30 build.');
  await page.fill('#bd-wheels', 'Gloss white');
  check(4, await page.evaluate(() => { const b = window.XLStudio.S.build; return b.car === '2008 Volvo C30 T5' && b.interior.on && b.interior.lighting.includes('LED') && /design/.test(document.getElementById('bd-refs').innerText.toLowerCase()); }), 'the car, design layout and interior plan are kept');
  await page.evaluate(() => document.querySelector('[data-kind="build"]').scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: path.join(SHOTS, 'build-step2-ipad.png') });
  // photos: car + interior
  await page.setInputFiles('#file-clips', [path.join(FIX, 'car-side.jpg'), path.join(FIX, 'interior.jpg')]);
  await page.waitForFunction(() => window.XLStudio.S.sources.length === 2, null, { timeout: 20000 });
  await page.click('#go-settings');
  await page.waitForFunction(() => window.XLStudio.S.colors.every(c => c.research === 'done'), null, { timeout: 30000 });
  const ph = await page.evaluate(() => [...document.querySelectorAll('#cl-photos .cl-ph')].map(b => b.innerText.replace(/\s+/g, ' ')));
  await page.click('#cl-photos .cl-ph:nth-child(2)');   // ext -> int
  const ph2 = await page.evaluate(() => [...document.querySelectorAll('#cl-photos .cl-ph')].map(b => b.innerText.replace(/\s+/g, ' ')));
  check(5, ph.every(x => /EXT/.test(x)) && /EXT/.test(ph2[0]) && /INT/.test(ph2[1]) && /Render the Build/i.test(await page.evaluate(() => document.getElementById('cl-go').innerText)) && !(await vis(page, '#go-reel')),
    'photos are marked Exterior / Interior by tapping; the button says Render the Build ' + JSON.stringify([ph, ph2, await page.evaluate(() => document.getElementById('cl-go').innerText), await vis(page, '#go-reel')]));
  // lights: shade only
  await page.evaluate(() => { window.XLStudio.S.lights = ['shade']; });
  await page.click('#cl-go');
  await page.waitForFunction(() => window.XLStudio.CL.tiles.length && window.XLStudio.CL.tiles.every(t => t.status === 'done'), null, { timeout: 40000 });
  const tiles = await page.evaluate(() => window.XLStudio.CL.tiles.map(t => t.color + '|' + (t.light || '')));
  check(6, JSON.stringify(tiles) === '["Exterior 1|shade","Interior 1 - Day|","Interior 1 - Night|"]' && oa.length === 3, 'renders: each exterior photo in each light, the interior by day and at night ' + JSON.stringify(tiles));
  const ex = oa.find(x => /custom paint protection film design/.test(x.prompt)), inD = oa.find(x => /interior/.test(x.prompt) && !/It is night/.test(x.prompt)), inN = oa.find(x => /It is night/.test(x.prompt));
  check(7, ex && ex.imgs === 4 && /2008 Volvo C30 T5/.test(ex.prompt) && /Base color: wrap every painted body panel not named below in GSWF Satin White GSWF-CG-124S/.test(ex.prompt)
    && /Accent: roof, mirrors and the side sections in the design in Paltrix Phantom White to Gold 1003-H-W07 \(its sample is image 4/.test(ex.prompt) && /Image 2 is a design concept that shows WHERE the accent film goes/.test(ex.prompt)
    && /Brake calipers and exhaust tips: .* in Paltrix Milan Gold 1004-J-G07/.test(ex.prompt) && /open shade/.test(ex.prompt) && /Wheels: replace the wheels with the wheel shown in image 3 - its exact spoke design, spoke count, lip and center cap, in Gloss white/.test(ex.prompt) && !/wheels, tires, glass/.test(ex.prompt) && /ignore any text, labels, swatch boxes/.test(ex.prompt),
    'exterior: real photo + design layout + accent sample; every film in its place with its code ' + (ex ? ex.imgs + ' imgs' : 'none'));
  check(8, inD && inN && inD.imgs === 2 && /All white leather/.test(inD.prompt) && /White adjustable bucket seats/.test(inD.prompt) && /waterfall center stack .* Phantom White to Gold/.test(inD.prompt) && !/Milan Gold|GSWF/.test(inD.prompt)
    && /lit by white LED strips along the dash and footwells/.test(inN.prompt), 'interior: white leather, the bucket seats, the accent film on the waterfall dash; the night render shows the white lighting');
  check(9, filmCalls.length === 3 && filmCalls.some(c => /1004-J-G07 = Milan Gold, Metallic Series/.test(c.messages[0].content.map(x => x.text || '').join(' '))), 'Milan Gold is in the Paltrix catalog now (Metallic series) and research gets it as fact');
  await page.evaluate(() => document.getElementById('cl').scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: path.join(SHOTS, 'build-renders-ipad.png') });
  // re-render one with a change
  await page.fill('#bd-extra', 'accent on the mirror caps too');
  await page.click('#cl-grid [data-rr="0"]');
  await page.waitForFunction(() => window.XLStudio.CL.tiles[0].status === 'done' && window.XLStudio.CL.tiles[0].k === 3, null, { timeout: 30000 });
  check(10, oa.length === 4 && /Change for this render: accent on the mirror caps too/.test(oa[3].prompt) && oa[3].imgs === 4, 're-rendering one angle carries the change note');
  // save
  await page.click('#cl-grid .cl-tile[data-i="2"]');
  const dl = [];
  page.on('download', d => dl.push(d.suggestedFilename()));
  await page.evaluate(() => { navigator.canShare = () => false; });
  await page.click('#bd-save');
  await page.waitForTimeout(1500);
  check(11, dl.length === 2 && dl.includes('build-exterior-1-shade.jpg') && dl.includes('build-interior-1-day.jpg'), 'Save Renders saves the kept ones (a tapped tile is left out) ' + JSON.stringify(dl));
  // saved with the project
  await page.waitForFunction(() => /^Saved /.test(document.getElementById('proj-st').textContent), null, { timeout: 10000 });
  let saved = {};
  for (let k = 0; k < 40; k++) { const e = [...store.m.entries()].find(([x]) => x.startsWith('proj/')); saved = e ? JSON.parse(e[1]) : {}; if (saved.build && saved.build.interior && saved.build.interior.on && saved.build.car) break; await page.waitForTimeout(250); }
  check(12, saved.kind === 'build' && saved.build.car === '2008 Volvo C30 T5' && saved.build.wheels === 'Gloss white' && saved.build.design && saved.build.design.key && saved.build.rims && saved.build.rims.key && Object.values(saved.build.roles).sort().join(',') === 'ext,int' && saved.colors[2].role === 'parts' && /side sections/.test(saved.colors[1].where),
    'the build (car, references, photo roles, film roles and places, interior) saves with the project');
  // phone
  const pp = await open({ width: 390, height: 844 }, true);
  await pp.tap('[data-kind-pick="build"]');
  await pp.tap('#add-color'); await pp.tap('#add-color');
  await pp.tap('#bd-int-on');
  await pp.evaluate(() => document.getElementById('colors').scrollIntoView({ block: 'start' }));
  await pp.screenshot({ path: path.join(SHOTS, 'build-films-phone.png') });
  await pp.evaluate(() => document.querySelector('[data-kind="build"]').scrollIntoView({ block: 'start' }));
  await pp.screenshot({ path: path.join(SHOTS, 'build-step2-phone.png') });
  const o = await pp.evaluate(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > w + 1 && !e.closest('.xl-toast') && !e.closest('#vid-holder') && !e.closest('#pj-sheet') && !e.closest('#card-sheet') && !e.closest('.steps'); }).map(e => e.id || e.className || e.tagName).slice(0, 5); });
  check(13, !o.length, 'phone: nothing past the edge ' + JSON.stringify(o));
  // other kinds untouched
  const cc = await open({ width: 1180, height: 820 }, false);
  await cc.click('[data-kind-pick="color"]');
  await cc.click('#add-color');
  check(14, !(await cc.evaluate(() => !!document.querySelector('#colors [data-a="crole"]'))) && await cc.evaluate(() => document.getElementById('cl-go').innerText.includes('Render Colors')) && !(await vis(cc, '[data-kind="build"]')), 'Color Preview is unchanged (no roles, no build block)');
  check(15, errors.length === 0, 'no page errors ' + JSON.stringify(errors.slice(0, 3)));
} catch (e) { console.error(e); fail++; }
await b.close(); server.close();
console.log('\n' + (fail ? 'RESULT FAIL' : 'RESULT PASS') + ' (' + pass + ' pass, ' + fail + ' fail)');
process.exit(fail ? 1 : 0);
