// test-iosload.cjs - ST1c. iPhone Safari never fires loadeddata for a picked video until a frame is asked
// for, so ST1b timed out ("Could not open IMG_0594.mov - timed out"). This test makes Chromium act the same
// way (loadeddata is swallowed before the page sees it) and loads a .mov clip through the real file input.
// Usage: node test-iosload.cjs <studio.html> [shots-dir]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const FILE = path.resolve(process.argv[2]);
const SHOTS = path.resolve(process.argv[3] || path.join(__dirname, 'shots'));
const FIX = path.join(__dirname, 'fixtures');
const LOGO_PNG = path.join(__dirname, '..', 'vendor', 'logo.png');
const BEBAS = path.join(__dirname, 'fonts', 'BebasNeue-Regular.ttf');
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(FIX, { recursive: true });
const MOV = path.join(FIX, 'IMG_0594.mov');
if (!fs.existsSync(MOV)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=5',
  '-f', 'lavfi', '-i', 'sine=frequency=500:duration=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-f', 'mov', MOV]);

let pass = 0, fail = 0;
const check = (n, ok, msg) => { if (ok) { pass++; console.log('ok   ' + n + ' ' + msg); } else { fail++; console.log('FAIL ' + n + ' ' + msg); } };

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const page = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: "@font-face{font-family:'Bebas Neue';src:url(https://fonts.gstatic.com/bebas.ttf) format('truetype')}" }));
  await page.route('https://fonts.gstatic.com/**', r => r.fulfill({ contentType: 'font/ttf', body: fs.readFileSync(BEBAS) }));
  await page.route('https://static.wixstatic.com/**', r => r.fulfill({ contentType: 'image/png', body: fs.readFileSync(LOGO_PNG) }));
  // Act like iPhone Safari: the page never hears loadeddata from a video (handler and listeners both dropped).
  await page.addInitScript(() => {
    window.__ldBlocked = 0;
    Object.defineProperty(HTMLMediaElement.prototype, 'onloadeddata', { configurable: true, get() { return null; }, set() { window.__ldBlocked++; } });
    const ael = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (t, ...rest) {
      if (t === 'loadeddata' && this instanceof HTMLMediaElement) { window.__ldBlocked++; return; }
      return ael.call(this, t, ...rest);
    };
  });
  await page.goto('file://' + FILE);
  await page.waitForFunction(() => window.XLStudio);
  const build = await page.evaluate(() => window.XL_STUDIO_BUILD);
  check(1, /^ST1[c-z]-/.test(build), 'build marker ' + build);

  const t0 = Date.now();
  await page.setInputFiles('#file-clips', [MOV]);
  let loaded = true;
  try { await page.waitForFunction(() => window.XLStudio.S.clips.length === 1 && document.querySelectorAll('.clip').length === 1, null, { timeout: 15000 }); }
  catch (e) { loaded = false; }
  const secs = (Date.now() - t0) / 1000;
  check(2, loaded && secs < 12, 'IMG_0594.mov loads with no loadeddata (' + secs.toFixed(1) + 's)');
  if (!loaded) { await b.close(); console.log('\nRESULT FAIL (' + pass + ' pass, ' + (fail) + ' fail)'); process.exit(1); }

  const info = await page.evaluate(() => { const c = window.XLStudio.S.clips[0]; return { k: c.kind, d: +c.srcDur.toFixed(2), w: c.el.videoWidth, inDom: !!c.el.closest('#vid-holder'), fit: c.fit }; });
  check(3, info.k === 'video' && Math.abs(info.d - 5) < 0.2 && info.w === 1080 && info.fit === 'fill', 'clip read right ' + JSON.stringify(info));
  check(4, info.inDom, 'video sits in the off-screen holder on the page');

  // thumbnail is a real frame, not black
  const lit = await page.evaluate(() => new Promise(res => {
    const im = new Image(); im.onload = () => { const cv = document.createElement('canvas'); cv.width = 72; cv.height = 128; const x = cv.getContext('2d'); x.drawImage(im, 0, 0);
      const d = x.getImageData(0, 0, 72, 128).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; res(s / (72 * 128 * 3)); };
    im.src = window.XLStudio.S.sources[0].thumb; }));
  check(5, lit > 20, 'thumbnail shows the picture (mean ' + lit.toFixed(0) + ')');

  // the preview draws it: canvas not black after seeking into the clip
  await page.evaluate(() => window.XLStudio.seekTo(1.2));
  await page.waitForTimeout(1200);
  const pv = await page.evaluate(() => { const cv = document.querySelector('#pv canvas') || document.querySelector('canvas'); const x = cv.getContext('2d'); const d = x.getImageData(0, 0, cv.width, cv.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4 * 3); });
  check(6, pv > 20, 'preview draws the clip (mean ' + pv.toFixed(0) + ')');
  const toast = await page.evaluate(() => (document.querySelector('#xl-toast .tt') || {}).textContent || '');
  check(7, !/Could not open/.test(toast) && errors.length === 0, 'no error toast, no page errors "' + toast + '" ' + JSON.stringify(errors.slice(0, 2)));
  await page.screenshot({ path: path.join(SHOTS, 'iosload-phone.png') });

  await b.close();
  console.log('\n' + (fail ? 'RESULT FAIL' : 'RESULT PASS') + ' (' + pass + ' pass, ' + fail + ' fail)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log('RESULT FAIL (crash)'); process.exit(1); });
