// test-seeit.cjs - ST1d. Cole: "When I make changes to the text on the shots or choosing another template, I don't
// have a button to apply changes". Edits already apply live; on a phone the preview has scrolled away, so a floating
// "See It" button appears after an edit and brings the preview back, playing from the edited spot.
// Usage: node test-seeit.cjs <studio.html> [shots-dir]
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
const mk = (name, args) => { if (!fs.existsSync(path.join(FIX, name))) execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, path.join(FIX, name)]); };
mk('clipA-landscape.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
mk('clipB-portrait.mp4', ['-f', 'lavfi', '-i', 'smptebars=size=1080x1920:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
let pass = 0, fail = 0;
const check = (n, ok, msg) => { if (ok) { pass++; console.log('ok   ' + n + ' ' + msg); } else { fail++; console.log('FAIL ' + n + ' ' + msg); } };
async function open(b, vp, mobile) {
  const page = await b.newPage({ viewport: vp, isMobile: mobile, hasTouch: mobile });
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: "@font-face{font-family:'Bebas Neue';src:url(https://fonts.gstatic.com/bebas.ttf) format('truetype')}" }));
  await page.route('https://fonts.gstatic.com/**', r => r.fulfill({ contentType: 'font/ttf', body: fs.readFileSync(BEBAS) }));
  await page.route('https://static.wixstatic.com/**', r => r.fulfill({ contentType: 'image/png', body: fs.readFileSync(LOGO_PNG) }));
  await page.goto('file://' + FILE);
  await page.waitForFunction(() => window.XLStudio);
  await page.setInputFiles('#file-clips', [path.join(FIX, 'clipA-landscape.mp4'), path.join(FIX, 'clipB-portrait.mp4')]);
  await page.waitForFunction(() => document.querySelectorAll('.clip').length === 2, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  return page;
}
const shown = p => p.evaluate(() => { const b = document.getElementById('see-it'); return !!b && b.classList.contains('on') && getComputedStyle(b).pointerEvents !== 'none'; });
const pvIn = p => p.evaluate(() => { const r = document.getElementById('pv').getBoundingClientRect(); return r.bottom > 60 && r.top < innerHeight - 60; });
const errors = [];
(async () => {
  const b = await chromium.launch();
  const ph = await open(b, { width: 390, height: 844 }, true);
  check(1, /^ST1[d-z]-/.test(await ph.evaluate(() => window.XL_STUDIO_BUILD)) && await ph.evaluate(() => !!document.getElementById('see-it')), 'build marker and the See It button exist');
  check(2, !(await shown(ph)), 'hidden before any edit');
  // scroll down to the second shot and type a label - preview is off screen
  await ph.evaluate(() => { const c = document.querySelectorAll('.clip')[1]; c.scrollIntoView({ block: 'center' }); });
  await ph.waitForTimeout(400);
  const off = !(await pvIn(ph));
  await ph.fill('.clip:nth-of-type(2) input[data-a="label"]', 'After').catch(async () => {
    await ph.evaluate(() => { const i = document.querySelectorAll('.clip')[1].querySelector('input[data-a="label"]'); i.focus(); i.value = 'After'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  });
  await ph.waitForTimeout(600);
  const lbl = await ph.evaluate(() => window.XLStudio.S.clips[1].label);
  check(3, off && lbl === 'After' && await shown(ph), 'label typed with the preview off screen -> See It appears (label applied live: ' + lbl + ')');
  await ph.screenshot({ path: path.join(SHOTS, 'seeit-phone.png') });
  const seg2 = await ph.evaluate(() => window.XLStudio.plan().segs.filter(s => s.kind === 'clip')[1].start);
  await ph.tap('#see-it');
  await ph.waitForTimeout(900);
  const st = await ph.evaluate(() => ({ T: window.XLStudio.T, playing: window.XLStudio.playing, focus: document.activeElement && document.activeElement.tagName }));
  check(4, await pvIn(ph), 'tap -> the preview is back on screen');
  check(5, st.playing && st.T >= seg2 && st.T < seg2 + 2.5, 'plays from the edited shot (T ' + st.T.toFixed(2) + ', shot starts ' + seg2.toFixed(2) + ')');
  check(6, !(await shown(ph)) && st.focus !== 'INPUT', 'button gone, keyboard closed (focus ' + st.focus + ')');
  await ph.screenshot({ path: path.join(SHOTS, 'seeit-phone-after.png') });
  // template change below the fold
  await ph.evaluate(() => window.XLStudio.seekTo(0));
  await ph.evaluate(() => document.querySelector('#tpl-seg').scrollIntoView({ block: 'center' }));
  await ph.waitForTimeout(400);
  await ph.tap('#tpl-seg button[data-tpl="reveal"]');
  await ph.waitForTimeout(500);
  const tplOn = await shown(ph);
  check(7, (await ph.evaluate(() => window.XLStudio.S.tpl)) === 'reveal' && tplOn, 'template applied at once and See It offered');
  // scrolling back up by hand clears it - it does not come back on the way down
  await ph.evaluate(() => { document.getElementById('scroller').scrollTop = 0; });
  await ph.waitForTimeout(500);
  const upHidden = !(await shown(ph));
  await ph.evaluate(() => document.querySelector('#tpl-seg').scrollIntoView({ block: 'center' }));
  await ph.waitForTimeout(500);
  check(8, upHidden && !(await shown(ph)), 'seeing the preview yourself clears it');
  const over = await ph.evaluate(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > w + 1 && !e.closest('.xl-toast') && !e.closest('#vid-holder'); }).map(e => e.id || e.className || e.tagName).slice(0, 5); });
  check(9, over.length === 0, 'phone: nothing past the edge ' + JSON.stringify(over));
  // iPad landscape: the preview stays in view (sticky) - no button needed
  const ip = await open(b, { width: 1180, height: 820 }, false);
  await ip.evaluate(() => { const i = document.querySelectorAll('.clip')[1].querySelector('input[data-a="label"]'); i.focus(); i.value = 'After'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await ip.waitForTimeout(500);
  check(10, (await pvIn(ip)) && !(await shown(ip)), 'iPad landscape: preview stays in view, no button');
  await ip.screenshot({ path: path.join(SHOTS, 'seeit-ipad.png') });
  check(11, errors.length === 0, 'no page errors ' + JSON.stringify(errors.slice(0, 2)));
  await b.close();
  console.log('\n' + (fail ? 'RESULT FAIL' : 'RESULT PASS') + ' (' + pass + ' pass, ' + fail + ' fail)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log('RESULT FAIL (crash)'); process.exit(1); });
