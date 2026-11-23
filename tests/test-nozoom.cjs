// test-nozoom.cjs - ST1g. Cole: "the page is zoomed into the top left of the screen and i have to manually zoom
// back out everytime on my phone". iPhone Safari zooms on any focused text field under 16px. Every field the
// studio can show - shot cards, More panel, review, rules, passcode and rename dialogs - must be 16px or more
// on a phone and on a touch iPad. Usage: node test-nozoom.cjs <studio.html> [shots-dir]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const FILE = path.resolve(process.argv[2]);
const FIX = path.join(__dirname, 'fixtures');
fs.mkdirSync(FIX, { recursive: true });
const mk = (name, args) => { if (!fs.existsSync(path.join(FIX, name))) execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, path.join(FIX, name)]); };
mk('clipB-portrait.mp4', ['-f', 'lavfi', '-i', 'smptebars=size=1080x1920:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
let pass = 0, fail = 0;
const check = (n, ok, msg) => { if (ok) { pass++; console.log('ok   ' + n + ' ' + msg); } else { fail++; console.log('FAIL ' + n + ' ' + msg); } };
const small = p => p.evaluate(() => [...document.querySelectorAll('input:not([type=range]):not([type=checkbox]):not([type=file]),textarea,select')]
  .filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).map(e => (e.id || e.dataset.a || e.className || e.tagName) + ' ' + getComputedStyle(e).fontSize));
(async () => {
  const b = await chromium.launch();
  const errors = [];
  let n = 0;
  for (const [vp, label] of [[{ width: 390, height: 844 }, 'phone'], [{ width: 1180, height: 820 }, 'touch iPad landscape']]) {
    const page = await b.newPage({ viewport: vp, isMobile: vp.width < 600, hasTouch: true });
    page.on('pageerror', e => errors.push(String(e)));
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await page.route('https://static.wixstatic.com/**', r => r.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(__dirname, '..', 'vendor', 'logo.png')) }));
    await page.goto('file://' + FILE);
    await page.waitForFunction(() => window.XLStudio);
    await page.setInputFiles('#file-clips', [path.join(FIX, 'clipB-portrait.mp4')]);
    await page.waitForFunction(() => document.querySelectorAll('.clip').length === 1, null, { timeout: 30000 });
    await page.evaluate(() => { document.querySelector('.clip [data-a="more"]').click(); document.getElementById('review').classList.add('on'); });
    await page.waitForSelector('.clip .more');
    const s1 = await small(page);
    check(++n, s1.length === 0, label + ': every field on the page is 16px or more ' + JSON.stringify(s1));
    // the dialogs: rename and passcode
    await page.evaluate(() => document.getElementById('proj-name').click());
    await page.waitForSelector('#xl-dlg.on');
    const s2 = await small(page);
    check(++n, s2.length === 0, label + ': dialog fields too ' + JSON.stringify(s2));
    await page.close();
  }
  check(++n, errors.length === 0, 'no page errors ' + JSON.stringify(errors.slice(0, 2)));
  await b.close();
  console.log('\n' + (fail ? 'RESULT FAIL' : 'RESULT PASS') + ' (' + pass + ' pass, ' + fail + ' fail)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log('RESULT FAIL (crash)'); process.exit(1); });
