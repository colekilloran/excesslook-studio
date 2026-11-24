// test-fullcontrol.cjs - ST1f. Cole: "This editor needs full access to do everything that the renderer [does]. I'm
// tired of it not being able to make an edit for me that it clearly needs to be able to make." An edit plan can set
// every knob, the studio shows a control for each, and the renderer (preview and export) draws them.
// Usage: node test-fullcontrol.cjs <studio.html> [shots-dir]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const FILE = path.resolve(process.argv[2]);
const SHOTS = path.resolve(process.argv[3] || path.join(__dirname, 'shots'));
const FIX = path.join(__dirname, 'fixtures');
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(FIX, { recursive: true });
const mk = (name, args) => { if (!fs.existsSync(path.join(FIX, name))) execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, path.join(FIX, name)]); };
mk('clipA-landscape.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
mk('clipB-portrait.mp4', ['-f', 'lavfi', '-i', 'smptebars=size=1080x1920:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
let pass = 0, fail = 0;
const check = (n, ok, msg) => { if (ok) { pass++; console.log('ok   ' + n + ' ' + msg); } else { fail++; console.log('FAIL ' + n + ' ' + msg); } };
const A = path.join(FIX, 'clipA-landscape.mp4'), B = path.join(FIX, 'clipB-portrait.mp4');
async function open(b, vp, mobile, errors) {
  const page = await b.newPage({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('https://static.wixstatic.com/**', r => r.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(__dirname, '..', 'vendor', 'logo.png')) }));
  await page.goto('file://' + FILE);
  await page.waitForFunction(() => window.XLStudio && (window.XLStudio.showAll(), true));
  await page.setInputFiles('#file-clips', [A, B]);
  await page.waitForFunction(() => document.querySelectorAll('.clip').length === 2, null, { timeout: 30000 });
  return page;
}
// mean brightness of a region of the frame the export would draw at time t (video seeked to the right source time)
const region = (page, t, rx, ry, rw, rh) => page.evaluate(async ([t, rx, ry, rw, rh]) => {
  const X = window.XLStudio, P = X.plan();
  const seg = P.segs.find(s => t >= s.start && t < s.start + s.dur);
  if (seg && seg.clip && seg.clip.el && seg.clip.kind === 'video') {
    const sp = seg.clip.speed || 1, want = Math.min(seg.clip.inT + (t - seg.start) * sp, seg.clip.srcDur - 0.02), v = seg.clip.el;
    if (Math.abs(v.currentTime - want) > 0.02) await new Promise(r => { v.onseeked = () => { v.onseeked = null; r(); }; v.currentTime = want; });
  }
  const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1920; const x = cv.getContext('2d'); x.__sc = 1;
  X.drawFrame(x, t, P);
  const d = x.getImageData(rx, ry, rw, rh).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
  return s / (d.length / 4 * 3);
}, [t, rx, ry, rw, rh]);
(async () => {
  const b = await chromium.launch();
  const errors = [];
  const page = await open(b, { width: 1180, height: 820 }, false, errors);
  check(1, /^ST1[f-z]-/.test(await page.evaluate(() => window.XL_STUDIO_BUILD)), 'build marker');
  // an edit plan using every knob
  const plan = { template: 'walk', cut: 'hard', title: 'Audi R8', service: 'Full Wash',
    look: { headline: 'none', lower: 'off', bg: 'black', shade: false, logo: false, end: true, endLen: 4, cta: 'Book now', tag: 'Newport Beach' },
    shots: [{ footage: 1, in: 0, out: 4, fit: 'fit', speed: 2, motion: 'none', zoom: 1, focus: { x: 0.5, y: 0.5 }, text: 'IS PPF WORTH IT?', text_pos: 'top' },
            { footage: 2, in: 0, out: 3, fit: 'fill', speed: 0.5, motion: 'none', zoom: 2, focus: { x: 0, y: 0 }, text: '', text_pos: 'center' }],
    caption: 'x', hashtags: [], why: 'y' };
  await page.evaluate(p => window.XLStudio.applyPlan(p), plan);
  const st = await page.evaluate(() => { const X = window.XLStudio, P = X.plan(), S = X.S; return { segs: P.segs.map(s => [s.kind, +s.dur.toFixed(2)]), look: S.look, cta: S.cta,
    c0: { sp: S.clips[0].speed, m: S.clips[0].motion, t: S.clips[0].text, tp: S.clips[0].textPos }, c1: { sp: S.clips[1].speed, z: S.clips[1].zoom, fx: S.clips[1].fx, fy: S.clips[1].fy } }; });
  check(2, JSON.stringify(st.segs) === JSON.stringify([['clip', 2], ['clip', 6], ['outro', 4]]), 'speed sets on-screen length (4s at 2x = 2s, 3s at 0.5x = 6s), end card 4s ' + JSON.stringify(st.segs));
  check(3, st.c0.m === 'none' && st.c0.t === 'IS PPF WORTH IT?' && st.c0.tp === 'top' && st.c1.z === 2 && st.c1.fx === 0 && st.look.bg === 'black' && st.look.logo === false && st.cta === 'Book now', 'every knob landed in the studio');
  // speed: 1s into shot 1 shows source second 2
  const srcT = await page.evaluate(() => { const X = window.XLStudio, P = X.plan(), s = P.segs[0]; return +(s.clip.inT + 1 * s.clip.speed).toFixed(2); });
  check(4, srcT === 2, 'at 2x, 1s on screen = 2s of footage');
  // reframe: zoom 2 with focus at the top-left corner pins the picture to the top-left
  const r = await page.evaluate(() => { const c = window.XLStudio.S.clips[1]; const g = window.XLStudio.mediaRect(c, 1, 0, 0); return { x: Math.round(g.x), y: Math.round(g.y), W: Math.round(g.W) }; });
  check(5, r.x === 0 && r.y === 0 && r.W === 2160, 'reframe: zoom 2, focus top-left -> crop pinned to the top-left ' + JSON.stringify(r));
  // background black behind the fit shot: the band above the picture is black, and with blur it is not
  await page.evaluate(() => window.XLStudio.setLook(Object.assign({}, window.XLStudio.S.look, { bg: 'blur' })));
  const topBlur = await region(page, 0.5, 0, 500, 1080, 60);
  await page.evaluate(() => window.XLStudio.setLook(Object.assign({}, window.XLStudio.S.look, { bg: 'black' })));
  const bandBlack = await region(page, 0.5, 0, 500, 1080, 60);
  check(6, bandBlack < 3 && topBlur > 10, 'behind a whole shot: black when set, blurred copy otherwise (black ' + bandBlack.toFixed(1) + ', blur ' + topBlur.toFixed(1) + ')');
  // text: the top band lights up with text, not without
  const withText = await region(page, 0.5, 140, 330, 800, 110);
  await page.evaluate(() => { window.XLStudio.S.clips[0].text = ''; });
  const noText = await region(page, 0.5, 140, 330, 800, 110);
  await page.evaluate(() => { window.XLStudio.S.clips[0].text = 'IS PPF WORTH IT?'; });
  check(7, withText > noText + 15, 'on-screen text drawn at the top (' + withText.toFixed(0) + ' vs ' + noText.toFixed(0) + ')');
  // logo off / on
  const logoOff = await region(page, 0.5, 700, 230, 330, 80);
  await page.evaluate(() => window.XLStudio.setLook(Object.assign({}, window.XLStudio.S.look, { logo: true })));
  const logoOn = await region(page, 0.5, 700, 230, 330, 80);
  check(8, Math.abs(logoOn - logoOff) > 4, 'logo can be turned off (' + logoOff.toFixed(0) + ' vs ' + logoOn.toFixed(0) + ')');
  // end card off: no outro
  await page.evaluate(() => window.XLStudio.setLook(Object.assign({}, window.XLStudio.S.look, { end: false })));
  const noOutro = await page.evaluate(() => window.XLStudio.plan().segs.every(s => s.kind !== 'outro'));
  await page.evaluate(() => window.XLStudio.setLook(Object.assign({}, window.XLStudio.S.look, { end: true })));
  check(9, noOutro, 'end card can be turned off');
  // the controls in the studio set the same knobs
  await page.click('.clip:nth-of-type(1) [data-a="more"]');
  await page.click('.clip:nth-of-type(1) [data-a="speed"][data-v="1.5"]');
  await page.click('.clip:nth-of-type(1) [data-a="motion"][data-v="right"]');
  await page.click('.clip:nth-of-type(1) [data-a="tpos"][data-v="bottom"]');
  await page.evaluate(() => { const i = document.querySelector('.clip [data-a="zoom"]'); i.value = '1.6'; i.dispatchEvent(new Event('input', { bubbles: true })); const t = document.querySelector('.clip [data-a="text"]'); t.value = 'STEP 1: FOAM'; t.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#look [data-look="headline"] [data-v="end"]');
  await page.click('#look [data-look="shade"] [data-v="true"]');
  const ui = await page.evaluate(() => { const S = window.XLStudio.S, c = S.clips[0]; return { sp: c.speed, m: c.motion, tp: c.textPos, z: c.zoom, t: c.text, hl: S.look.headline, sh: S.look.shade }; });
  check(10, ui.sp === 1.5 && ui.m === 'right' && ui.tp === 'bottom' && ui.z === 1.6 && ui.t === 'STEP 1: FOAM' && ui.hl === 'end' && ui.sh === true, 'More + Look controls set the same knobs ' + JSON.stringify(ui));
  await page.evaluate(() => document.querySelector('.clip .more').scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: path.join(SHOTS, 'fullcontrol-ipad-more.png') });
  await page.evaluate(() => document.getElementById('look').scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: path.join(SHOTS, 'fullcontrol-ipad-look.png') });
  // the redo sends the reel as it stands
  const pf = await page.evaluate(() => window.XLStudio.planFromState());
  check(11, pf.shots[0].speed === 1.5 && pf.shots[0].motion === 'right' && pf.shots[0].text === 'STEP 1: FOAM' && pf.look.headline === 'end' && pf.look.background === 'black', 'a redo carries every hand tweak');
  // saved with the reel
  const ps = await page.evaluate(() => window.XLStudio.projState());
  check(12, ps.shots[0].speed === 1.5 && ps.shots[0].motion === 'right' && ps.shots[0].zoom === 1.6 && ps.shots[1].fx === 0 && ps.look.bg === 'black' && ps.look.endLen === 4, 'saved with the reel');
  // a real export follows it: length matches the plan (speed + 4s end card)
  const total = await page.evaluate(() => window.XLStudio.plan().total);
  const b64 = await page.evaluate(async () => { const bl = await window.XLStudio.exportReel(); if (!bl) return null; const u = new Uint8Array(await bl.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); });
  let dur = 0;
  if (b64) { const out = path.join(SHOTS, 'fullcontrol.mp4'); fs.writeFileSync(out, Buffer.from(b64, 'base64')); dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString()); }
  check(13, b64 && Math.abs(dur - total) < 0.2, 'export follows speed and end card length (' + dur.toFixed(2) + 's vs plan ' + total.toFixed(2) + 's)');
  // phone
  const ph = await open(b, { width: 390, height: 844 }, true, errors);
  await ph.evaluate(p => window.XLStudio.applyPlan(p), plan);
  await ph.evaluate(() => document.querySelector('.clip [data-a="more"]').click());
  await ph.waitForSelector('.clip .more');
  const over = await ph.evaluate(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > w + 1 && !e.closest('.xl-toast') && !e.closest('#vid-holder') && !e.closest('#pj-sheet'); }).map(e => e.className || e.tagName).slice(0, 5); });
  await ph.evaluate(() => document.querySelector('.clip .more').scrollIntoView({ block: 'start' }));
  await ph.screenshot({ path: path.join(SHOTS, 'fullcontrol-phone-more.png') });
  await ph.evaluate(() => document.getElementById('look').scrollIntoView({ block: 'start' }));
  await ph.screenshot({ path: path.join(SHOTS, 'fullcontrol-phone-look.png') });
  check(14, over.length === 0, 'phone: nothing past the edge ' + JSON.stringify(over));
  check(15, errors.length === 0, 'no page errors ' + JSON.stringify(errors.slice(0, 2)));
  await b.close();
  console.log('\n' + (fail ? 'RESULT FAIL' : 'RESULT PASS') + ' (' + pass + ' pass, ' + fail + ' fail)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log('RESULT FAIL (crash)'); process.exit(1); });
