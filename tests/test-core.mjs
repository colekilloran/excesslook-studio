// test-core.mjs - Reel Studio server logic, run with fakes for the store and
// the Claude API. Usage: node tests/test-core.mjs
import * as C from '../netlify/lib/studio-core.mjs';

let pass = 0, fail = 0;
const check = (n, ok, msg) => { if (ok) { pass++; console.log('ok   ' + n + ' ' + msg); } else { fail++; console.log('FAIL ' + n + ' ' + msg); } };

export function fakeStore() {
  const m = new Map();
  return {
    m,
    async get(k, o) { if (!m.has(k)) return null; const v = m.get(k); return o && o.type === 'json' ? JSON.parse(v) : v; },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async delete(k) { m.delete(k); }
  };
}
const JPG = '/9j/' + 'A'.repeat(400);
const footage = [
  { name: 'IMG_1.MOV', kind: 'video', dur: 8, w: 1920, h: 1080, frames: [{ t: 1, jpg: JPG }, { t: 4, jpg: JPG }] },
  { name: 'IMG_2.MOV', kind: 'video', dur: 5, w: 1080, h: 1920, frames: [{ t: 2, jpg: JPG }] },
  { name: 'IMG_3.JPG', kind: 'image', dur: 0, w: 1200, h: 1600, frames: [{ t: 0, jpg: JPG }, { t: 0, jpg: 'not base64 <script>' }] }
];
const env = { ANTHROPIC_API_KEY: 'sk-test', STUDIO_PASSCODE: 'gold-shop-77' };

// 1-4 passcode
check(1, C.authOk('gold-shop-77', env), 'right passcode accepted');
check(2, !C.authOk('gold-shop-78', env) && !C.authOk('gold-shop-7', env) && !C.authOk('', env), 'wrong, short and empty refused');
check(3, !C.authOk('', { STUDIO_PASSCODE: '' }) && !C.authOk('abc', { STUDIO_PASSCODE: 'abc' }), 'no passcode (or under 6 characters) set = locked');

// 4-8 request
const req = C.buildRequest({ footage, style: { rules: ['Open on the finished car', ''], examples: [{ summary: 'Reveal, 6 shots' }] },
  prev: { plan: { template: 'ba', shots: [{ footage: 1, in: 0, out: 2 }] }, notes: 'Cut faster' }, want: { note: 'Keep it short', template: 'walk' } });
const content = req.messages[0].content;
const imgs = content.filter(c => c.type === 'image');
const text = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
check(4, imgs.length === 4 && imgs.every(i => i.source.media_type === 'image/jpeg'), 'four good stills sent, the non-image string dropped (' + imgs.length + ')');
check(5, /F1 @ 1\.0s/.test(text) && /F3 - IMG_3\.JPG - photo/.test(text) && /landscape 1920x1080/.test(text), 'every still labeled with footage and time');
check(6, /Open on the finished car/.test(text) && /Reveal, 6 shots/.test(text) && /Cut faster/.test(text) && /Keep it short/.test(text) && /Use the walk template/.test(text), 'rules, approved examples, notes on the last draft and the ask are all in');
check(7, req.tool_choice.name === 'submit_edit' && req.tools[0].name === 'submit_edit' && req.model === C.DEFAULT_MODEL, 'edit tool forced, default model ' + req.model);
check(8, C.buildRequest({ footage, model: 'claude-opus-5-5' }).model === 'claude-opus-5-5', 'STUDIO_MODEL overrides the model');

// 9-14 plan validation
const raw = {
  template: 'nope', title: 'Porsche 911 — GT3', service: 'Paint Correction',
  shots: [
    { footage: 2, in: -3, out: 99, label: 'before' },
    { footage: 9, in: 0, out: 2 },
    { footage: 1, in: 7.9, out: 8.5 },
    { footage: 3, in: 0, out: 30, blur: [{ x: 1.4, y: -1, w: 3, h: 0.1 }] },
    { footage: 1, in: 2, out: 2.1 }
  ],
  caption: 'Mirror finish – booked', hashtags: ['#Ceramic', 'ppf!', '#Ceramic', ''], why: 'Opened on the reveal.'
};
const plan = C.validatePlan(raw, footage);
check(9, plan.template === 'walk' && plan.title === 'Porsche 911 - GT3' && plan.caption === 'Mirror finish - booked', 'bad template falls back, dashes become hyphens');
check(10, plan.shots.length === 3 && plan.shots[0].in === 0 && plan.shots[0].out === 5 && plan.shots[0].label === 'BEFORE', 'out-of-range times clamped, unknown footage dropped, label uppercased');
check(11, plan.shots[1].footage === 1 && plan.shots[1].in === 7.6 && plan.shots[1].out === 8, 'a shot past the end is pulled back inside the footage');
check(12, plan.shots[2].out === 6 && plan.shots[2].blur[0].x === 0.98 && plan.shots[2].blur[0].w <= 0.02 + 1e-9 && plan.shots[2].blur[0].y === 0, 'photo capped at 6s, blur box kept inside the frame');
check(13, plan.hashtags.join(',') === 'Ceramic,ppf', 'hashtags cleaned and de-duplicated: ' + plan.hashtags.join(','));
check(14, plan.shots[1].fit === 'fit' && plan.shots[0].fit === 'fill', 'fit defaults by footage shape');
let threw = ''; try { C.validatePlan({ shots: [{ footage: 7, in: 0, out: 1 }] }, footage); } catch (e) { threw = e.message; }
check(15, /no usable shots/.test(threw), 'a plan with no usable shots is refused: ' + threw);
const long = C.validatePlan({ template: 'walk', shots: Array.from({ length: 24 }, () => ({ footage: 1, in: 0, out: 8 })) }, footage);
check(16, long.length <= 87 && long.shots.length === 10, 'reel capped under 90s (' + long.length + 's, ' + long.shots.length + ' shots)');

// 17-22 the full job through the API and the planner
const store = fakeStore();
let sent = null;
const okFetch = async (url, opt) => {
  sent = { url, headers: opt.headers, body: JSON.parse(opt.body) };
  return { ok: true, status: 200, text: async () => JSON.stringify({
    content: [{ type: 'tool_use', name: 'submit_edit', input: { template: 'ba', title: 'G-Wagon', shots: [{ footage: 1, in: 1, out: 3 }, { footage: 2, in: 0, out: 2 }], caption: 'Before and after.', why: 'Hook on the after.' } }],
    usage: { input_tokens: 5100, output_tokens: 420 } }) };
};
for (let i = 0; i < footage.length; i++) {
  const r = await C.handleApi({ method: 'POST', op: 'frames', query: { job: 'abc123', i: String(i) }, body: { frames: footage[i].frames }, store, env });
  if (r.status !== 200) check('17x', false, 'frames upload ' + i);
}
check(17, store.m.has('frames/abc123/0') && store.m.has('frames/abc123/2'), 'stills stored per footage item');
const meta = footage.map(f => ({ name: f.name, kind: f.kind, dur: f.dur, w: f.w, h: f.h }));
const run = await C.runPlan({ body: { job: 'abc123', footage: meta }, store, fetchImpl: okFetch, env });
const job = await store.get('job/abc123', { type: 'json' });
check(18, run.ok && job.status === 'done' && job.plan.shots.length === 2 && job.usage.in === 5100, 'job done with the plan and token use stored');
check(19, sent.url === 'https://api.anthropic.com/v1/messages' && sent.headers['x-api-key'] === 'sk-test' && sent.headers['anthropic-version'] === '2023-06-01', 'Claude called with the key and API version');
check(20, sent.body.messages[0].content.filter(c => c.type === 'image').length === 4, 'the uploaded stills reached the request');
check(21, !store.m.has('frames/abc123/0') && !store.m.has('frames/abc123/2'), 'stills deleted once the job finished');
const g = await C.handleApi({ method: 'GET', op: 'job', query: { id: 'abc123' }, store, env });
const g404 = await C.handleApi({ method: 'GET', op: 'job', query: { id: 'zzz' }, store, env });
check(22, g.status === 200 && g.json.status === 'done' && g404.status === 404, 'job status readable, unknown job 404');

// 23-25 failures land on the job, never silently
const badFetch = async () => ({ ok: false, status: 529, text: async () => JSON.stringify({ error: { message: 'Overloaded' } }) });
await C.handleApi({ method: 'POST', op: 'frames', query: { job: 'e1', i: '0' }, body: { frames: footage[0].frames }, store, env });
await C.runPlan({ body: { job: 'e1', footage: meta.slice(0, 1) }, store, fetchImpl: badFetch, env });
const e1 = await store.get('job/e1', { type: 'json' });
check(23, e1.status === 'error' && /529: Overloaded/.test(e1.error) && !store.m.has('frames/e1/0'), 'API error recorded on the job: ' + e1.error);
await C.handleApi({ method: 'POST', op: 'frames', query: { job: 'e2', i: '0' }, body: { frames: footage[0].frames }, store, env });
await C.runPlan({ body: { job: 'e2', footage: meta.slice(0, 1) }, store, fetchImpl: okFetch, env: { STUDIO_PASSCODE: 'x' } });
const e2 = await store.get('job/e2', { type: 'json' });
check(24, e2.status === 'error' && /ANTHROPIC_API_KEY/.test(e2.error), 'missing API key says so');
await C.runPlan({ body: { job: 'e3', footage: meta }, store, fetchImpl: okFetch, env });
const e3 = await store.get('job/e3', { type: 'json' });
check(25, e3.status === 'error' && /No stills/.test(e3.error), 'a job with no stills refuses instead of calling the API');

// 26-29 rules, notes, approvals
let r = await C.handleApi({ method: 'POST', op: 'style', body: { rules: ['Keep it under 20 seconds', '  ', 'Open on the reveal'] }, store, env });
check(26, r.json.rules.length === 2, 'rules saved, blanks dropped');
r = await C.handleApi({ method: 'POST', op: 'feedback', body: { text: 'Never show the customer—s house', rule: true, plan: job.plan }, store, env });
check(27, r.json.rules.length === 3 && r.json.rules[2] === 'Never show the customer-s house', 'a note marked as a rule joins the rules');
await C.handleApi({ method: 'POST', op: 'feedback', body: { text: 'Too slow', rule: false, plan: job.plan }, store, env });
await C.handleApi({ method: 'POST', op: 'approve', body: { plan: job.plan }, store, env });
const st = await C.handleApi({ method: 'GET', op: 'style', store, env });
check(28, st.json.rules.length === 3 && st.json.feedback.length === 2 && st.json.examples.length === 1 && /Before\/After, 2 shots, 4\.0s/.test(st.json.examples[0].summary), 'notes logged, approval kept as an example: ' + st.json.examples[0].summary);
const req2 = C.buildRequest({ footage, style: await C.readStyle(store) });
const t2 = req2.messages[0].content.filter(c => c.type === 'text').map(c => c.text).join('\n');
check(29, /Keep it under 20 seconds/.test(t2) && /Before\/After, 2 shots/.test(t2), 'the next request carries the rules and the approved example');
const bad = await C.handleApi({ method: 'POST', op: 'frames', query: { job: '../x', i: '50' }, body: {}, store, env });
check(30, bad.status === 400, 'bad job id or index refused');

// 31-32 SC1b - Cole's signed-off house style is in every request, ahead of his own rules
check(31, C.CORE_BUILD === 'SC1b-2026-11-23-housestyle' && req2.system === C.EDITOR_BRIEF
  && /Excess Look house style/.test(req2.system) && /Hook in the first second/.test(req2.system) && /10 to 25 seconds/.test(req2.system)
  && /0\.7 to 2\.5 seconds/.test(req2.system) && /Flash transitions/.test(req2.system) && /Book now/.test(req2.system), 'the house style rides in the system brief of every request');
check(32, req2.system.indexOf('house style') < req2.system.indexOf('Always follow the owner') && !/\u2014/.test(req2.system), 'the owner\'s own rules still come last and win; no em dashes in the brief');

console.log('\n' + (fail ? 'RESULT FAIL' : 'RESULT PASS') + ' (' + pass + ' pass, ' + fail + ' fail)');
process.exit(fail ? 1 : 0);
