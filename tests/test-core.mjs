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
check(7, req.tool_choice.type === 'auto' && !req.tool_choice.name && req.tools[0].name === 'submit_edit' && req.model === C.DEFAULT_MODEL, 'edit tool offered, not forced (SC1c), default model ' + req.model);
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
check(31, /^SC1[b-z]-/.test(C.CORE_BUILD) && req2.system === C.EDITOR_BRIEF
  && /Excess Look house style/.test(req2.system) && /Hook in the first second/.test(req2.system) && /10 to 25 seconds/.test(req2.system)
  && /0\.7 to 2\.5 seconds/.test(req2.system) && /Flash transitions/.test(req2.system) && /Book now/.test(req2.system), 'the house style rides in the system brief of every request');
check(32, req2.system.indexOf('house style') < req2.system.indexOf('Always follow the owner') && !/\u2014/.test(req2.system), 'the owner\'s own rules still come last and win; no em dashes in the brief');

// 33-35 SC1c - the API refuses a forced tool on newer models, so the request never forces one; a reply
// without the edit is handed back once with a nudge, and the plan from the second reply is used.
const forcedRefused = async (url, opt) => { const b = JSON.parse(opt.body);
  if (b.tool_choice && (b.tool_choice.type === 'tool' || b.tool_choice.type === 'any'))
    return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'tool_choice: type "tool" and "any" are not supported for this model.' } }) };
  return okFetch(url, opt); };
await C.handleApi({ method: 'POST', op: 'frames', query: { job: 'f1', i: '0' }, body: { frames: footage[0].frames }, store, env });
await C.handleApi({ method: 'POST', op: 'frames', query: { job: 'f1', i: '1' }, body: { frames: footage[1].frames }, store, env });
const rf = await C.runPlan({ body: { job: 'f1', footage: meta.slice(0, 2) }, store, fetchImpl: forcedRefused, env });
check(33, rf.ok && /^SC1[c-z]-/.test(C.CORE_BUILD), 'a model that refuses a forced tool still gets the job: ' + (rf.error || 'ok'));
const calls = [];
const lazyFetch = async (url, opt) => { const b = JSON.parse(opt.body); calls.push(b);
  if (calls.length === 1) return { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: 'Here is my thinking about the reel.' }], stop_reason: 'end_turn', usage: { input_tokens: 4000, output_tokens: 50 } }) };
  return okFetch(url, opt); };
await C.handleApi({ method: 'POST', op: 'frames', query: { job: 'f2', i: '0' }, body: { frames: footage[0].frames }, store, env });
await C.handleApi({ method: 'POST', op: 'frames', query: { job: 'f2', i: '1' }, body: { frames: footage[1].frames }, store, env });
const lz = await C.runPlan({ body: { job: 'f2', footage: meta.slice(0, 2) }, store, fetchImpl: lazyFetch, env });
const f2 = await store.get('job/f2', { type: 'json' });
const m2 = calls[1] && calls[1].messages;
check(34, lz.ok && calls.length === 2 && m2.length === 3 && m2[1].role === 'assistant' && /Here is my thinking/.test(m2[1].content[0].text)
  && /Call submit_edit now/.test(m2[2].content[0].text) && f2.plan.shots.length === 2, 'no edit in the first reply -> asked once more, plan from the second');
check(35, f2.usage.in === 9100 && f2.usage.out === 470, 'token use adds up both calls (' + JSON.stringify(f2.usage) + ')');
const never = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: 'no' }], usage: {} }) });
await C.handleApi({ method: 'POST', op: 'frames', query: { job: 'f3', i: '0' }, body: { frames: footage[0].frames }, store, env });
await C.runPlan({ body: { job: 'f3', footage: meta.slice(0, 1) }, store, fetchImpl: never, env });
const f3 = await store.get('job/f3', { type: 'json' });
check(36, f3.status === 'error' && /did not return an edit/.test(f3.error), 'two replies with no edit -> the job says so');

// 37-44 SC1d - saved projects: the edit is saved online, never the footage
check(37, /^SC1[d-z]-/.test(C.CORE_BUILD), 'core ' + C.CORE_BUILD);
const ps = fakeStore();
const proj = { id: 'p1abc', name: 'G-Wagon ceramic', v: 1, len: 14.2, thumb: 'data:image/jpeg;base64,' + 'A'.repeat(200),
  footage: [{ key: 'IMG_0594.mov|52000000|1700000000000', name: 'IMG_0594.mov', size: 52000000, kind: 'video', dur: 28.4 }],
  shots: [{ f: 0, inT: 1.2, outT: 3.4, label: 'BEFORE', fit: 'fill', audio: true, blurs: [{ x: 0.3, y: 0.6, w: 0.2, h: 0.05 }] }],
  tpl: 'ba', title: 'G-Wagon', service: 'Ceramic', cta: 'Book at excesslook.com', tag: 'Newport Beach, CA' };
const sv = await C.handleApi({ method: 'POST', op: 'proj-save', query: {}, body: { project: proj }, store: ps, env });
const gp = await C.handleApi({ method: 'GET', op: 'proj-get', query: { id: 'p1abc' }, store: ps, env });
check(38, sv.status === 200 && gp.status === 200 && gp.json.project.shots[0].label === 'BEFORE' && gp.json.project.shots[0].blurs[0].w === 0.2
  && gp.json.project.footage[0].key === proj.footage[0].key && gp.json.project.created && gp.json.project.updated, 'project saved and read back whole');
const ls = await C.handleApi({ method: 'GET', op: 'proj-list', query: {}, store: ps, env });
check(39, ls.json.projects.length === 1 && ls.json.projects[0].name === 'G-Wagon ceramic' && ls.json.projects[0].shots === 1 && ls.json.projects[0].keys[0] === proj.footage[0].key && !ls.json.projects[0].footageData, 'list line: name, counts, footage keys, thumb');
const created1 = gp.json.project.created;
await new Promise(r => setTimeout(r, 15));
await C.handleApi({ method: 'POST', op: 'proj-save', query: {}, body: { project: Object.assign({}, proj, { name: 'G-Wagon v2', created: 'x' }) }, store: ps, env });
await new Promise(r => setTimeout(r, 15));
await C.handleApi({ method: 'POST', op: 'proj-save', query: {}, body: { project: Object.assign({}, proj, { id: 'p2abc', name: 'Model 3' }) }, store: ps, env });
const ls2 = await C.handleApi({ method: 'GET', op: 'proj-list', query: {}, store: ps, env });
const g2 = await C.handleApi({ method: 'GET', op: 'proj-get', query: { id: 'p1abc' }, store: ps, env });
check(40, ls2.json.projects.length === 2 && ls2.json.projects[0].name === 'Model 3' && g2.json.project.name === 'G-Wagon v2' && g2.json.project.created === created1, 'resave replaces in place, keeps its created date; newest first');
const big = await C.handleApi({ method: 'POST', op: 'proj-save', query: {}, body: { project: Object.assign({}, proj, { id: 'p3', blob: 'x'.repeat(500000) }) }, store: ps, env });
const badId = await C.handleApi({ method: 'POST', op: 'proj-save', query: {}, body: { project: Object.assign({}, proj, { id: '../etc' }) }, store: ps, env });
check(41, big.status === 413 && badId.status === 400, 'too big refused (413), bad id refused (400)');
const badThumb = await C.handleApi({ method: 'POST', op: 'proj-save', query: {}, body: { project: Object.assign({}, proj, { id: 'p4', thumb: 'javascript:alert(1)' }) }, store: ps, env });
const g4 = await C.handleApi({ method: 'GET', op: 'proj-get', query: { id: 'p4' }, store: ps, env });
check(42, badThumb.status === 200 && !g4.json.project.thumb, 'a thumbnail that is not a small JPEG is dropped');
const del = await C.handleApi({ method: 'POST', op: 'proj-del', query: { id: 'p1abc' }, body: {}, store: ps, env });
const g404p = await C.handleApi({ method: 'GET', op: 'proj-get', query: { id: 'p1abc' }, store: ps, env });
const ls3 = await C.handleApi({ method: 'GET', op: 'proj-list', query: {}, store: ps, env });
check(43, del.status === 200 && g404p.status === 404 && !ls3.json.projects.some(x => x.id === 'p1abc'), 'delete removes the project and its list line');
check(44, !store.m.has('projects') && [...ps.m.keys()].every(k => k === 'projects' || k.startsWith('proj/')), 'projects live under proj/ and the index only');

// 45-46 ST1e cuts - hard by default, the editor can set dip / flash, the brief tells it so
const pc0 = C.validatePlan({ template: 'walk', shots: [{ footage: 1, in: 0, out: 2 }] }, footage);
const pc1 = C.validatePlan({ template: 'walk', cut: 'dip', shots: [{ footage: 1, in: 0, out: 2 }] }, footage);
const pc2 = C.validatePlan({ template: 'walk', cut: 'wipe', shots: [{ footage: 1, in: 0, out: 2 }] }, footage);
check(45, pc0.cut === 'hard' && pc1.cut === 'dip' && pc2.cut === 'hard', 'cut: hard unless dip or flash');
const rq = C.buildRequest({ footage, style: { rules: [], examples: [] } });
check(46, rq.tools[0].input_schema.properties.cut.enum.join() === 'hard,dip,flash' && /hard cuts/.test(rq.system) && /never say the studio adds transitions/.test(rq.system), 'the editor knows it sets the cut');

// 47-52 SC1e full control - every renderer knob is a field the editor can set, checked not trusted
check(47, /^SC1[e-z]-/.test(C.CORE_BUILD), 'core ' + C.CORE_BUILD);
const sp = C.PLAN_TOOL.input_schema.properties, shp = sp.shots.items.properties;
check(48, ['speed', 'motion', 'zoom', 'focus', 'text', 'text_pos', 'fit', 'blur', 'label'].every(k => shp[k]) && ['headline', 'lower_third', 'background', 'shade', 'logo', 'end_card', 'end_seconds', 'end_line', 'end_small'].every(k => sp.look.properties[k]) && sp.cut,
  'the edit tool has every per-shot and reel-wide knob');
const fp = C.validatePlan({ template: 'walk', look: { headline: 'none', lower_third: 'off', background: 'black', shade: false, logo: false, end_card: true, end_seconds: 9, end_line: 'Book now', end_small: 'x'.repeat(80), bogus: 1 },
  shots: [{ footage: 1, in: 0, out: 4, speed: 2, motion: 'left', zoom: 2.2, focus: { x: 0.1, y: 0.9 }, text: 'IS PPF WORTH IT?', text_pos: 'top' },
          { footage: 1, in: 0, out: 2, speed: 9, motion: 'spin', zoom: 7, focus: { x: -3 }, text_pos: 'side' }] }, footage);
const f0 = fp.shots[0], f1 = fp.shots[1];
check(49, f0.speed === 2 && f0.motion === 'left' && f0.zoom === 2.2 && f0.focus.x === 0.1 && f0.focus.y === 0.9 && f0.text === 'IS PPF WORTH IT?' && f0.text_pos === 'top', 'shot knobs pass through ' + JSON.stringify(f0).slice(0, 160));
check(50, f1.speed === 9 && f1.motion === 'auto' && f1.zoom === 3 && f1.focus.x === 0 && f1.focus.y === 0.5 && f1.text_pos === 'center', 'out-of-range knobs clamped or defaulted ' + JSON.stringify(f1).slice(0, 160));
check(51, fp.look.headline === 'none' && fp.look.lower === 'off' && fp.look.bg === 'black' && fp.look.shade === false && fp.look.logo === false && fp.look.end === true && fp.look.endLen === 5 && fp.look.cta === 'Book now' && fp.look.tag.length === 40 && !('bogus' in fp.look) && Math.abs(fp.length - (2 + 2 / 9)) < 0.01,
  'look checked; the on-screen length counts speed (' + fp.length + 's)');
const slim = C.slimPlan(fp), rq2 = C.buildRequest({ footage, style: { rules: [], examples: [] } });
check(52, slim.look && slim.shots[0].speed === 2 && slim.shots[0].text && slim.shots[0].focus && /never tell the owner the renderer adds something you cannot change/.test(rq2.system) && /speed \(slow motion or sped up\)/.test(rq2.system),
  'a redo sees every knob; the brief tells the editor it controls them');

// 53-60 SC1f - it learns: the owner's hand changes become lessons; lessons and notes ride on every request
check(53, /^SC1[f-z]-/.test(C.CORE_BUILD), 'core ' + C.CORE_BUILD);
const sp16 = C.validatePlan({ template: 'walk', shots: [{ footage: 1, in: 0, out: 4, speed: 40, what: 'PPF going on the hood' }], footage_notes: [{ footage: 1, what: 'PPF install, hood' }] }, footage);
check(54, sp16.shots[0].speed === 16 && sp16.shots[0].what === 'PPF going on the hood' && sp16.footage_notes[0].what === 'PPF install, hood' && /4 to 16 = time-lapse/.test(C.PLAN_TOOL.input_schema.properties.shots.items.properties.speed.description), 'time-lapse up to 16x; shots and footage carry what they show');
const aiCut = { template: 'walk', cut: 'dip', look: {}, footage_notes: [{ footage: 3, what: 'cutting PPF by hand' }],
  shots: [{ footage: 1, in: 0, out: 8, speed: 4, what: 'polish going on the pad' }, { footage: 2, in: 0, out: 2, speed: 1, what: 'wide shot of the lot' },
          { footage: 1, in: 10, out: 12, speed: 1, what: 'finished hood', text: 'FINISHED', text_pos: 'center' }] };
const fin = { template: 'walk', cut: 'hard', look: { headline: 'auto', lower_third: 'auto', background: 'black', shade: true, logo: true, end_card: true },
  shots: [{ footage: 1, in: 0, out: 4, speed: 1 }, { footage: 3, in: 5, out: 9, speed: 1 }, { footage: 1, in: 10, out: 12, speed: 1, text: 'FINISHED', text_pos: 'top' }] };
const L = C.diffPlans(aiCut, fin), Lt = L.join(' | ');
check(55, /slowed "polish going on the pad" from 4x to real time \(1x\)/.test(Lt) && /removed "wide shot of the lot"/.test(Lt) && /added a shot from F3 \("cutting PPF by hand"\).*at real time/.test(Lt)
  && /moved the text on "finished hood" to the top/.test(Lt) && /cuts from dip to hard/.test(Lt) && /background behind fit shots to black/.test(Lt) && !/logo|shade|service bar|headline/.test(Lt), 'the diff reads like an editor\'s notes: ' + Lt);
check(56, C.diffPlans(aiCut, JSON.parse(JSON.stringify(aiCut))).length === 0, 'no changes -> no lesson');
const ls2store = fakeStore();
await C.handleApi({ method: 'POST', op: 'style', query: {}, body: { rules: ['Hard cuts only'] }, store: ls2store, env });
const ap = await C.handleApi({ method: 'POST', op: 'approve', query: {}, body: { plan: fin, ai: aiCut, note: '' }, store: ls2store, env });
await C.handleApi({ method: 'POST', op: 'feedback', query: {}, body: { text: 'Keep the PPF cutting at real time', plan: fin }, store: ls2store, env });
await C.handleApi({ method: 'POST', op: 'feedback', query: {}, body: { text: 'Hard cuts only', rule: false, plan: fin }, store: ls2store, env });
const stl = await C.handleApi({ method: 'GET', op: 'style', query: {}, store: ls2store, env });
check(57, ap.status === 200 && /slowed/.test(ap.json.lesson) && stl.json.lessons.length === 1 && stl.json.feedback.length === 2, 'export of an AI cut stores the lesson; style lists lessons and notes');
const rqL = C.buildRequest({ footage, style: await C.readStyle(ls2store) });
const tL = rqL.messages[0].content.filter(c => c.type === 'text').map(c => c.text).join('\n');
check(58, /What the owner changed by hand on your recent cuts/.test(tL) && /slowed "polish going on the pad"/.test(tL) && /recent notes on past reels/.test(tL) && /Keep the PPF cutting at real time/.test(tL)
  && (tL.match(/Hard cuts only/g) || []).length === 1, 'the next request carries the lessons and the notes (a note that is already a rule only once)');
check(59, /time-lapse the long stretches/.test(rqL.system) && /real time \(1x\) for the satisfying detail moments/.test(rqL.system), 'the brief explains mixed-speed process reels');
const lat = stl.json.lessons[0].at;
const delL = await C.handleApi({ method: "POST", op: "learn-del", query: {}, body: { kind: "lesson", at: lat }, store: ls2store, env });
const badL = await C.handleApi({ method: "POST", op: "learn-del", query: {}, body: { kind: 'x', at: lat }, store: ls2store, env });
check(60, delL.status === 200 && delL.json.lessons.length === 0 && badL.status === 400, 'a wrong lesson can be forgotten');

// 61-68 SC1g color lineup - recolor renders on OpenAI's image editor, one key per render
check(61, C.CORE_BUILD === 'SC1g-2026-11-23-colorlineup', 'core ' + C.CORE_BUILD);
const pr = C.recolorPrompt('Satin Nardo Grey');
check(62, /Satin Nardo Grey/.test(pr) && /satin finish/.test(pr) && /Keep everything else exactly the same/.test(pr) && /wheels, tires/.test(pr) && /license plate/.test(pr) && /No text, no watermark/.test(pr)
  && /matte finish/.test(C.finishOf('Matte Military Green')) && /chrome/.test(C.finishOf('Gold Chrome')) && /high gloss/.test(C.finishOf('Miami Blue')), 'the prompt names the color and finish and freezes everything else');
check(63, C.renderSize(1600, 1200) === '1536x1024' && C.renderSize(1200, 1600) === '1024x1536' && C.renderSize(1000, 1000) === '1024x1024', 'render size follows the photo shape');
const cs = fakeStore();
const ok1 = await C.handleApi({ method: 'POST', op: 'cl-src', query: { job: 'cj1', i: '0' }, body: { jpg: 'QUJD'.repeat(100), w: 1600, h: 1200 }, store: cs, env });
const bad1 = await C.handleApi({ method: 'POST', op: 'cl-src', query: { job: 'cj1', i: '0' }, body: { jpg: '<script>' }, store: cs, env });
check(64, ok1.status === 200 && bad1.status === 400 && cs.m.has('cl/cj1/src/0'), 'car photo stored; junk refused');
const oaCalls = [];
const fakeOA = async (url, opt) => {
  const fd = opt.body; const fields = {}; for (const [k, v] of fd.entries()) fields[k] = typeof v === 'string' ? v : 'FILE:' + v.size;
  oaCalls.push({ url, auth: opt.headers.Authorization, fields });
  if (/Fail Purple/.test(fields.prompt)) return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'Your request was rejected' } }) };
  return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ b64_json: Buffer.from('jpeg-' + fields.prompt.slice(60, 80)).toString('base64') }], usage: { total_tokens: 100 } }) };
};
const envImg = Object.assign({}, env, { OPENAI_API_KEY: 'sk-oa' });
await C.runRecolor({ body: { job: 'cj1', renders: [{ k: 0, src: 0, color: 'Gloss Miami Blue' }, { k: 1, src: 0, color: 'Fail Purple' }, { k: 2, src: 0, color: 'Satin Black' }, { k: 3, src: 5, color: 'x' }] }, store: cs, fetchImpl: fakeOA, env: envImg });
const clst = await C.handleApi({ method: 'GET', op: 'cl-status', query: { job: 'cj1', ks: '0,1,2,3' }, store: cs, env });
const c0 = oaCalls[0];
check(65, oaCalls.length === 3 && c0.url === 'https://api.openai.com/v1/images/edits' && c0.auth === 'Bearer sk-oa' && c0.fields.model === 'gpt-image-2.5-sunburst' && /^FILE:\d+/.test(c0.fields.image) && c0.fields.size === '1536x1024' && c0.fields.output_format === 'jpeg' && c0.fields.quality === 'medium',
  'OpenAI image edit called with the photo, model, size, jpeg (a render of a missing photo fails on its own) ' + JSON.stringify(c0.fields).slice(0, 120));
const rs = clst.json.renders;
check(66, rs[0].status === 'done' && rs[2].status === 'done' && rs[1].status === 'error' && /400: Your request was rejected/.test(rs[1].error) && rs[3].status === 'error', 'each render has its own status; a refusal says why');
const clim = await C.handleApi({ method: 'GET', op: 'cl-img', query: { job: 'cj1', k: '0' }, store: cs, env });
const im404 = await C.handleApi({ method: 'GET', op: 'cl-img', query: { job: 'cj1', k: '1' }, store: cs, env });
check(67, clim.status === 200 && clim.json.jpg && clim.json.color === 'Gloss Miami Blue' && im404.status === 404, 'finished render readable; failed one 404');
await C.runRecolor({ body: { job: 'cj2', renders: [{ k: 0, src: 0, color: 'Red' }] }, store: cs, fetchImpl: fakeOA, env });
const st2 = await C.handleApi({ method: 'GET', op: 'cl-status', query: { job: 'cj2', ks: '0' }, store: cs, env });
await C.handleApi({ method: 'POST', op: 'cl-drop', query: { job: 'cj1', n: '4', m: '1' }, body: {}, store: cs, env });
check(68, /OPENAI_API_KEY is not set/.test(st2.json.renders[0].error) && ![...cs.m.keys()].some(k => k.startsWith('cl/cj1/')), 'no key says so; cl-drop clears the job');

console.log('\n' + (fail ? 'RESULT FAIL' : 'RESULT PASS') + ' (' + pass + ' pass, ' + fail + ' fail)');
process.exit(fail ? 1 : 0);
