#!/usr/bin/env node
// xlcheck.js - XSLook / pay page build checker.  Usage: node xlcheck.js <file.html>
// Exit code: 0 clean, 1 fault.  Run it WHOLE - never through tail - and read $? from node itself.
//
// 1. Parses every inline <script> block (what node --check does).
// 2. EXECUTES every block in page order in one shared global (a text/deferred block last,
//    as the loader injects it, into a logged-in state with db set), against inert stubs for
//    the browser, DOM and Firebase. Timers, listeners and promise callbacks never fire, so
//    this is top-level execution only - exactly where a block dies and takes every
//    definition after it down with it.
// FAIL: parse error; duplicate top-level declaration across blocks; TDZ access; a
//       ReferenceError for a name the app itself declares; any other throw that stops a
//       block; a top-level name neither the app nor the browser list declares (a typo, or a
//       call stranded by a rename). That last kind is stubbed and the run repeated so
//       nothing after it is masked.
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const file = process.argv[2];
if (!file) { console.error('usage: node xlcheck.js <file.html>'); process.exit(1); }
const src = fs.readFileSync(file, 'utf8');
const lines = src.split('\n');

const blocks = [];
let cur = null;
lines.forEach((ln, i) => {
  if (!cur) {
    const m = ln.match(/^\s*<script(\s[^>]*)?>/);
    if (m && !/\bsrc=/.test(m[0]) && !/<\/script>/.test(ln.slice(m.index + m[0].length))) {
      cur = { start: i + 1, type: (m[0].match(/type="([^"]+)"/) || [])[1] || 'classic', body: [] };
    }
  } else if (/^\s*<\/script>/.test(ln)) {
    cur.end = i + 1; blocks.push(cur); cur = null;
  } else cur.body.push(ln);
});
if (cur) { console.log('FAIL  unterminated <script> opened at line ' + cur.start); process.exit(1); }

let fail = 0;
const out = s => console.log(s);
out(`xlcheck  ${path.basename(file)}  (${lines.length} lines, ${blocks.length} inline blocks)`);
const bm = src.match(/window\.(XL_BUILD|XL_PAY_BUILD|XL_MP_BUILD|XL_STUDIO_BUILD)\s*=\s*'([^']+)'/g) || [];
out(`build    ${bm.length === 1 ? bm[0].replace(/^[^']*'|'$/g, '') : 'MARKER FOUND ' + bm.length + ' TIMES'}`);
if (bm.length !== 1) fail++;

blocks.forEach((b, n) => {
  b.code = b.body.join('\n');
  try { b.script = new vm.Script(b.code, { filename: 'block' + n, lineOffset: b.start }); b.parsed = true; }
  catch (e) {
    const m = (e.stack || '').match(/block\d+:(\d+)/);
    out(`FAIL  block ${n} (lines ${b.start}-${b.end}) does not parse: ${e.message}${m ? ' at line ' + m[1] : ''}`);
    fail++;
  }
});

const appNames = new Set();
for (const m of src.matchAll(/\b(?:function\*?|let|const|var|class)\s+([A-Za-z_$][\w$]*)/g)) appNames.add(m[1]);
for (const m of src.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=[^=]/g)) appNames.add(m[1]);

function stub() {
  const store = Object.create(null);
  const f = function () {};
  return new Proxy(f, {
    get(t, k) {
      if (k in store) return store[k];
      if (k === Symbol.toPrimitive) return () => '';
      if (k === Symbol.iterator) return function* () {};
      if (typeof k === 'symbol') return t[k];
      if (k === 'then') return () => stub();
      if (k === 'length') return 0;
      return (store[k] = stub());
    },
    set(t, k, v) { store[k] = v; return true; },
    has() { return true; },
    apply() { return stub(); },
    construct() { return stub(); },
  });
}
function storage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
           removeItem: k => m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] ?? null,
           get length() { return m.size; } };
}
const BROWSER = ('document navigator location history screen visualViewport performance crypto console CSS ' +
  'firebase Stripe StripeTerminal HTMLElement Element Node Event CustomEvent KeyboardEvent MouseEvent ' +
  'PointerEvent TouchEvent ResizeObserver IntersectionObserver MutationObserver DOMParser XMLSerializer ' +
  'Image Audio Notification FileReader Blob File FormData Headers Request Response AbortController ' +
  'BroadcastChannel Worker matchMedia getComputedStyle getSelection alert confirm prompt open close print ' +
  'scrollTo scrollBy focus blur addEventListener removeEventListener dispatchEvent postMessage ' +
  'innerWidth innerHeight outerWidth outerHeight devicePixelRatio scrollX scrollY pageXOffset pageYOffset ' +
  'name opener parent top frames self navigation speechSynthesis caches indexedDB ' +
  'html2canvas jspdf jsPDF Chart QRCode QRious emailjs').split(/\s+/);
const extraStubs = new Set();

function run() {
  const g = {};
  const ctx = vm.createContext(g);
  const G = vm.runInContext('globalThis', ctx);
  for (const k of BROWSER) g[k] = stub();
  for (const k of extraStubs) g[k] = stub();
  Object.assign(g, {
    window: G, self: G, localStorage: storage(), sessionStorage: storage(),
    setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, requestIdleCallback: () => 0,
    queueMicrotask() {}, fetch: () => new Promise(() => {}),
    atob: s => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: s => Buffer.from(String(s), 'binary').toString('base64'),
    URL, URLSearchParams, TextEncoder, TextDecoder, structuredClone,
  });
  g.document.readyState = 'loading';
  const res = [];
  blocks.forEach((b, n) => {
    if (!b.parsed) { res.push({ n, skipped: true }); return; }
    if (b.type === 'text/deferred') {
      g.document.readyState = 'complete';
      try { vm.runInContext("if (!db) db = firebase.firestore();", ctx); } catch (e) {}
    }
    try { b.script.runInContext(ctx, { timeout: 10000 }); res.push({ n, ok: true }); }
    catch (e) {
      const m = String(e && e.stack || '').match(/block\d+:(\d+)/);
      res.push({ n, err: e, line: m ? +m[1] : null });
    }
  });
  return res;
}

let res;
for (let pass = 0; pass < 200; pass++) {
  res = run();
  let added = false;
  for (const r of res) {
    const e = r.err;
    if (!e || e.name !== 'ReferenceError') continue;
    const m = e.message.match(/^(\S+) is not defined$/);
    if (m && !appNames.has(m[1]) && !extraStubs.has(m[1])) { extraStubs.add(m[1]); added = true; }
  }
  if (!added) break;
}
for (const r of res) {
  const b = blocks[r.n], tag = `block ${r.n} (lines ${b.start}-${b.end}${b.type === 'text/deferred' ? ', deferred' : ''})`;
  if (r.skipped) { out(`FAIL  ${tag}: not executed - does not parse`); continue; }
  if (r.ok) { out(`ok    ${tag}: parses and runs`); continue; }
  const e = r.err, at = r.line ? ` at line ${r.line}: ${(lines[r.line - 1] || '').trim().slice(0, 110)}` : '';
  let why = e.name;
  if (e.name === 'ReferenceError' && /before initialization/.test(e.message)) why = 'TDZ - used before its let/const line ran';
  else if (e.name === 'SyntaxError' && /already been declared/.test(e.message)) why = 'duplicate top-level declaration across blocks';
  else if (e.name === 'ReferenceError') why = 'ReferenceError - the app declares this name, but not by here';
  out(`FAIL  ${tag}: ${why}: ${e.message}${at}`);
  out(`      every top-level statement after that line in block ${r.n} did not run in the browser either.`);
  fail++;
}
if (extraStubs.size) {
  out(`FAIL  undeclared at top level - the app never declares these and they are not on the browser list: ${[...extraStubs].sort().join(', ')}`);
  out(`      a typo or a stranded call; if one really is a browser global, add it to BROWSER in this file.`);
  fail++;
}
out(fail ? `RESULT FAIL (${fail})` : 'RESULT PASS');
process.exit(fail ? 1 : 0);
