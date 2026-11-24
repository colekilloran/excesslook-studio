// test-cuts.cjs - ST1e. Cole: "I need to remove this black out transition effect. Just a hard cut would look so
// much better. Why can't I edit that?" Cuts are now a choice (Hard Cut default, Dip to Black, Flash), drawn by
// the same drawFrame the export uses. Usage: node test-cuts.cjs <studio.html> [shots-dir]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const FILE = path.resolve(process.argv[2]);
const SHOTS = path.resolve(process.argv[3] || path.join(__dirname, 'shots'));
const FIX = path.join(__dirname, 'fixtures');
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(FIX, { recursive: true });
const mk = (name, args) => { if (!fs.existsSync(path.join(FIX, name))) execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, path.join(FIX, name)]); };
mk('clipB-portrait.mp4', ['-f', 'lavfi', '-i', 'smptebars=size=1080x1920:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
let pass = 0, fail = 0;
const check = (n, ok, msg) => { if (ok) { pass++; console.log('ok   ' + n + ' ' + msg); } else { fail++; console.log('FAIL ' + n + ' ' + msg); } };
(async () => {
  const b = await chromium.launch();
  const errors = [];
  const page = await b.newPage({ viewport: { width: 1180, height: 820 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('https://static.wixstatic.com/**', r => r.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(__dirname, '..', 'vendor', 'logo.png')) }));
  await page.goto('file://' + FILE);
  await page.waitForFunction(() => window.XLStudio && (window.XLStudio.showAll(), true));
  const B = path.join(FIX, 'clipB-portrait.mp4');
  await page.setInputFiles('#file-clips', [B]);
  await page.waitForFunction(() => document.querySelectorAll('.clip').length === 1, null, { timeout: 30000 });
  await page.evaluate(() => { const X = window.XLStudio, S = X.S; S.clips.push(Object.assign({}, S.clips[0], { id: 999, blurs: [] })); });
  await page.click('#tpl-seg [data-tpl="walk"]');
  // brightness of the exact frame the export would draw, at a time t
  const lum = (t) => page.evaluate(async (t) => {
    const X = window.XLStudio, P = X.plan();
    const seg = P.segs.find(s => t >= s.start && t < s.start + s.dur);
    if (seg && seg.clip && seg.clip.el) { const v = seg.clip.el; const want = seg.clip.inT + (t - seg.start); if (Math.abs(v.currentTime - want) > 0.02) await new Promise(r => { v.onseeked = () => { v.onseeked = null; r(); }; v.currentTime = want; }); }
    const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1920; const x = cv.getContext('2d');
    X.drawFrame(x, t, P);
    const d = x.getImageData(200, 300, 680, 600).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return s / (d.length / 4 * 3);
  }, t);
  const P = await page.evaluate(() => { const p = window.XLStudio.plan(); return { b: p.segs[1].start, end: p.clipsEnd, d0: p.segs[0].dur }; });
  const cut = await page.evaluate(() => window.XLStudio.S.cut);
  const on = await page.evaluate(() => document.querySelector('#cut-seg button.on').dataset.cut);
  check(1, cut === 'hard' && on === 'hard', 'Hard Cut is the default and shows selected');
  const mid = await lum(P.b - 1.0), hOut = await lum(P.b - 0.04), hIn = await lum(P.b + 0.03), hEnd = await lum(P.end - 0.04);
  check(2, Math.abs(hOut - mid) < 12 && Math.abs(hIn - mid) < 12 && Math.abs(hEnd - mid) < 12, 'hard cut: no darkening at either side of the cut or before the end card (mid ' + mid.toFixed(0) + ', out ' + hOut.toFixed(0) + ', in ' + hIn.toFixed(0) + ', end ' + hEnd.toFixed(0) + ')');
  await page.click('#cut-seg [data-cut="dip"]');
  const dOut = await lum(P.b - 0.02), dIn = await lum(P.b + 0.01);
  check(3, dOut < mid * 0.35 && dIn < mid * 0.35, 'Dip to Black still there when chosen (out ' + dOut.toFixed(0) + ', in ' + dIn.toFixed(0) + ')');
  await page.click('#cut-seg [data-cut="flash"]');
  const fIn = await lum(P.b + 0.02), fOut = await lum(P.b - 0.04);
  check(4, fIn > mid + 40 && Math.abs(fOut - mid) < 12, 'Flash: white flash into the next shot, no dip out (in ' + fIn.toFixed(0) + ', out ' + fOut.toFixed(0) + ')');
  await page.click('#cut-seg [data-cut="hard"]');
  // an AI plan can set it, and a missing value means hard
  const ap = await page.evaluate(() => { const X = window.XLStudio;
    X.applyPlan({ template: 'walk', cut: 'dip', shots: [{ footage: 1, in: 0, out: 2 }, { footage: 1, in: 1, out: 2.5 }], caption: '', why: '' }); const a = X.S.cut;
    X.applyPlan({ template: 'walk', shots: [{ footage: 1, in: 0, out: 2 }], caption: '', why: '' }); return [a, X.S.cut]; });
  check(5, ap[0] === 'dip' && ap[1] === 'dip', 'an edit that says dip sets it; one that says nothing leaves the choice alone ' + JSON.stringify(ap));
  await page.click('#cut-seg [data-cut="hard"]');
  await page.evaluate(() => document.getElementById('cut-seg').scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: path.join(SHOTS, 'cuts-ipad.png') });
  const ph = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ph.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await ph.route('https://static.wixstatic.com/**', r => r.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(__dirname, '..', 'vendor', 'logo.png')) }));
  await ph.goto('file://' + FILE);
  await ph.waitForFunction(() => window.XLStudio && (window.XLStudio.showAll(), true));
  await ph.evaluate(() => document.getElementById('cut-seg').scrollIntoView({ block: 'center' }));
  const over = await ph.evaluate(() => { const r = document.getElementById('cut-seg').getBoundingClientRect(); return r.right <= document.documentElement.clientWidth + 1; });
  await ph.screenshot({ path: path.join(SHOTS, 'cuts-phone.png') });
  check(6, over && errors.length === 0, 'phone: the three choices fit; no page errors ' + JSON.stringify(errors.slice(0, 2)));
  await b.close();
  console.log('\n' + (fail ? 'RESULT FAIL' : 'RESULT PASS') + ' (' + pass + ' pass, ' + fail + ' fail)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log('RESULT FAIL (crash)'); process.exit(1); });
