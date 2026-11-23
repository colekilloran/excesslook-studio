// studio-core.mjs - Reel Studio server logic (SC1b-2026-11-23 - house style from Cole's reference reels).
// Everything that matters lives here as plain functions that take their
// dependencies (store, fetch, env) as arguments, so the tests can run them
// with fakes. The Netlify function files are thin wrappers.

export const CORE_BUILD = 'SC1f-2026-11-23-learns';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
const API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_FRAMES = 72;
const MAX_REEL = 90;
const LESSONS_SENT = 15, NOTES_SENT = 10, LESSONS_KEPT = 40;
const MOTIONS = ['auto', 'none', 'slow', 'in', 'out', 'left', 'right', 'up', 'down'];

/* ── auth ─────────────────────────────────────────────────────────────── */
// One shared passcode in a Netlify env var. Compared in constant time so the
// answer time does not leak how much of a guess was right.
export function authOk(given, env) {
  const want = String((env && env.STUDIO_PASSCODE) || '');
  const got = String(given || '');
  if (!want || want.length < 6) return false;            // no passcode set = locked
  let diff = want.length ^ got.length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (i < got.length ? got.charCodeAt(i) : 0);
  return diff === 0;
}

/* ── text hygiene ─────────────────────────────────────────────────────── */
// House wording: hyphens, never em or en dashes.
export const clean = (s, max) => String(s == null ? '' : s)
  .replace(/[—–]/g, '-').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, max || 500);

/* ── the edit plan the model must return ─────────────────────────────── */
export const PLAN_TOOL = {
  name: 'submit_edit',
  description: 'Submit the finished edit for this reel.',
  input_schema: {
    type: 'object',
    properties: {
      template: { type: 'string', enum: ['ba', 'walk', 'reveal'],
        description: 'ba = Before / After (first shot labeled BEFORE, last AFTER). walk = Walkaround (title card then service lower third). reveal = slow push-in, headline on the last shot.' },
      cut: { type: 'string', enum: ['hard', 'dip', 'flash'],
        description: 'How one shot changes to the next. hard = a straight cut (the house style, use it unless the owner asks otherwise). dip = a quick dip to black. flash = a quick white flash.' },
      look: {
        type: 'object',
        description: 'Reel-wide render settings. Leave a field out to keep the template default.',
        properties: {
          headline: { type: 'string', enum: ['auto', 'start', 'card', 'end', 'none'], description: 'Where the headline + service appear. auto = template default (ba start, walk card, reveal end). start = over the first shot. card = a title over the first 2.6 seconds. end = over the last shot. none = not shown.' },
          lower_third: { type: 'string', enum: ['auto', 'on', 'off'], description: 'The service name as a gold-edged bar low on screen after the opening. auto = on for walk only.' },
          background: { type: 'string', enum: ['blur', 'black'], description: 'What fills the frame around fit (whole-frame) shots: a blurred, darkened copy of the shot, or plain black.' },
          shade: { type: 'boolean', description: 'Dark gradient along the bottom so white text reads. Default true.' },
          logo: { type: 'boolean', description: 'The gold Excess Look logo in the top corner. Default true.' },
          end_card: { type: 'boolean', description: 'The branded end card (logo + end line) after the last shot. Default true.' },
          end_seconds: { type: 'number', description: 'End card length, 1.5 to 5 seconds. Default 2.6.' },
          end_line: { type: 'string', description: 'End card main line, max 40 characters. Default "Book at excesslook.com".' },
          end_small: { type: 'string', description: 'End card small line, max 40 characters. Default "Newport Beach, CA".' }
        }
      },
      title: { type: 'string', description: 'Headline, max 40 characters. Usually the vehicle (e.g. "Porsche 911 GT3"). Empty if you cannot tell the vehicle from the footage - never guess a model year.' },
      service: { type: 'string', description: 'Service line, max 48 characters, e.g. "Paint Correction + Ceramic Coating".' },
      shots: {
        type: 'array', minItems: 1, maxItems: 24,
        description: 'The reel in order. Each shot is a piece of one footage item.',
        items: {
          type: 'object',
          properties: {
            footage: { type: 'integer', description: 'Footage number (F#).' },
            in: { type: 'number', description: 'Start time in seconds within that footage.' },
            out: { type: 'number', description: 'End time in seconds within that footage.' },
            label: { type: 'string', description: 'Optional short label shown as a gold pill, max 18 characters, e.g. BEFORE, AFTER, 50/50. Empty for none.' },
            fit: { type: 'string', enum: ['fill', 'fit'], description: 'fill = crop to fill the 9:16 frame (default for vertical footage). fit = show the whole frame over a blurred copy (use for landscape footage when the edges matter).' },
            speed: { type: 'number', description: 'Playback speed, 0.25 to 16. 1 = real time, 0.5 = slow motion, 2 = double, 4 to 16 = time-lapse for long work (a coating or film going on). The shot lasts (out - in) / speed on screen. Sound plays only up to 2x.' },
            what: { type: 'string', description: 'A few words on what this shot shows, e.g. "polish going on the pad", "cutting PPF by hand", "foam on the R8, wide". Used to learn from the owner\'s changes.' },
            motion: { type: 'string', enum: ['auto', 'none', 'slow', 'in', 'out', 'left', 'right', 'up', 'down'],
              description: 'Camera move drawn over the shot. auto = the template default (ba none, walk slow, reveal in). none = locked off. slow = gentle drift-in. in = push-in. out = pull-out. left / right / up / down = slow pan.' },
            zoom: { type: 'number', description: 'Reframe zoom, 1 to 3. 1 = the normal fill or fit; above 1 crops in tighter.' },
            focus: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } },
              description: 'Reframe point in the SOURCE frame, 0-1 (x 0 = left edge, y 0 = top). The crop keeps this point as close to the center as the frame allows. Use it to crop to one side of landscape footage in fill mode, or with zoom to punch in on a detail. Default 0.5, 0.5.' },
            text: { type: 'string', description: 'On-screen text over this shot, max 70 characters, drawn bold white, wrapped to at most 3 lines. Use it for hooks, questions, step names and offers - one idea at a time. Empty for none.' },
            text_pos: { type: 'string', enum: ['top', 'center', 'bottom'], description: 'Where the shot text sits, inside the safe area. Default center.' },
            blur: {
              type: 'array', maxItems: 4,
              description: 'Privacy boxes for license plates and customer faces visible in this shot, in the SOURCE frame: x, y, w, h as fractions 0-1 of the footage frame width and height. Pad each box generously - it stays fixed for the whole shot.',
              items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }, what: { type: 'string' } }, required: ['x', 'y', 'w', 'h'] }
            }
          },
          required: ['footage', 'in', 'out']
        }
      },
      footage_notes: { type: 'array', maxItems: 40, description: 'One short line per footage item on what it shows overall (e.g. F3: "PPF install on the hood, 4 minutes, mostly squeegee").',
        items: { type: 'object', properties: { footage: { type: 'integer' }, what: { type: 'string' } }, required: ['footage', 'what'] } },
      caption: { type: 'string', description: 'Instagram / TikTok caption. Hook line first, 1-3 short lines, a call to book, no hashtags here.' },
      hashtags: { type: 'array', items: { type: 'string' }, maxItems: 15, description: 'Hashtags without the # sign.' },
      why: { type: 'string', description: 'Two or three sentences to the shop owner: what you chose for the hook and why, and anything in the footage you skipped or were unsure about.' }
    },
    required: ['template', 'shots', 'caption', 'why']
  }
};

/* ── the editor's brief ──────────────────────────────────────────────── */
export const EDITOR_BRIEF = [
  'You are the in-house video editor for Excess Look Auto Solutions, a high-end auto detailing and protection shop in Newport Beach, California (paint correction, ceramic coating, PPF, tint, wraps, interiors).',
  'You receive raw footage from a job as sampled stills (each labeled with its footage number and time) and you cut a vertical 9:16 reel for Instagram Reels and TikTok. The studio renders exactly what your edit says, and your edit controls everything it can draw:',
  '- per shot: which footage, in / out, speed (slow motion or sped up), motion (none, slow drift, push-in, pull-out, pans), reframe (zoom + focus point - crop to any side or punch in), fill or fit, on-screen text (top / center / bottom), a gold label pill, privacy blur boxes;',
  '- for the reel: template, cut between shots (hard / dip / flash), where the headline goes or none, the lower third on or off, blurred or black background behind fit shots, the bottom shade, the logo, the end card (on / off, length, both lines), headline, service, caption and hashtags.',
  'So never tell the owner the renderer adds something you cannot change - set it. Only music and sound levels are chosen by the owner in the studio. If the owner asks for something no field above can do, say exactly which thing is missing.',
  '',
  'How a strong detailing reel is cut:',
  '- The first 1.5 seconds decide everything. Open on the single most striking moment: the finished reveal, a 50/50 paint-correction line, foam, water beading, a mirror reflection, a dramatic before. Never open on a wide static shot of a parking lot or a person standing.',
  '- Shots are short: usually 0.8 to 2.5 seconds. Hold the final reveal longer (2.5 to 4 seconds).',
  '- Build a story: problem or before -> process -> result. Process shots (polisher, foam cannon, coating application) are the middle; the clean result is the end.',
  '- Total length 10 to 25 seconds unless the owner asks otherwise (see the house style). Shorter beats longer. Never over 90 seconds.',
  '- Skip anything blurry, dark, shaky, half-blocked, mid-transition, or a shot of the floor. Skip near-duplicates.',
  '- Use before/after (template ba) when the footage has a clear before and after of the same area; walk for a tour of a finished car; reveal for a single dramatic finished car.',
  '- A shot must lie inside one footage item: 0 <= in < out <= that item\'s length. Pick in/out between the sampled times you saw; motion between samples is fine.',
  '- Privacy: if a license plate is readable or a customer\'s face is visible in a shot, add a blur box over it (shop staff working on the car are fine).',
  '- Words: plain, confident, no hype words like "insane" unless the owner\'s rules use them. Use hyphens, never em dashes. US spelling.',
  '- The caption is written as the shop, first line is a hook, end with a short call to book (excesslook.com or DM).',
  '',
  '',
  /* SC1b - Cole signed these off on 2026-11-23 ("im signing off on them now") after six reference
     reels he likes were broken down shot by shot (claude/REEL-STYLE-RULES.md in the XSLook project). */
  'Excess Look house style (the owner approved these from reels he likes - they come before the general advice above):',
  '- Hook in the first second: a bold question or offer as the first text, or a dramatic dirty/clean flash. Never a slow opener.',
  '- Length 10 to 25 seconds. Only a step-by-step process reel (prep -> application -> finished) may run up to about 40 seconds.',
  '- Cut rhythm 0.7 to 2.5 seconds a shot. Hype and transformation reels cut fast and even, as if on the beat; process reels a little slower (about 2.5 seconds).',
  '- Close-ups carry the reel: pad on paint, foam, mitt, brush, squeegee, water beading. Use a wide shot only to place the car or for the final reveal.',
  '- Text: one idea at a time, short, bold, centered in the safe area. Caps for offers and prices. For a process reel, a short caption naming each step.',
  '- End on the finished car, then a short call to book ("Book now"). When it fits, end on the same shot the reel opened with so it loops.',
  '- Process reels mix speeds: time-lapse the long stretches (coating or film going on, a full panel of polishing) at 4x to 16x, and drop to real time (1x) for the satisfying detail moments - polish going on the pad, cutting PPF by hand, the first squeegee pass, a 50/50 line - then go back to the time-lapse. Keep each time-lapse shot 1.5 to 3 seconds on screen.',
  '- Cuts between shots are straight hard cuts (cut = hard). Use dip or flash only when the owner asks for it. You control this - never say the studio adds transitions you cannot change.',
  '- Reel types that work for this shop - pick the one the footage supports: Flash transitions (the same angle dirty then clean, cut back and forth, best with template ba); Hook + proof (a question as the first text, then the close-ups that answer it); Single satisfying take (one long steady shot, no text, when the footage is one clean continuous move); Process with step captions + finished reveal + book now; Offer promo (rotating short offer text over fast foam / wash close-ups).',
  '',
  'Always follow the owner\'s rules below over these defaults. When the owner gave notes on a previous draft, apply every note.'
].join('\n');

/* ── frames in, request out ──────────────────────────────────────────── */
export function cleanFootage(footage) {
  const list = Array.isArray(footage) ? footage : [];
  let budget = MAX_FRAMES;
  return list.slice(0, 40).map((f, i) => {
    const frames = (Array.isArray(f.frames) ? f.frames : [])
      .filter(x => x && typeof x.jpg === 'string' && x.jpg.length > 100 && x.jpg.length < 400000 && /^[A-Za-z0-9+/=]+$/.test(x.jpg.slice(0, 200)))
      .slice(0, 16);
    const take = frames.slice(0, Math.max(1, Math.min(frames.length, budget)));
    budget -= take.length;
    return {
      n: i + 1,
      name: clean(f.name, 80),
      kind: f.kind === 'image' ? 'image' : 'video',
      dur: Math.max(0, Math.min(3600, Number(f.dur) || 0)),
      w: Number(f.w) || 0, h: Number(f.h) || 0,
      audio: f.audio === true ? true : f.audio === false ? false : null,
      frames: budget >= 0 ? take : []
    };
  });
}

export function buildRequest({ footage, style, prev, want, model }) {
  const F = cleanFootage(footage);
  const content = [];
  content.push({ type: 'text', text: 'Raw footage for this reel: ' + F.length + ' item' + (F.length === 1 ? '' : 's') + '. Stills follow, each labeled.' });
  F.forEach(f => {
    const shape = f.w && f.h ? (f.w > f.h ? 'landscape' : f.w < f.h ? 'vertical' : 'square') + ' ' + f.w + 'x' + f.h : '';
    content.push({ type: 'text', text: 'F' + f.n + ' - ' + f.name + ' - ' + (f.kind === 'image' ? 'photo (use 1.5 to 4 seconds)' : 'video ' + f.dur.toFixed(1) + 's') + (shape ? ', ' + shape : '') + (f.kind === 'video' && f.audio === true ? ', has sound' : f.kind === 'video' && f.audio === false ? ', no sound' : '') });
    f.frames.forEach(fr => {
      content.push({ type: 'text', text: 'F' + f.n + ' @ ' + (Number(fr.t) || 0).toFixed(1) + 's' });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fr.jpg } });
    });
  });
  const rules = (style && Array.isArray(style.rules) ? style.rules : []).map(r => clean(r, 300)).filter(Boolean).slice(0, 60);
  const examples = (style && Array.isArray(style.examples) ? style.examples : []).slice(-6);
  let task = '';
  task += rules.length ? 'The owner\'s rules (always follow):\n' + rules.map(r => '- ' + r).join('\n') + '\n\n' : 'The owner has not set any rules yet - use the defaults.\n\n';
  if (examples.length) {
    task += 'Edits the owner approved before (match this taste):\n' + examples.map(e => '- ' + clean(e.summary, 600)).join('\n') + '\n\n';
  }
  const lessons = (style && Array.isArray(style.lessons) ? style.lessons : []).slice(-LESSONS_SENT);
  if (lessons.length) {
    task += 'What the owner changed by hand on your recent cuts before exporting them - learn from these and make those choices yourself next time:\n'
      + lessons.map(l => '- ' + clean(l.text, 500)).join('\n') + '\n\n';
  }
  const ruleSet = new Set(rules.map(r => r.toLowerCase()));
  const notes = (style && Array.isArray(style.feedback) ? style.feedback : []).filter(f => f && f.text && !ruleSet.has(String(f.text).toLowerCase())).slice(-NOTES_SENT);
  if (notes.length) {
    task += 'The owner\'s recent notes on past reels (they show his taste - apply them where they fit this footage):\n' + notes.map(f => '- ' + clean(f.text, 300)).join('\n') + '\n\n';
  }
  if (prev && prev.plan) {
    task += 'Your previous draft of THIS reel:\n' + JSON.stringify(slimPlan(prev.plan)).slice(0, 12000) + '\n';
    task += 'The owner\'s notes on it (apply every one):\n' + clean(prev.notes, 2000) + '\n\n';
  }
  if (want) {
    const w = [];
    if (want.template && ['ba', 'walk', 'reveal'].includes(want.template)) w.push('Use the ' + want.template + ' template.');
    if (want.length && Number(want.length) > 3) w.push('Aim for about ' + Math.round(Number(want.length)) + ' seconds.');
    if (want.title) w.push('Headline: ' + clean(want.title, 40));
    if (want.service) w.push('Service: ' + clean(want.service, 48));
    if (want.note) w.push('Note: ' + clean(want.note, 600));
    if (w.length) task += 'For this reel the owner asked:\n' + w.join('\n') + '\n\n';
  }
  task += 'Now cut the reel and call submit_edit.';
  content.push({ type: 'text', text: task });
  return {
    model: model || DEFAULT_MODEL,
    max_tokens: 16000,
    system: EDITOR_BRIEF,
    tools: [PLAN_TOOL],
    /* SC1c: newer models refuse a forced tool ("tool_choice: type tool and any are not supported for this
       model" - Cole's first real run, 2026-11-23). Auto + the brief's "call submit_edit"; runPlan asks once
       more if the reply has no edit in it. max_tokens raised for models that think before answering. */
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content }]
  };
}

/* ── what comes back is checked, not trusted ─────────────────────────── */
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : (isFinite(parseFloat(v)) ? parseFloat(v) : d));
const cl = (x, a, b) => Math.max(a, Math.min(b, x));
export function validatePlan(raw, footage) {
  const F = cleanFootage(footage);
  if (!raw || typeof raw !== 'object') throw new Error('The editor returned nothing usable');
  const tpl = ['ba', 'walk', 'reveal'].includes(raw.template) ? raw.template : 'walk';
  const shots = [];
  let total = 0;
  (Array.isArray(raw.shots) ? raw.shots : []).forEach(s => {
    const n = Math.round(num(s && s.footage, 0));
    const f = F.find(x => x.n === n);
    if (!f) return;
    let a, b;
    const speed = f.kind === 'image' ? 1 : cl(num(s.speed, 1), 0.25, 16);
    if (f.kind === 'image') { a = 0; b = cl(num(s.out, 3) - num(s.in, 0), 1, 6); }
    else {
      a = cl(num(s.in, 0), 0, Math.max(0, f.dur - 0.4));
      b = cl(num(s.out, a + 2), a + 0.4, f.dur || a + 0.4);
      if (b - a < 0.4) return;
    }
    const onScreen = (b - a) / speed;
    if (total + onScreen > MAX_REEL - 3) return;
    total += onScreen;
    const fo = s.focus && typeof s.focus === 'object' ? s.focus : {};
    const blur = (Array.isArray(s.blur) ? s.blur : []).slice(0, 4).map(r => {
      const x = cl(num(r.x, 0), 0, 0.98), y = cl(num(r.y, 0), 0, 0.98);
      return { x, y, w: cl(num(r.w, 0.1), 0.02, 1 - x), h: cl(num(r.h, 0.05), 0.02, 1 - y), what: clean(r.what, 30) };
    });
    shots.push({
      footage: n, in: +a.toFixed(2), out: +b.toFixed(2),
      label: clean(s.label, 18).toUpperCase(),
      fit: s.fit === 'fit' ? 'fit' : (s.fit === 'fill' ? 'fill' : (f.w > f.h * 1.05 ? 'fit' : 'fill')),
      speed: +speed.toFixed(2),
      motion: MOTIONS.includes(s.motion) ? s.motion : 'auto',
      zoom: +cl(num(s.zoom, 1), 1, 3).toFixed(2),
      focus: { x: +cl(num(fo.x, 0.5), 0, 1).toFixed(3), y: +cl(num(fo.y, 0.5), 0, 1).toFixed(3) },
      text: clean(s.text, 70),
      what: clean(s.what, 60),
      text_pos: ['top', 'center', 'bottom'].includes(s.text_pos) ? s.text_pos : 'center',
      blur
    });
  });
  if (!shots.length) throw new Error('The editor picked no usable shots');
  const tags = (Array.isArray(raw.hashtags) ? raw.hashtags : [])
    .map(t => String(t || '').replace(/^#+/, '').replace(/[^A-Za-z0-9_]/g, '')).filter(Boolean).slice(0, 15);
  const lk = raw.look && typeof raw.look === 'object' ? raw.look : {};
  const look = {};
  if (['auto', 'start', 'card', 'end', 'none'].includes(lk.headline)) look.headline = lk.headline;
  if (['auto', 'on', 'off'].includes(lk.lower_third)) look.lower = lk.lower_third;
  if (['blur', 'black'].includes(lk.background)) look.bg = lk.background;
  ['shade', 'logo'].forEach(k => { if (typeof lk[k] === 'boolean') look[k] = lk[k]; });
  if (typeof lk.end_card === 'boolean') look.end = lk.end_card;
  if (lk.end_seconds != null && isFinite(parseFloat(lk.end_seconds))) look.endLen = +cl(num(lk.end_seconds, 2.6), 1.5, 5).toFixed(1);
  if (typeof lk.end_line === 'string') look.cta = clean(lk.end_line, 40);
  if (typeof lk.end_small === 'string') look.tag = clean(lk.end_small, 40);
  const notes = (Array.isArray(raw.footage_notes) ? raw.footage_notes : []).slice(0, 40)
    .map(x => ({ footage: Math.round(num(x && x.footage, 0)), what: clean(x && x.what, 80) })).filter(x => x.footage > 0 && x.what);
  return {
    template: tpl,
    look,
    footage_notes: notes,
    cut: ['hard', 'dip', 'flash'].includes(raw.cut) ? raw.cut : 'hard',
    title: clean(raw.title, 40),
    service: clean(raw.service, 48),
    shots,
    caption: clean(raw.caption, 2000),
    hashtags: [...new Set(tags)],
    why: clean(raw.why, 800),
    length: +total.toFixed(2)
  };
}
export function slimPlan(p) {
  // the redo sees the reel as it stands now, including every hand tweak
  return p ? { template: p.template, cut: p.cut, look: p.look, title: p.title, service: p.service,
    shots: (p.shots || []).map(s => {
      const o = { footage: s.footage, in: s.in, out: s.out };
      if (s.label) o.label = s.label;
      ['fit', 'motion', 'text', 'text_pos', 'what'].forEach(k => { if (s[k]) o[k] = s[k]; });
      if (s.speed && s.speed !== 1) o.speed = s.speed;
      if (s.zoom && s.zoom !== 1) o.zoom = s.zoom;
      if (s.focus && (s.focus.x !== 0.5 || s.focus.y !== 0.5)) o.focus = s.focus;
      if (s.blur && s.blur.length) o.blur = s.blur;
      return o;
    }),
    caption: p.caption } : null;
}
export function summarize(p) {
  if (!p) return '';
  return (p.template === 'ba' ? 'Before/After' : p.template === 'reveal' ? 'Reveal' : 'Walkaround')
    + ', ' + (p.shots || []).length + ' shots, ' + (Number(p.length) || 0).toFixed(1) + 's'
    + (p.title ? ', headline "' + p.title + '"' : '')
    + (p.service ? ', service "' + p.service + '"' : '')
    + (p.shots && p.shots[0] ? ', opens ' + (p.shots[0].label ? 'on ' + p.shots[0].label : 'on F' + p.shots[0].footage) + ' for ' + (p.shots[0].out - p.shots[0].in).toFixed(1) + 's' : '')
    + (p.shots && p.shots.length ? '. Shots: ' + p.shots.slice(0, 14).map(x => ((x.out - x.in) / (x.speed || 1)).toFixed(1) + 's' + (x.speed && x.speed !== 1 ? ' at ' + x.speed + 'x' : '') + (x.what ? ' ' + x.what : '') + (x.text ? ' text "' + String(x.text).slice(0, 30) + '"' : '')).join('; ') : '')
    + (p.cut ? '. Cuts: ' + p.cut : '')
    + (p.caption ? '. Caption starts: "' + p.caption.split('\n')[0].slice(0, 90) + '"' : '')
    + (p.note ? '. Owner note: ' + p.note : '');
}

/* ── store helpers (Netlify Blobs or a fake with the same two calls) ── */
const STYLE_KEY = 'style';
export async function readStyle(store) {
  const s = await store.get(STYLE_KEY, { type: 'json' });
  return Object.assign({ rules: [], examples: [], feedback: [], lessons: [] }, s || {});
}
async function writeStyle(store, s) {
  s.rules = (s.rules || []).map(r => clean(r, 300)).filter(Boolean).slice(0, 60);
  s.examples = (s.examples || []).slice(-12);
  s.feedback = (s.feedback || []).slice(-40);
  s.lessons = (s.lessons || []).slice(-LESSONS_KEPT);
  s.updated = new Date().toISOString();
  await store.setJSON(STYLE_KEY, s);
  return s;
}
const safeId = id => String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
const jobKey = id => 'job/' + safeId(id);
const frameKey = (id, n) => 'frames/' + safeId(id) + '/' + Math.max(0, Math.min(99, Math.round(Number(n) || 0)));
// Netlify hands a background function at most a small request body, so the
// stills go up first, one footage item per request, and the planning run
// reads them back from the store.

async function dropFrames(store, job, n) {
  if (!store.delete) return;
  for (let i = 0; i < Math.min(40, n || 0); i++) { try { await store.delete(frameKey(job, i)); } catch (e) {} }
}

/* ── the planning run (background function body) ─────────────────────── */
export async function runPlan({ body, store, fetchImpl, env }) {
  const id = jobKey(body && body.job);
  if (id === 'job/') return { ok: false, error: 'missing job id' };
  const started = new Date().toISOString();
  await store.setJSON(id, { status: 'working', started });
  try {
    const key = env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY is not set in Netlify');
    const style = await readStyle(store);
    const meta = Array.isArray(body.footage) ? body.footage.slice(0, 40) : [];
    const footage = [];
    for (let i = 0; i < meta.length; i++) {
      const up = await store.get(frameKey(body.job, i), { type: 'json' });
      footage.push(Object.assign({}, meta[i], { frames: (up && Array.isArray(up.frames)) ? up.frames : (meta[i].frames || []) }));
    }
    if (!footage.some(f => f.frames && f.frames.length)) throw new Error('No stills arrived for this job - try again');
    body = Object.assign({}, body, { footage });
    const req = buildRequest({ footage: body.footage, style, prev: body.prev, want: body.want, model: env.STUDIO_MODEL });
    const call = async r => {
      const res = await fetchImpl(API_URL, {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(r)
      });
      const txt = await res.text();
      let d = null; try { d = JSON.parse(txt); } catch (e) {}
      if (!res.ok) throw new Error('Claude API ' + res.status + ': ' + ((d && d.error && d.error.message) || txt.slice(0, 200)));
      return d || {};
    };
    const usage = { in: 0, out: 0 };
    const pick = d => {
      if (d.usage) { usage.in += d.usage.input_tokens || 0; usage.out += d.usage.output_tokens || 0; }
      return (d.content || []).find(c => c.type === 'tool_use' && c.name === 'submit_edit');
    };
    let data = await call(req);
    let use = pick(data);
    if (!use) {
      // The tool is not forced (SC1c): if the reply came back without an edit, hand it back and ask once.
      const again = Object.assign({}, req, { messages: req.messages.concat(
        { role: 'assistant', content: (data.content && data.content.length) ? data.content : [{ type: 'text', text: '(no reply)' }] },
        { role: 'user', content: [{ type: 'text', text: 'Call submit_edit now with your edit of this reel. Reply with the tool call only.' }] }) });
      data = await call(again);
      use = pick(data);
    }
    if (!use) throw new Error('The editor did not return an edit');
    const plan = validatePlan(use.input, body.footage);
    await store.setJSON(id, { status: 'done', started, finished: new Date().toISOString(), plan, usage, model: req.model, core: CORE_BUILD });
    await dropFrames(store, body.job, meta.length);
    return { ok: true, plan };
  } catch (e) {
    await store.setJSON(id, { status: 'error', started, finished: new Date().toISOString(), error: clean(e && e.message || e, 400) });
    await dropFrames(store, body && body.job, Array.isArray(body && body.footage) ? body.footage.length : 0);
    return { ok: false, error: String(e && e.message || e) };
  }
}

/* ── the small API (sync function body) ──────────────────────────────── */
export async function handleApi({ method, op, query, body, store, env }) {
  const J = (status, json) => ({ status, json });
  if (op === 'ping') return J(200, { ok: true, core: CORE_BUILD, model: env.STUDIO_MODEL || DEFAULT_MODEL, ai: !!env.ANTHROPIC_API_KEY });
  if (op === 'job' && method === 'GET') {
    const j = await store.get(jobKey(query.id), { type: 'json' });
    return j ? J(200, j) : J(404, { status: 'missing' });
  }
  if (op === 'frames' && method === 'POST') {
    const job = safeId(query.job), n = Number(query.i);
    if (!job || !(n >= 0 && n < 40)) return J(400, { error: 'bad job or index' });
    const frames = (body && Array.isArray(body.frames) ? body.frames : []).slice(0, 16)
      .filter(x => x && typeof x.jpg === 'string' && x.jpg.length < 400000)
      .map(x => ({ t: Number(x.t) || 0, jpg: x.jpg }));
    await store.setJSON(frameKey(job, n), { frames });
    return J(200, { saved: frames.length });
  }
  if (op === 'style' && method === 'GET') {
    const s = await readStyle(store);
    return J(200, { rules: s.rules, examples: s.examples.slice(-6), feedback: s.feedback.slice(-NOTES_SENT), lessons: s.lessons.slice(-LESSONS_SENT), updated: s.updated || null });
  }
  if (op === 'style' && method === 'POST') {
    const s = await readStyle(store);
    if (!Array.isArray(body && body.rules)) return J(400, { error: 'rules must be a list' });
    s.rules = body.rules;
    const w = await writeStyle(store, s);
    return J(200, { rules: w.rules });
  }
  if (op === 'feedback' && method === 'POST') {
    const text = clean(body && body.text, 1000);
    if (!text) return J(400, { error: 'empty note' });
    const s = await readStyle(store);
    s.feedback.push({ at: new Date().toISOString(), text, plan: summarize(body.plan) });
    if (body.rule) s.rules.push(text);
    const w = await writeStyle(store, s);
    return J(200, { rules: w.rules, saved: true });
  }
  if (op === 'approve' && method === 'POST') {
    if (!body || !body.plan) return J(400, { error: 'no plan' });
    const s = await readStyle(store);
    const at = new Date().toISOString();
    s.examples.push({ at, summary: summarize(Object.assign({}, body.plan, { note: clean(body.note, 200) })) });
    let lesson = '';
    if (body.ai && Array.isArray(body.ai.shots)) {
      const lines = diffPlans(body.ai, body.plan);
      if (lines.length) { lesson = lines.join('; '); s.lessons.push({ at, text: lesson }); }
    }
    await writeStyle(store, s);
    return J(200, { saved: true, examples: s.examples.length, lesson });
  }
  if (op === 'learn-del' && method === 'POST') {
    const kind = body && body.kind, at = String(body && body.at || '');
    const s = await readStyle(store);
    if (kind === 'lesson') s.lessons = s.lessons.filter(l => l.at !== at);
    else if (kind === 'note') s.feedback = s.feedback.filter(f => f.at !== at);
    else return J(400, { error: 'kind must be lesson or note' });
    await writeStyle(store, s);
    return J(200, { deleted: true, lessons: s.lessons.slice(-LESSONS_SENT), feedback: s.feedback.slice(-NOTES_SENT) });
  }
  /* SC1d - saved projects (Cole: "a way to save a video and settings for how the video was created so i can
     come back to it" - chose "settings online, footage on device"). A project is the edit, never the footage:
     shots, trims, labels, blur boxes, template, text, music name, the AI review. proj/<id> holds it; the
     projects index holds one small line per project for the list. Last save wins. */
  if (op === 'proj-list' && method === 'GET') {
    const idx = await readProjIndex(store);
    return J(200, { projects: idx.sort((a, b) => String(b.updated).localeCompare(String(a.updated))) });
  }
  if (op === 'proj-get' && method === 'GET') {
    const id = safeId(query.id);
    if (!id) return J(400, { error: 'bad project id' });
    const p = await store.get(projKey(id), { type: 'json' });
    return p ? J(200, { project: p }) : J(404, { error: 'That project is gone' });
  }
  if (op === 'proj-save' && method === 'POST') {
    const p = body && body.project;
    const id = safeId(p && p.id);
    if (!id || id !== String(p.id)) return J(400, { error: 'bad project id' });
    const txt = JSON.stringify(p);
    if (txt.length > PROJ_MAX) return J(413, { error: 'Project too big to save (' + Math.round(txt.length / 1024) + ' KB)' });
    if (p.thumb && (typeof p.thumb !== 'string' || !/^data:image\/jpeg;base64,/.test(p.thumb) || p.thumb.length > 60000)) delete p.thumb;
    const now = new Date().toISOString();
    const old = await store.get(projKey(id), { type: 'json' });
    const saved = Object.assign({}, p, { id, name: clean(p.name, 60) || 'Untitled reel', created: (old && old.created) || p.created || now, updated: now, core: CORE_BUILD });
    await store.setJSON(projKey(id), saved);
    const idx = (await readProjIndex(store)).filter(x => x.id !== id);
    idx.push(projLine(saved));
    await store.setJSON(PROJ_INDEX, idx.slice(-PROJ_KEEP));
    return J(200, { saved: true, id, updated: now, created: saved.created });
  }
  if (op === 'proj-del' && method === 'POST') {
    const id = safeId(query.id || (body && body.id));
    if (!id) return J(400, { error: 'bad project id' });
    await store.delete(projKey(id));
    const idx = (await readProjIndex(store)).filter(x => x.id !== id);
    await store.setJSON(PROJ_INDEX, idx);
    return J(200, { deleted: true, id });
  }
  return J(404, { error: 'unknown op' });
}
/* SC1f - what the owner changed between the editor's cut and what he exported, in words the editor can learn
   from next time. Shots are paired by footage and overlap; each line names the shot by what it shows. */
export function diffPlans(ai, fin) {
  const out = [];
  if (!ai || !fin) return out;
  const notes = {}; (ai.footage_notes || []).forEach(n => { notes[n.footage] = n.what; });
  const A = (ai.shots || []).map((x, i) => Object.assign({ i }, x)), B = (fin.shots || []).map((x, i) => Object.assign({ i }, x));
  const name = (x, fromAi) => x.what ? '"' + x.what + '"' : notes[x.footage] ? 'a shot from F' + x.footage + ' ("' + notes[x.footage] + '")' : 'a shot from F' + x.footage;
  const sp = x => Number(x.speed) || 1, len = x => (x.out - x.in) / sp(x);
  const fx = v => (Number(v) === 1 ? 'real time (1x)' : v + 'x');
  const used = new Set(), pairs = [];
  B.forEach(b => {
    let best = null, ov = 0;
    A.forEach(a => {
      if (used.has(a.i) || a.footage !== b.footage) return;
      const o = Math.min(a.out, b.out) - Math.max(a.in, b.in);
      if (o > ov || (best === null && o > -0.5)) { best = a; ov = o; }
    });
    if (best) { used.add(best.i); pairs.push([best, b]); b.what = b.what || best.what; }
    else out.push('added ' + name(b) + ' (' + (b.in != null ? (+b.in).toFixed(1) : '?') + '-' + (b.out != null ? (+b.out).toFixed(1) : '?') + 's) at ' + fx(sp(b)) + (b.text ? ' with text "' + b.text + '"' : ''));
  });
  A.filter(a => !used.has(a.i)).forEach(a => out.push('removed ' + name(a, true)));
  pairs.forEach(([a, b]) => {
    const n = name(a, true);
    if (Math.abs(sp(a) - sp(b)) > 0.01) out.push((sp(b) < sp(a) ? 'slowed ' : 'sped up ') + n + ' from ' + fx(sp(a)) + ' to ' + fx(sp(b)));
    if (Math.abs(len(a) - len(b)) > 0.6 && Math.abs(sp(a) - sp(b)) <= 0.01) out.push((len(b) < len(a) ? 'shortened ' : 'lengthened ') + n + ' from ' + len(a).toFixed(1) + 's to ' + len(b).toFixed(1) + 's on screen');
    if ((a.motion || 'auto') !== (b.motion || 'auto')) out.push('changed motion on ' + n + ' from ' + (a.motion || 'auto') + ' to ' + (b.motion || 'auto'));
    if ((a.fit || '') && b.fit && a.fit !== b.fit) out.push('set ' + n + ' to ' + (b.fit === 'fit' ? 'fit (whole frame)' : 'fill (cropped)'));
    if ((a.text || '') !== (b.text || '')) out.push(!b.text ? 'removed the text "' + a.text + '" from ' + n : !a.text ? 'added text "' + b.text + '" on ' + n : 'changed the text on ' + n + ' from "' + a.text + '" to "' + b.text + '"');
    else if (a.text && (a.text_pos || 'center') !== (b.text_pos || 'center')) out.push('moved the text on ' + n + ' to the ' + b.text_pos);
    const az = Number(a.zoom) || 1, bz = Number(b.zoom) || 1, af = a.focus || {}, bf = b.focus || {};
    if (Math.abs(az - bz) > 0.1 || Math.abs((af.x ?? 0.5) - (bf.x ?? 0.5)) > 0.1 || Math.abs((af.y ?? 0.5) - (bf.y ?? 0.5)) > 0.1) out.push('reframed ' + n + ' (zoom ' + bz.toFixed(1) + ', focus ' + (+(bf.x ?? 0.5)).toFixed(2) + ',' + (+(bf.y ?? 0.5)).toFixed(2) + ')');
  });
  const order = pairs.map(p => p[0].i);
  if (order.some((v, i) => i && v < order[i - 1])) out.push('reordered the shots');
  if (ai.template && fin.template && ai.template !== fin.template) out.push('changed the template from ' + ai.template + ' to ' + fin.template);
  if ((ai.cut || 'hard') !== (fin.cut || 'hard')) out.push('changed the cuts from ' + (ai.cut || 'hard') + ' to ' + (fin.cut || 'hard'));
  const la = ai.look || {}, lb = fin.look || {};
  [['headline', 'headline'], ['lower', 'lower_third', 'service bar'], ['bg', 'background', 'background behind fit shots'], ['shade', 'shade', 'bottom shade'], ['logo', 'logo', 'logo'], ['end', 'end_card', 'end card']].forEach(([k, k2, label]) => {
    const va = la[k] !== undefined ? la[k] : la[k2], vb = lb[k] !== undefined ? lb[k] : lb[k2];
    if (vb !== undefined && va !== undefined && String(va) !== String(vb)) out.push('set the ' + (label || k) + ' to ' + vb);
    else if (vb !== undefined && va === undefined && !['auto', 'blur', true, 'true'].includes(vb)) out.push('set the ' + (label || k) + ' to ' + vb);
  });
  if ((ai.title || '') !== (fin.title || '') && fin.title !== undefined) out.push('changed the headline to "' + (fin.title || '') + '"');
  const ta = (ai.shots || []).reduce((t, x) => t + len(x), 0), tb = (fin.shots || []).reduce((t, x) => t + len(x), 0);
  if (Math.abs(ta - tb) > 2) out.push('total shots ' + ta.toFixed(0) + 's -> ' + tb.toFixed(0) + 's');
  return out.slice(0, 20).map(x => clean(x, 200));
}
const PROJ_INDEX = 'projects', PROJ_MAX = 400000, PROJ_KEEP = 300;
const projKey = id => 'proj/' + safeId(id);
async function readProjIndex(store) {
  const x = await store.get(PROJ_INDEX, { type: 'json' });
  return Array.isArray(x) ? x : [];
}
function projLine(p) {
  const shots = Array.isArray(p.shots) ? p.shots : [];
  const foot = Array.isArray(p.footage) ? p.footage : [];
  return { id: p.id, name: p.name, created: p.created, updated: p.updated, thumb: p.thumb || '',
    len: Number(p.len) || 0, shots: shots.length, footage: foot.length,
    keys: foot.map(f => String(f && f.key || '')).filter(Boolean).slice(0, 40) };
}
