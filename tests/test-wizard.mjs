// test-wizard.mjs - ST1k. Cole: "the studio needs to be super user friendly. I choose the type of video, then provide
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
const fakeClaude = async (url, opt) => {
  const b = JSON.parse(opt.body);
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
  const bg = { '/.netlify/functions/studio-plan-background': C.runPlan, '/.netlify/functions/studio-recolor-background': C.runRecolor, '/.netlify/functions/studio-film-background': C.runFilm }[url.pathname];
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
  // ── Color Preview on the iPad ──
  const page = await open({ width: 1180, height: 820 }, false);
  check(1, /^ST1[k-z]-/.test(await page.evaluate(() => window.XL_STUDIO_BUILD)) && await vis(page, '#kinds') && !(await vis(page, '#drop')) && !(await vis(page, '#pv'))
    && (await page.evaluate(() => [...document.querySelectorAll('#steps button')].map(x => x.disabled).join())) === 'false,true,true,true', 'step 1 shows only the reel types; later steps locked');
  await page.screenshot({ path: path.join(SHOTS, 'wizard-1-ipad.png') });
  await page.click('[data-kind-pick="color"]');
  check(2, (await page.evaluate(() => window.XLStudio.step)) === 2 && await vis(page, '#drop') && await vis(page, '#add-color') && await vis(page, '#ai-note') && !(await vis(page, '#pv')) && !(await vis(page, '#tpl-seg')), 'step 2: footage, colors and the description - nothing else');
  await page.setInputFiles('#file-clips', [path.join(FIX, 'car-side.jpg')]);
  await page.waitForFunction(() => window.XLStudio.S.sources.length === 1, null, { timeout: 20000 });
  await page.click('#add-color');
  await page.fill('.colr:nth-of-type(1) [data-cf="brand"]', 'Inozetek');
  await page.fill('.colr:nth-of-type(1) [data-cf="line"]', 'Super Gloss');
  await page.fill('.colr:nth-of-type(1) [data-cf="name"]', 'Midnight Purple');
  await page.click('.colr:nth-of-type(1) [data-a="cfin"][data-v="metallic"]');
  await page.click('.colr:nth-of-type(1) [data-swadd]');
  await page.setInputFiles('#file-swatch', path.join(FIX, 'ppf-swatch.jpg'));
  await page.waitForFunction(() => window.XLStudio.S.colors[0].swatches.length === 1, null, { timeout: 8000 });
  await page.click('#add-color');
  await page.fill('.colr:nth-of-type(2) [data-cf="brand"]', '3M');
  await page.fill('.colr:nth-of-type(2) [data-cf="line"]', '2080');
  await page.fill('.colr:nth-of-type(2) [data-cf="name"]', 'Satin Dark Grey');
  await page.fill('.colr:nth-of-type(2) [data-cf="code"]', 'S261');
  await page.fill('#ai-note', 'White Model 3, show it in both films.');
  const cs = await page.evaluate(() => window.XLStudio.S.colors.map(c => [c.brand, c.line, c.name, c.code, c.finish, c.swatches.length]));
  check(3, JSON.stringify(cs) === JSON.stringify([['Inozetek', 'Super Gloss', 'Midnight Purple', '', 'metallic', 1], ['3M', '2080', 'Satin Dark Grey', 'S261', '', 0]]), 'two colors entered: brand, line, name, code, finish, a sample photo');
  await page.screenshot({ path: path.join(SHOTS, 'wizard-2-ipad.png'), fullPage: false });
  await page.click('#go-settings');
  check(4, (await page.evaluate(() => window.XLStudio.step)) === 3 && await vis(page, '#pv') && await vis(page, '#film-cards') && await vis(page, '#cl-go') && await vis(page, '#cl-lights') && !(await vis(page, '#btn-auto')), 'step 3: film match, car angles, lighting, settings, Render (not Make My Reel)');
  await page.waitForFunction(() => window.XLStudio.S.colors.every(c => c.research === 'done'), null, { timeout: 30000 });
  const fc = await page.evaluate(() => document.getElementById('film-cards').innerText);
  check(5, filmCalls.length === 2 && /Color code: S261/.test(JSON.stringify(filmCalls)) && filmCalls.some(c => c.messages[0].content[0].type === 'image')
    && /Exact match found/i.test(fc) && /Close match/i.test(fc) && /violet-blue, fine/.test(fc) && /bright violet with blue flake sparkle/.test(fc) && /confirm the roll label/.test(fc) && /Inozetek Midnight Purple/.test(fc),
    'each film researched (code and sample photo sent); the card shows match level, flake, lighting, the note and sources');
  await page.evaluate(() => document.getElementById('film-cards').scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: path.join(SHOTS, 'wizard-3-film-ipad.png') });
  await page.click('#cl-go');
  await page.waitForFunction(() => window.XLStudio.CL.tiles.length === 4 && window.XLStudio.CL.tiles.every(t => t.status === 'done'), null, { timeout: 40000 });
  const pp = oa.find(x => /Midnight Purple/.test(x.prompt) && /midday sun/.test(x.prompt)), gp = oa.find(x => /Satin Dark Grey/.test(x.prompt) && /open shade/.test(x.prompt));
  check(6, oa.length === 4 && pp && pp.imgs === 2 && /Film details \(researched - match them exactly\)/.test(pp.prompt) && /flake: violet-blue, fine/.test(pp.prompt) && /#3B1F5C/.test(pp.prompt) && gp && gp.imgs === 0 && /2080-S261/.test(gp.prompt),
    '2 colors x 2 lights = 4 renders; each carries the researched spec and its lighting; the one with a sample photo sends it');
  await page.click('#cl-make');
  await page.waitForFunction(() => window.XLStudio.step === 4, null, { timeout: 20000 });
  const lin = await page.evaluate(() => window.XLStudio.S.clips.map(c => [c.text, c.label, !!c.render]));
  check(7, lin.length === 5 && lin[0][0] === 'WHICH COLOR WOULD YOU PICK?' && lin[1][0] === 'INOZETEK SUPER GLOSS MIDNIGHT PURPLE' && lin.filter(x => x[1] === 'IN THE SUN').length === 2 && lin.filter(x => x[1] === 'IN THE SHADE').length === 2 && lin.slice(1).every(x => x[2]),
    'Make the Lineup lands on step 4: each color in shade and sun, labeled ' + JSON.stringify(lin));
  check(8, await vis(page, '#clips') && await vis(page, '#btn-export') && await vis(page, '#pv') && !(await vis(page, '#cl-go')), 'step 4: the reel, its shots to change, export');
  await page.screenshot({ path: path.join(SHOTS, 'wizard-4-ipad.png') });
  await page.click('#steps [data-go="3"]');
  check(9, (await page.evaluate(() => window.XLStudio.step)) === 3, 'the step bar goes back to settings');
  // saved with the reel: colors, specs, kind
  await page.waitForFunction(() => /^Saved /.test(document.getElementById('proj-st').textContent), null, { timeout: 10000 });
  const saved = JSON.parse([...store.m.entries()].find(([k]) => k.startsWith('proj/'))[1]);
  check(10, saved.kind === 'color' && saved.colors.length === 2 && saved.colors[0].spec.code === 'SG-MP' && saved.colors[0].swatches.length === 1 && saved.lights.join() === 'shade,sun', 'the reel saves its type, colors with their researched specs, and lights');

  // ── an edited reel (Install / Process) on the phone ──
  const ph = await open({ width: 390, height: 844 }, true);
  await ph.tap('[data-kind-pick="process"]');
  await ph.setInputFiles('#file-clips', [path.join(FIX, 'clipA-landscape.mp4')]);
  await ph.waitForFunction(() => window.XLStudio.S.sources.length === 1, null, { timeout: 20000 });
  await ph.tap('#add-color');
  await ph.fill('[data-cf="brand"]', 'XPEL'); await ph.fill('[data-cf="line"]', 'Ultimate Plus'); await ph.fill('[data-cf="name"]', 'Clear');
  await ph.fill('#ai-note', 'Full front PPF on a white Model 3.');
  const o2 = await over(ph);
  await ph.screenshot({ path: path.join(SHOTS, 'wizard-2-phone.png') });
  await ph.tap('#go-settings');
  check(11, (await ph.evaluate(() => window.XLStudio.step)) === 3 && await vis(ph, '#btn-auto') && !(await vis(ph, '#cl-go')) && !(await vis(ph, '#cl-lights')), 'an edit type gets Make My Reel, no render controls');
  await ph.waitForFunction(() => window.XLStudio.S.colors[0].research === 'done', null, { timeout: 30000 });
  const o3 = await over(ph);
  await ph.screenshot({ path: path.join(SHOTS, 'wizard-3-phone.png') });
  await ph.evaluate(() => document.getElementById('btn-auto').click());
  await ph.waitForFunction(() => window.XLStudio.step === 4, null, { timeout: 40000 });
  const sent = claude[claude.length - 1].messages[0].content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  check(12, /Reel type: Install \/ Process/.test(sent) && /Full front PPF on a white Model 3/.test(sent) && /Film used: XPEL Ultimate Plus Clear/.test(sent), 'Make My Reel sends the type, the description and the film, then opens step 4');
  const o4 = await over(ph);
  await ph.screenshot({ path: path.join(SHOTS, 'wizard-4-phone.png') });
  await ph.tap('#steps [data-go="1"]');
  const o1 = await over(ph);
  await ph.screenshot({ path: path.join(SHOTS, 'wizard-1-phone.png') });
  check(13, [o1, o2, o3, o4].every(x => !x.length), 'phone: no step runs past the edge ' + JSON.stringify([o1, o2, o3, o4]));
  check(14, errors.length === 0, 'no page errors ' + JSON.stringify(errors.slice(0, 3)));
} catch (e) { console.error(e); fail++; }
await b.close(); server.close();
console.log('\n' + (fail ? 'RESULT FAIL' : 'RESULT PASS') + ' (' + pass + ' pass, ' + fail + ' fail)');
process.exit(fail ? 1 : 0);
