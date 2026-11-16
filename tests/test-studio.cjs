// test-studio.js - Reel Studio lab (ST1a). Drives the real page in Chromium:
// loads clips, edits, exports a real MP4 and inspects it with ffprobe/ffmpeg.
// Usage: node test-studio.js <studio.html> [shots-dir]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const FILE = path.resolve(process.argv[2]);
const SHOTS = path.resolve(process.argv[3] || path.join(__dirname, 'shots'));
const FIX = path.join(__dirname, 'fixtures');
const LOGO_PNG = path.join(__dirname, '..', 'vendor', 'logo.png');
const BEBAS = path.join(__dirname, 'fonts', 'BebasNeue-Regular.ttf');
fs.mkdirSync(SHOTS, { recursive: true });
// Fixtures are generated, not stored: two H.264/AAC clips (landscape + portrait), a photo, a music track.
fs.mkdirSync(FIX, { recursive: true });
const mk = (name, args) => { if (!fs.existsSync(path.join(FIX, name))) execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, path.join(FIX, name)]); };
mk('clipA-landscape.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
mk('clipB-portrait.mp4', ['-f', 'lavfi', '-i', 'smptebars=size=1080x1920:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
mk('photo.jpg', ['-f', 'lavfi', '-i', 'mandelbrot=size=1200x1600', '-frames:v', '1']);
mk('music.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=220:duration=10', '-c:a', 'libmp3lame']);

let pass = 0, fail = 0;
const check = (n, ok, msg) => { if (ok) { pass++; console.log('ok   ' + n + ' ' + msg); } else { fail++; console.log('FAIL ' + n + ' ' + msg); } };

async function route(page) {
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css',
    body: "@font-face{font-family:'Bebas Neue';src:url(https://fonts.gstatic.com/bebas.ttf) format('truetype')}" }));
  await page.route('https://fonts.gstatic.com/**', r => r.fulfill({ contentType: 'font/ttf', body: fs.readFileSync(BEBAS) }));
  await page.route('https://static.wixstatic.com/**', r => r.fulfill({ contentType: 'image/png', body: fs.readFileSync(LOGO_PNG) }));
}

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const page = await b.newPage({ viewport: { width: 1180, height: 820 } });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await route(page);
  await page.goto('file://' + FILE);
  await page.waitForFunction(() => window.XLStudio);

  // 1 marker
  const build = await page.evaluate(() => window.XL_STUDIO_BUILD);
  check(1, /^ST1[a-z]-/.test(build), 'build marker ' + build);

  // 2 empty state: export refuses with no clips, says so
  const r0 = await page.evaluate(() => window.XLStudio.exportReel().then(b => b === null));
  await page.waitForTimeout(200);
  const t0 = await page.textContent('#xl-toast .tt');
  check(2, r0 && /Add a clip/.test(t0), 'empty export refused: "' + t0 + '"');

  // 3 add three clips through the real file input
  await page.setInputFiles('#file-clips', [path.join(FIX, 'clipA-landscape.mp4'), path.join(FIX, 'clipB-portrait.mp4'), path.join(FIX, 'photo.jpg')]);
  await page.waitForFunction(() => window.XLStudio.S.clips.length === 3 && document.querySelectorAll('.clip').length === 3, null, { timeout: 30000 });
  const st = await page.evaluate(() => window.XLStudio.S.clips.map(c => ({ k: c.kind, fit: c.fit, d: +(c.outT - c.inT).toFixed(2), src: +c.srcDur.toFixed(2) })));
  check(3, st[0].k === 'video' && st[1].k === 'video' && st[2].k === 'image', 'three clips loaded ' + JSON.stringify(st));
  check(4, st[0].fit === 'fit' && st[1].fit === 'fill', 'landscape clip shows whole, portrait fills');
  const P = await page.evaluate(() => { const p = window.XLStudio.plan(); return { total: p.total, n: p.segs.length }; });
  check(5, Math.abs(P.total - (4 + 3 + 3 + 2.6)) < 0.01 && P.n === 4, 'plan = clips + end card: ' + P.total.toFixed(2) + 's, ' + P.n + ' segments');

  // 6 Before/After default labels on the cards
  const labels = await page.$$eval('.clip .xl-row-txt .t', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check(6, /BEFORE/.test(labels[0]) && /Video/.test(labels[1]) && /AFTER/.test(labels[2]), 'auto labels ' + JSON.stringify(labels));

  // 7 trim: drag clip 1 end to 2.5s through the range input
  await page.$eval('.clip[data-id] input[data-a="out"]', el => { el.value = '2.5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const d1 = await page.evaluate(() => window.XLStudio.S.clips[0].outT);
  const tot2 = await page.evaluate(() => window.XLStudio.plan().total);
  check(7, Math.abs(d1 - 2.5) < 0.01 && Math.abs(tot2 - 11.1) < 0.01, 'trim end -> 2.5s, total ' + tot2.toFixed(2));

  // 8 reorder: move clip 1 down, then back up
  await page.click('.clip:nth-child(1) [data-a="down"]');
  const ord = await page.evaluate(() => window.XLStudio.S.clips.map(c => c.kind + ':' + c.name));
  await page.click('.clip:nth-child(2) [data-a="up"]');
  const ord2 = await page.evaluate(() => window.XLStudio.S.clips.map(c => c.name));
  check(8, /clipB/.test(ord[0]) && /clipA/.test(ord2[0]), 'move down / up ' + JSON.stringify(ord.map(x => x.split(':')[1])));

  // 9 remove with undo
  await page.click('.clip:nth-child(3) [data-a="rm"]');
  const afterRm = await page.evaluate(() => window.XLStudio.S.clips.length);
  await page.click('#xl-toast .tu');
  const afterUndo = await page.evaluate(() => window.XLStudio.S.clips.map(c => c.name));
  check(9, afterRm === 2 && afterUndo.length === 3 && /photo/.test(afterUndo[2]), 'remove then Undo puts it back in place');

  // 10 blur box: add on clip 1, drag it on the preview
  await page.click('.clip:nth-child(1) [data-a="blur"]');
  await page.waitForSelector('.bbox');
  const bb = await page.$eval('.bbox', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.move(bb.x + bb.w / 2, bb.y + bb.h / 2);
  await page.mouse.down(); await page.mouse.move(bb.x + bb.w / 2 - 20, bb.y + bb.h / 2 - 120, { steps: 6 }); await page.mouse.up();
  const blur = await page.evaluate(() => window.XLStudio.S.clips[0].blurs[0]);
  check(10, blur && blur.y < 0.62 - 0.05 && blur.x < 0.3, 'blur box dragged to ' + JSON.stringify(blur && { x: +blur.x.toFixed(3), y: +blur.y.toFixed(3) }));

  // 11 template + text
  await page.click('#tpl-seg [data-tpl="walk"]');
  await page.fill('#f-title', '2024 G-Wagon');
  await page.fill('#f-service', 'Paint Correction + Ceramic Coating');
  const S1 = await page.evaluate(() => ({ t: window.XLStudio.S.tpl, title: window.XLStudio.S.title }));
  check(11, S1.t === 'walk' && S1.title === '2024 G-Wagon', 'template walk + headline set');

  // 12 music
  await page.setInputFiles('#file-music', path.join(FIX, 'music.mp3'));
  await page.waitForFunction(() => window.XLStudio.S.music && document.getElementById('music-vol'));
  check(12, true, 'music track added with volume control');

  // screenshots - iPad landscape: title card, then mid clip with blur box
  await page.evaluate(() => window.XLStudio.seekTo(1.2));
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, 'ipad-walk-title.png') });
  await page.click('#tpl-seg [data-tpl="ba"]');
  await page.click('.clip:nth-child(1) .xl-row-txt');
  await page.evaluate(() => window.XLStudio.seekTo(1.0));
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, 'ipad-ba-blur.png') });
  await page.click('#tp-safe');
  await page.evaluate(() => window.XLStudio.seekTo(9.6));
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, 'ipad-endcard-safe.png') });
  const boxesOnEnd = await page.$$eval('.bbox', e => e.length);
  check('12b', boxesOnEnd === 0, 'blur handles hidden once the reel is past that clip (' + boxesOnEnd + ' shown)');
  await page.click('#tp-safe');

  // 13 play advances time
  await page.evaluate(() => window.XLStudio.seekTo(0));
  await page.click('#tp-play');
  await page.waitForTimeout(900);
  const tPlay = await page.evaluate(() => window.XLStudio.T);
  await page.click('#tp-play');
  check(13, tPlay > 0.5 && tPlay < 1.6, 'play advances the clock (' + tPlay.toFixed(2) + 's after 0.9s)');

  // 14-20 export a real MP4
  await page.click('#tpl-seg [data-tpl="walk"]');
  // put the blur box over the test pattern's checkerboard - the most detail in the frame
  await page.evaluate(() => { const b = window.XLStudio.S.clips[0].blurs[0]; Object.assign(b, { x: 0.62, y: 0.545, w: 0.28, h: 0.075 }); });
  const planTotal = await page.evaluate(() => window.XLStudio.plan().total);
  const t1 = Date.now();
  const b64 = await page.evaluate(async () => {
    const blob = await window.XLStudio.exportReel();
    if (!blob) return null;
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const secs = (Date.now() - t1) / 1000;
  check(14, !!b64, 'export returned an MP4 in ' + secs.toFixed(1) + 's');
  const out = path.join(SHOTS, 'export-test.mp4');
  if (b64) fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  let probe = {};
  try { probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', out]).toString()); } catch (e) { probe = {}; }
  const vs = (probe.streams || []).find(s => s.codec_type === 'video') || {};
  const as = (probe.streams || []).find(s => s.codec_type === 'audio') || {};
  const dur = parseFloat((probe.format || {}).duration);
  check(15, vs.codec_name === 'h264' && vs.width === 1080 && vs.height === 1920, 'video stream ' + vs.codec_name + ' ' + vs.width + 'x' + vs.height + ' ' + vs.profile);
  check(16, Math.abs(dur - planTotal) < 0.15 && Math.abs(planTotal - 11.1) < 0.01, 'duration ' + dur + 's (plan ' + planTotal.toFixed(2) + 's)');
  check(17, !!as.codec_name && +as.sample_rate === 48000 && as.channels === 2, 'audio stream ' + as.codec_name + ' ' + as.sample_rate + 'Hz ' + as.channels + 'ch');
  // full decode, no errors
  let decErr = '';
  try { decErr = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString(); } catch (e) { decErr = String(e.stderr || e); }
  check(18, decErr.trim() === '', 'ffmpeg decodes the whole file cleanly' + (decErr ? ': ' + decErr.slice(0, 200) : ''));
  const res = await page.$eval('#result', e => e.classList.contains('on'));
  const info = await page.textContent('#res-info');
  check(19, res && /1080 x 1920/.test(info), 'result card shown: ' + info);

  // 20 the blur really pixelates: the export's box vs the same frame drawn without the blur
  const frame = path.join(SHOTS, 'export-frame-1s.png');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', '1.0', '-i', out, '-frames:v', '1', frame]);
  const clean = path.join(SHOTS, 'clean-frame-1s.png');
  const cleanB64 = await page.evaluate(async () => {
    const X = window.XLStudio, c = X.S.clips[0], v = c.el, P = X.plan();
    await new Promise(r => { v.addEventListener('seeked', r, { once: true }); v.currentTime = c.inT + 1.0; });
    const keep = c.blurs; c.blurs = [];
    const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1920;
    const x = cv.getContext('2d'); x.__sc = 1; X.drawFrame(x, 1.0, P);
    c.blurs = keep;
    return cv.toDataURL('image/png').split(',')[1];
  });
  fs.writeFileSync(clean, Buffer.from(cleanB64, 'base64'));
  const bl = { x: 0.62, y: 0.545, w: 0.28, h: 0.075 };
  const crop = (f, x, y, w, h) => execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-vf', 'crop=' + w + ':' + h + ':' + x + ':' + y + ',format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
  const bx = Math.round(bl.x * 1080) + 8, by = Math.round(bl.y * 1920) + 8, bw = Math.round(bl.w * 1080) - 16, bh = Math.round(bl.h * 1920) - 16;
  const detail = buf => { let d = 0; for (let i = 1; i < buf.length; i++) if (Math.abs(buf[i] - buf[i - 1]) > 10) d++; return d / buf.length; };
  const inBox = detail(crop(frame, bx, by, bw, bh));
  const cleanBox = detail(crop(clean, bx, by, bw, bh));
  const outside = (f) => detail(crop(f, 60, 700, 300, 120));
  check(20, inBox < cleanBox * 0.4 && Math.abs(outside(frame) - outside(clean)) < 0.05, 'blur box pixelated in the export (detail ' + inBox.toFixed(3) + ' vs ' + cleanBox.toFixed(3) + ' unblurred; outside the box unchanged)');
  await page.screenshot({ path: path.join(SHOTS, 'ipad-result.png') });

  // 21 phone width: layout stacks, nothing wider than the screen
  const ph = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  ph.on('pageerror', e => errors.push(String(e)));
  await route(ph);
  await ph.goto('file://' + FILE);
  await ph.waitForFunction(() => window.XLStudio);
  await ph.setInputFiles('#file-clips', [path.join(FIX, 'clipB-portrait.mp4'), path.join(FIX, 'clipA-landscape.mp4')]);
  await ph.waitForFunction(() => document.querySelectorAll('.clip').length === 2, null, { timeout: 30000 });
  await ph.fill('#f-title', 'Model Y');
  await ph.fill('#f-service', 'Interior Detail');
  await ph.evaluate(() => window.XLStudio.seekTo(0.8));
  await ph.waitForTimeout(900);
  const over = await ph.evaluate(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > w + 1 && !e.closest('.xl-toast'); }).map(e => e.className || e.tagName).slice(0, 5); });
  const cols = await ph.evaluate(() => getComputedStyle(document.querySelector('.studio')).gridTemplateColumns.split(' ').length);
  check(21, over.length === 0 && cols === 1, 'phone: one column, nothing past the edge ' + JSON.stringify(over));
  await ph.screenshot({ path: path.join(SHOTS, 'phone-top.png') });
  await ph.evaluate(() => { const s = document.getElementById('scroller'); s.scrollTop = 760; });
  await ph.waitForTimeout(500);
  await ph.screenshot({ path: path.join(SHOTS, 'phone-clips.png') });

  // 22 no native dialogs, no page errors
  const src = fs.readFileSync(FILE, 'utf8').split('/*@KITJS*/')[0];
  const studioJs = fs.readFileSync(FILE, 'utf8').split("const XL_STUDIO_BUILD")[1] || '';
  const native = /\b(alert|confirm|prompt)\s*\(/.test(studioJs.replace(/K\.confirm\(|XLKit\.confirm\(/g, ''));
  check(22, !native && errors.length === 0, 'no native dialogs, no page errors ' + JSON.stringify(errors.slice(0, 3)));

  await b.close();
  console.log('\n' + (fail ? 'RESULT FAIL' : 'RESULT PASS') + ' (' + pass + ' pass, ' + fail + ' fail)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log('RESULT FAIL (crash)'); process.exit(1); });
