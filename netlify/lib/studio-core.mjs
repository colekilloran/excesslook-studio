// studio-core.mjs - Reel Studio server logic (SC1b-2026-11-23 - house style from Cole's reference reels).
// Everything that matters lives here as plain functions that take their
// dependencies (store, fetch, env) as arguments, so the tests can run them
// with fakes. The Netlify function files are thin wrappers.

export const CORE_BUILD = 'SC1p-2026-11-25-custombuild';
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
    if (want.note) w.push('Note: ' + clean(want.note, 2000));
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
  if (op === 'ping') return J(200, { ok: true, core: CORE_BUILD, model: env.STUDIO_MODEL || DEFAULT_MODEL, ai: !!env.ANTHROPIC_API_KEY, img: !!env.OPENAI_API_KEY });
  /* SC1k - photos go up through this function (requests up to ~6 MB); a background function only takes a small
     body, so it is handed the id and reads the photo from the store. */
  if (op === 'img-put' && method === 'POST') {
    const id = safeId(query.id), jpg = body && typeof body.jpg === 'string' ? body.jpg : '';
    if (!id) return J(400, { error: 'bad id' });
    if (!/^[A-Za-z0-9+/=]+$/.test(jpg.slice(0, 200)) || jpg.length < 100 || jpg.length > 4500000) return J(400, { error: 'Photo missing or too big' });
    await store.setJSON('img/' + id, { jpg, at: new Date().toISOString() });
    return J(200, { saved: true, id });
  }
  if (op === 'card' && method === 'GET') {
    const id = safeId(query.id);
    const c = id ? await store.get('card/' + id, { type: 'json' }) : null;
    return c ? J(200, c) : J(404, { status: 'missing' });
  }
  if (op === 'film' && method === 'GET') {
    const id = safeId(query.id);
    const f = id ? await store.get('film/' + id, { type: 'json' }) : null;
    return f ? J(200, f) : J(404, { status: 'missing' });
  }
  /* SC1g color lineup: the car photo goes up once, renders come back one by one */
  if (op === 'cl-src' && method === 'POST') {
    const job = safeId(query.job), i = Number(query.i);
    const jpg = body && typeof body.jpg === 'string' ? body.jpg : '';
    if (!job || !(i >= 0 && i < 24)) return J(400, { error: 'bad job or photo' });
    if (!/^[A-Za-z0-9+/=]+$/.test(jpg.slice(0, 200)) || jpg.length < 100 || jpg.length > 4500000) return J(400, { error: 'Photo missing or too big' });
    await store.setJSON(clKey(job, 'src', i), { jpg, w: Number(body.w) || 0, h: Number(body.h) || 0 });
    return J(200, { saved: true });
  }
  if (op === 'cl-status' && method === 'GET') {
    const job = safeId(query.job);
    if (!job) return J(400, { error: 'bad job' });
    const ks = String(query.ks || '').split(',').map(x => Math.round(Number(x))).filter(x => x >= 0 && x < 400).slice(0, 120);
    const out = {};
    for (const k of ks) { const st = await store.get(clKey(job, 'st', k), { type: 'json' }); out[k] = st || { status: 'waiting' }; }
    return J(200, { renders: out });
  }
  if (op === 'cl-img' && method === 'GET') {
    const job = safeId(query.job), k = Math.round(Number(query.k));
    const im = job && k >= 0 ? await store.get(clKey(job, 'out', k), { type: 'json' }) : null;
    return im ? J(200, im) : J(404, { error: 'not ready' });
  }
  if (op === 'cl-drop' && method === 'POST') {
    const job = safeId(query.job), n = Math.min(400, Math.round(Number(query.n) || 0)), m = Math.min(24, Math.round(Number(query.m) || 0));
    if (!job) return J(400, { error: 'bad job' });
    for (let k = 0; k < n; k++) { await store.delete(clKey(job, 'out', k)); await store.delete(clKey(job, 'st', k)); }
    for (let i = 0; i < m; i++) await store.delete(clKey(job, 'src', i));
    return J(200, { dropped: true });
  }
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
/* ══ SC1g - COLOR LINEUP ══════════════════════════════════════════════════
   Cole: "what if i gave the studio a few pictures of a car and 10 different wrap colors. could it do a montage
   of that car in all the colors?" - option 2, built into the studio, on OpenAI's image editor (his own API key,
   OPENAI_API_KEY; model OPENAI_IMAGE_MODEL, default gpt-image-2.5-sunburst - the one meant for precise edits).
   Each render = one photo + one color. The background function runs them three at a time; each render's
   status and image are stored on their own keys so nothing races. */
const clKey = (job, kind, n) => 'cl/' + safeId(job) + '/' + kind + '/' + Math.max(0, Math.min(399, Math.round(Number(n) || 0)));
export const IMAGE_MODEL = 'gpt-image-2.5-sunburst';
export function finishOf(color) {
  const c = String(color || '').toLowerCase();
  if (/chrome|mirror/.test(c)) return 'chrome finish - a mirror-like reflective wrap';
  if (/color.?shift|chameleon|iridescent|psychedelic/.test(c)) return 'color-shift finish - the color changes with the angle of the light';
  if (/matte|matt\b|flat/.test(c)) return 'matte finish - no shine, soft diffuse reflections';
  if (/satin|frozen/.test(c)) return 'satin finish - a soft low sheen, between matte and gloss';
  if (/brushed/.test(c)) return 'brushed metal finish';
  if (/carbon/.test(c)) return 'carbon fiber texture';
  if (/metallic|pearl|flake/.test(c)) return 'gloss metallic finish with fine metal flake';
  return 'high gloss finish with crisp reflections, like fresh paint';
}
export function recolorPrompt(color, swatch, spec, light, photoLight) {
  const col = clean(color, 80);
  if (spec && (spec.clear || /^clear\b/i.test(String(spec.color_name || '')))) {
    // clear film keeps the car's own paint: only the sheen changes
    return 'Edit the first image, a photo of a car: the car now has ' + filmText(spec) + ' over its own paint. Keep the paint color exactly as it is; change only the surface sheen to match the film'
      + (spec.finish ? ' (' + spec.finish + ')' : '') + '. Keep everything else exactly the same: the same car, the same angle and framing, wheels, tires, glass, lights, badges, trim, license plate and background. '
      + (light && LIGHTS[light] ? LIGHTS[light] + ' ' : 'Keep the lighting and reflections the same. ') + 'Photorealistic. No text, no watermark.';
  }
  /* SC1h - Cole photographed the film itself: "its not actually making the car the new color. it just makes a
     slide show of the car and then the ppf color i took a picture of". A swatch photo rides along as the second
     image and the edit matches it exactly. */
  const specTxt = (spec ? ' Film details (researched - match them exactly): ' + filmText(spec) + '.' : '')
    + (swatch && PHOTO_LIGHT[photoLight] ? ' ' + PHOTO_LIGHT[photoLight] : '');
  const what = swatch
    ? 'the exact color, finish and sheen of the wrap or paint protection film shown in the second image (a photo of a sample of the film' + (col ? ', called ' + col : '') + ') - match its hue, brightness, gloss or satin or matte level and any metallic flake or texture; ignore everything else in the second image'
    : col + ' as a professional ' + (spec && /ppf|protection/i.test(spec.film_type || '') ? 'color paint protection film' : 'vinyl wrap') + ', ' + (spec && spec.finish ? spec.finish + ' finish' : finishOf(col));
  return 'Edit the first image, a photo of a car: change the color of the car\'s painted body panels to ' + what + '.' + specTxt + ' Wrap every painted panel evenly - hood, roof, doors, fenders, bumpers, mirrors and pillars that are body color. '
    + 'Keep everything else exactly the same: the same car, the same angle and framing, wheels, tires, brake calipers, glass and window tint, '
    + 'headlights, taillights, badges and emblems, grille, chrome and black trim, license plate, background' + (light && LIGHTS[light] ? ' and ground. ' + LIGHTS[light] + ' ' : ', ground, lighting and shadows. ')
    + 'Photorealistic, like a real photo of the wrapped car. No text, no watermark, no added objects.';
}
/* SC1i - Cole: "The ppf colors are crucial that they are an exact match which may require knowing the brand of ppf
   and researching the exact color code i provide along with understanding the flake color, texture (gloss, satin,
   metallic, color shift, etc...) and matching it exactly showing how lighting changes the color." A researched film
   spec (runFilm) drives the render, and each render can be lit a set way. */
export const LIGHTS = {
  sun: 'Relight the scene as bright direct midday sun: crisp hard reflections and highlights on the film, deep shadows; show how this film looks in full sun (metallic flake sparkles, color shift at its strongest).',
  shade: 'Relight the scene as open shade on a bright day: soft even light, no hard highlights; show the film\'s true base color.',
  overcast: 'Relight the scene as an overcast day: flat soft grey light, low contrast; show how the film reads on a cloudy day.',
  golden: 'Relight the scene as golden hour, low warm sun from the side: long warm highlights along the body lines.',
  night: 'Relight the scene as night under street and shop lights: dark surroundings, pools of light and specular streaks on the panels.',
  studio: 'Relight the scene as a detailing studio: long overhead LED light bars reflected as clean lines along the panels.'
};
/* SC1l - Cole: "I need to be able to tell the studio that the picture of the color card is being taken in sunlight,
   studio light, overcast light or at night so it knows how to read the color better. The last grey color I did came
   out looking lighter than the actual color card and I took the color card photo in direct sunlight." */
export const PHOTO_LIGHT = {
  sun: 'The sample photo was taken in DIRECT SUNLIGHT. Sun makes a sample look lighter, brighter and less saturated than the film really is, and gloss chips pick up white glare - the film\'s true color is DARKER and richer than it looks in that photo; greys and blacks especially read too light. Correct for that.',
  shade: 'The sample photo was taken in open shade - close to the film\'s true color, at most a touch cooler than it really is.',
  overcast: 'The sample photo was taken on an overcast day - soft, slightly cool light; the color is close to true but a little flatter and duller than it really is.',
  studio: 'The sample photo was taken under shop / studio LED lights - they can shift the color warm or cool and add hard reflections; trust its hue only roughly and lean on the maker\'s data.',
  night: 'The sample photo was taken at night under artificial light - its color is unreliable; lean on the maker\'s data and the color name, not the photo.'
};
export const LIGHT_NAMES = { sun: 'In the sun', shade: 'In the shade', overcast: 'Overcast', golden: 'Golden hour', night: 'At night', studio: 'Studio lights' };
export function filmText(sp) {
  if (!sp) return '';
  const bits = [];
  const name = [sp.brand, sp.product_line, sp.color_name].filter(Boolean).join(' ');
  if (name) bits.push(name + (sp.code ? ' (code ' + sp.code + ')' : ''));
  if (sp.film_type) bits.push(sp.film_type);
  if (sp.finish) bits.push(sp.finish + ' finish');
  if (sp.base_color) bits.push('base color: ' + sp.base_color);
  if (sp.hex && (sp.hex.mid || sp.hex.highlight)) bits.push('approximate tones - highlight ' + (sp.hex.highlight || '?') + ', mid ' + (sp.hex.mid || '?') + ', shadow ' + (sp.hex.shadow || '?'));
  if (sp.flake && sp.flake.present) bits.push('flake: ' + [sp.flake.color, sp.flake.size].filter(Boolean).join(', '));
  if (sp.shift && sp.shift.colors) bits.push('color shift: ' + sp.shift.colors);
  if (sp.render_notes) bits.push(sp.render_notes);
  return clean(bits.join('; '), 900);
}
export function renderSize(w, h) {
  if (!w || !h) return '1536x1024';
  const r = w / h;
  return r > 1.15 ? '1536x1024' : r < 0.87 ? '1024x1536' : '1024x1024';
}
async function recolorOne({ job, r, store, fetchImpl, env }) {
  const k = r.k;
  await store.setJSON(clKey(job, 'st', k), { status: 'working', color: r.color, src: r.src, at: new Date().toISOString() });
  try {
    const src = await store.get(clKey(job, 'src', r.src), { type: 'json' });
    if (!src || !src.jpg) throw new Error('The car photo did not arrive - try again');
    const fd = new FormData();
    fd.append('model', env.OPENAI_IMAGE_MODEL || IMAGE_MODEL);
    const blob = b64 => new Blob([Buffer.from(b64, 'base64')], { type: 'image/jpeg' });
    if (r.build) {
      // SC1p - image 1 is the car photo, images 2.. are r.refs in order; the build names them by number
      const refs = [];
      for (const i of r.refs || []) { const x = await store.get(clKey(job, 'src', i), { type: 'json' }); if (!(x && x.jpg)) throw new Error('A reference photo did not arrive - try again'); refs.push(x); }
      fd.append('prompt', buildPrompt(r.build, r.light) + (r.extra ? ' Change for this render: ' + clean(r.extra, 300) : ''));
      fd.append('image[]', blob(src.jpg), 'photo.jpg');
      refs.forEach((x, n) => fd.append('image[]', blob(x.jpg), 'ref' + (n + 2) + '.jpg'));
    } else {
    const ref = r.ref >= 0 ? await store.get(clKey(job, 'src', r.ref), { type: 'json' }) : null;
    if (r.ref >= 0 && !(ref && ref.jpg)) throw new Error('The swatch photo did not arrive - try again');
    fd.append('prompt', recolorPrompt(r.color, !!ref, r.spec, r.light, r.photoLight) + (r.extra ? ' ' + clean(r.extra, 300) : ''));
    if (ref) { fd.append('image[]', blob(src.jpg), 'car.jpg'); fd.append('image[]', blob(ref.jpg), 'swatch.jpg'); }
    else fd.append('image', blob(src.jpg), 'car.jpg');
    }
    fd.append('size', renderSize(src.w, src.h));
    fd.append('quality', env.OPENAI_IMAGE_QUALITY || 'medium');
    fd.append('output_format', 'jpeg');
    fd.append('n', '1');
    const res = await fetchImpl('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + env.OPENAI_API_KEY }, body: fd });
    const txt = await res.text();
    let d = null; try { d = JSON.parse(txt); } catch (e) {}
    if (!res.ok) throw new Error('OpenAI ' + res.status + ': ' + ((d && d.error && d.error.message) || txt.slice(0, 200)));
    const b64 = d && d.data && d.data[0] && d.data[0].b64_json;
    if (!b64) throw new Error('OpenAI returned no image');
    await store.setJSON(clKey(job, 'out', k), { jpg: b64, color: r.color, src: r.src });
    await store.setJSON(clKey(job, 'st', k), { status: 'done', color: r.color, src: r.src, at: new Date().toISOString(), usage: d.usage || null });
  } catch (e) {
    await store.setJSON(clKey(job, 'st', k), { status: 'error', color: r.color, src: r.src, error: clean(e && e.message || e, 300) });
  }
}
/* ══ SC1p - CUSTOM BUILD ══════════════════════════════════════════════════
   Cole: "I have a 2008 Volvo C30 T5 that I plan to PPF with a base color and another color as the accent color that will
   cover sections of the exterior. I am also replacing the interior with all white leather ... the waterfall dash and
   other interior pieces will be ppf'd with the accent color ... white adjustable bucket seats ... white interior lighting
   in some accent areas." A build has films, each in a zone, plus an interior plan. Each render edits one real photo with
   the reference images riding along (design layout, seats, a photo of each film), each named by its image number. */
export const BUILD_ROLES = { base: 'base color - every painted body panel not named for another film', accent: 'accent', parts: 'brake calipers and exhaust tips', trim: 'interior trim' };
function cleanBuild(b) {
  b = b && typeof b === 'object' ? b : {};
  const scene = ['exterior', 'interior', 'night'].includes(b.scene) ? b.scene : 'exterior';
  const films = (Array.isArray(b.films) ? b.films : []).slice(0, 6).map(f => ({
    name: clean(f && f.name, 90), where: clean(f && f.where, 300), role: BUILD_ROLES[f && f.role] ? f.role : 'accent',
    img: f && f.img >= 1 && f.img <= 16 ? Math.round(f.img) : 0,
    spec: f && f.spec && typeof f.spec === 'object' ? validateFilm(f.spec) : null, photoLight: f && PHOTO_LIGHT[f.photoLight] ? f.photoLight : '' })).filter(f => f.name || f.img);
  const it = b.interior && typeof b.interior === 'object' ? b.interior : {};
  return { scene, car: clean(b.car, 80), films, wheels: clean(b.wheels, 120),
    design: b.design >= 1 && b.design <= 16 ? Math.round(b.design) : 0, seats: b.seats >= 1 && b.seats <= 16 ? Math.round(b.seats) : 0,
    interior: { on: !!it.on, leather: clean(it.leather, 120), seats: clean(it.seats, 160), trim: clean(it.trim, 200), lighting: clean(it.lighting, 200) },
    notes: clean(b.notes, 500) };
}
export function buildPrompt(raw, light) {
  const b = cleanBuild(raw), car = b.car || 'the car';
  const filmLine = f => (f.name || 'the film') + (f.img ? ' (its sample is image ' + f.img + ' - match that exact color, finish, flake and sheen; ignore everything else in that image)' : '')
    + (f.spec ? ' - researched: ' + filmText(f.spec) : '') + (f.img && PHOTO_LIGHT[f.photoLight] ? ' (' + PHOTO_LIGHT[f.photoLight].replace(/\.$/, '').replace(/^The sample photo/, 'that sample photo') + ')' : '');
  const keep = 'Keep everything else exactly the same as image 1: the same ' + car + (b.scene === 'exterior' ? ', its exact body shape, panel gaps, proportions' : ', the exact shape of its dash, doors, console and pillars') + ', the same angle and framing, ';
  if (b.scene === 'exterior') {
    const base = b.films.find(f => f.role === 'base'), others = b.films.filter(f => f !== base && f.role !== 'trim');
    const lines = [];
    if (base) lines.push('Base color: wrap every painted body panel not named below in ' + filmLine(base) + '.');
    others.forEach(f => lines.push((f.role === 'parts' ? 'Brake calipers and exhaust tips' : 'Accent') + ': ' + (f.where || BUILD_ROLES[f.role]) + ' in ' + filmLine(f) + '.'));
    return 'Edit image 1, a real photo of ' + car + ', into a photo of the same car with this custom paint protection film design. ' + lines.join(' ')
      + (b.wheels ? ' Wheels: refinish the wheels in ' + b.wheels + ' - the same wheel design, spokes and size, only the finish changes.' : '')
      + (b.design ? ' Image ' + b.design + ' is a design concept that shows WHERE the accent film goes - copy only its layout of the accent sections onto this car; its colors are wrong and its car is not accurate, so take colors only from the film samples and the car only from image 1. It may be a collage: ignore any text, labels, swatch boxes and panel borders in it.' : '')
      + ' Color-shift films change color with the viewing angle across the body curves. ' + keep
      + (b.wheels ? '' : 'wheels, ') + 'tires, glass and window tint, lights, badges, grille, black trim, license plate, background' + (light && LIGHTS[light] ? ' and ground. ' + LIGHTS[light] + ' ' : ', ground, lighting and shadows. ')
      + (b.notes ? 'Owner notes: ' + b.notes + ' ' : '') + 'Photorealistic, like a real photo of the finished car. No text, no watermark, no added objects.';
  }
  const trim = b.films.filter(f => f.role === 'trim' || f.role === 'accent');
  const i = b.interior;
  const parts = [
    'Re-trim the whole interior in ' + (i.leather || 'white leather') + ' - seats, door cards, armrests, center console, dash top, headliner where it shows - with matching stitching.',
    'Seats: ' + (i.seats || 'white bucket seats') + (b.seats ? ' - shaped exactly like the seats in image ' + b.seats + ' (use their shape, bolsters and adjusters; make them this color)' : '') + '.',
    trim.length ? 'Cover ' + (trim.map(f => (f.where && f.role === 'trim' ? f.where : 'the floating waterfall center stack and the interior trim pieces') + ' in ' + filmLine(f)).join('; ')) + '.' : '',
    i.trim ? 'Also: ' + i.trim + '.' : ''
  ].filter(Boolean).join(' ');
  const night = b.scene === 'night';
  return 'Edit image 1, a real photo of the interior of ' + car + ', into a photo of the same interior after a custom build. ' + parts + ' '
    + (night ? 'It is night: the cabin is dark and lit by ' + (i.lighting || 'soft white accent lighting') + ' - glowing strips and pools of white light, no other color of light. '
      : (i.lighting ? 'The white accent lighting (' + i.lighting + ') is installed but only softly visible in daylight. ' : ''))
    + keep + 'the steering wheel shape, gauges, screens, controls, windows and the view outside' + (night ? '' : ', and the daylight') + '. '
    + (b.notes ? 'Owner notes: ' + b.notes + ' ' : '') + 'Photorealistic, like a real photo of the finished interior. No text, no watermark, no people.';
}
export async function runRecolor({ body, store, fetchImpl, env }) {
  const job = safeId(body && body.job);
  const list = (Array.isArray(body && body.renders) ? body.renders : []).slice(0, 120)
    .map(r => ({ k: Math.round(Number(r.k)), src: Math.round(Number(r.src)), ref: r.ref == null ? -1 : Math.round(Number(r.ref)), color: clean(r.color, 80), extra: clean(r.extra, 300),
      spec: r.spec && typeof r.spec === 'object' ? validateFilm(r.spec) : null, light: LIGHTS[r.light] ? r.light : '', photoLight: PHOTO_LIGHT[r.photoLight] ? r.photoLight : '',
      refs: Array.isArray(r.refs) ? r.refs.slice(0, 8).map(x => Math.round(Number(x))).filter(x => x >= 0 && x < 24) : null,
      build: r.build && typeof r.build === 'object' ? r.build : null }))
    .filter(r => r.k >= 0 && r.k < 400 && r.src >= 0 && r.src < 24 && r.ref < 24 && (r.color || r.ref >= 0 || r.build));
  if (!job || !list.length) return { ok: false, error: 'nothing to render' };
  if (!env.OPENAI_API_KEY) {
    for (const r of list) await store.setJSON(clKey(job, 'st', r.k), { status: 'error', color: r.color, src: r.src, error: 'OPENAI_API_KEY is not set in Netlify' });
    return { ok: false, error: 'no key' };
  }
  let next = 0;
  const lane = async () => { while (next < list.length) { const r = list[next++]; await recolorOne({ job, r, store, fetchImpl, env }); } };
  await Promise.all([lane(), lane(), lane()]);
  return { ok: true, n: list.length };
}
/* ══ SC1i - FILM RESEARCH ═════════════════════════════════════════════════
   The owner gives brand / line / color name / code and maybe a photo of the sample. Claude searches the web
   (web_search server tool) for the manufacturer's data and returns a structured spec through submit_film. */
export const FILM_TOOL = {
  name: 'submit_film',
  description: 'Return the researched spec of the wrap / PPF film.',
  input_schema: {
    type: 'object',
    properties: {
      brand: { type: 'string' }, product_line: { type: 'string' }, color_name: { type: 'string' }, code: { type: 'string', description: 'Manufacturer color / product code, e.g. 2080-S12 or SW900-190-O' },
      film_type: { type: 'string', enum: ['color PPF', 'clear PPF', 'vinyl wrap', 'paint'] },
      clear: { type: 'boolean', description: 'True when the film is clear (the car keeps its own paint color, only the sheen changes - e.g. XPEL Stealth, clear satin PPF)' },
      finish: { type: 'string', enum: ['gloss', 'satin', 'matte', 'metallic gloss', 'metallic satin', 'pearl', 'color shift', 'chrome', 'brushed', 'carbon', 'textured'] },
      base_color: { type: 'string', description: 'Plain words for the color as the eye sees it in shade, e.g. "deep blue-grey with a cool cast"' },
      hex: { type: 'object', description: 'Best estimate sRGB hex for the film on a car body', properties: { highlight: { type: 'string' }, mid: { type: 'string' }, shadow: { type: 'string' } } },
      flake: { type: 'object', properties: { present: { type: 'boolean' }, color: { type: 'string' }, size: { type: 'string', description: 'fine / medium / coarse' } } },
      shift: { type: 'object', description: 'Color-shift films only', properties: { colors: { type: 'string', description: 'e.g. "purple to teal to gold depending on angle"' } } },
      lighting: { type: 'object', description: 'How it reads in each light', properties: { sun: { type: 'string' }, shade: { type: 'string' }, overcast: { type: 'string' }, night: { type: 'string' } } },
      render_notes: { type: 'string', description: 'One short paragraph telling an image editor exactly how to paint this film on a car so it matches the real product' },
      confidence: { type: 'string', enum: ['exact', 'close', 'estimate'], description: 'exact = manufacturer data found for this code; close = similar product data; estimate = from the photo / name only' },
      sources: { type: 'array', maxItems: 6, items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } } } },
      note: { type: 'string', description: 'Anything the owner should check (e.g. code not found, two products share the name)' }
    },
    required: ['color_name', 'finish', 'base_color', 'render_notes', 'confidence']
  }
};
const FILM_BRIEF = 'You research automotive wrap and paint protection films for Excess Look Auto Solutions, a detailing and PPF shop. '
  + 'Find the exact product the owner names (brand, product line, color name, color code) on the manufacturer\'s own site first (xpel.com, 3m.com, averydennison.com, stekautomotive.com, suntek, kpmf.com, inozetek.com, hexis-graphics.com, paltrixppf.com and so on), then installer galleries and reviews for how it really looks on cars. '
  + 'Work out the finish, the base color, any metallic flake (its color and size), any color shift and the angles, and how it reads in sun, shade, overcast and at night. '
  + 'If the owner attached a photo of the sample, use it to confirm and fine-tune the color, but trust the manufacturer\'s data over a photo taken under shop lights. '
  + 'Paltrix (paltrixppf.com) codes read series - series letter - color family + number, e.g. 1002-C-A31 = Solid Color Series, grey family, High Gloss Cement Grey. Series: 1002-C Solid (gloss), 1003-H Chameleon / color shift, 1004-J and 2004-J Metallic, 1005-Y Matte and Satin, 1006-Z Pearl / metallic, 1007-F Carbon Fiber, 1008-L Laser. '
  + 'When the request says the Paltrix code is in their catalog, that name and series are certain - never call the code unrecognized or a bad format; find its page on paltrixppf.com for photos of the film. '
  + 'Clear films (like XPEL Stealth or any clear satin / gloss PPF) do not change the paint color - say so with clear = true. '
  + 'Open the maker\'s product page with web_fetch when you have its address. Write in US English (color, not colour). Keep note under 500 characters. '
  + 'Never invent a code. If you cannot find the product, say so in note and set confidence to estimate. Then call submit_film once.';
/* SC1n - Cole: "its saying its not recognizing the code format", then sent paltrixppf.com showing "High Gloss Cement Grey
   1002-C-A31". SC1m was built on a look-alike site's made-up "P701G" format (wrong - removed). Real Paltrix codes are
   <series number>-<series letter>-<color family letter><2 digits>. Their whole online catalog (paltrixppf.com, read
   2026-11-24) is below, so a code on a card resolves to its exact name and series before research starts. */
export const PALTRIX_SERIES = {
  '1002-C': { name: 'Solid Color Series', page: 'solid', finish: 'gloss', card: 'gloss' },
  '1003-H': { name: 'Chameleon Series', page: 'chameleon', finish: 'color shift', card: 'color shift' },
  '1005-Y': { name: 'Matte Series', page: 'matte', finish: 'matte', card: 'matte' },
  '1006-Z': { name: 'Pearl Series', page: 'pearl', finish: 'pearl', card: 'metallic' },
  '1004-J': { name: 'Metallic Series', page: 'metallic', finish: 'metallic gloss', card: 'metallic' },
  '2004-J': { name: 'Metallic Series', page: 'metallic', finish: 'metallic gloss', card: 'metallic' },
  '1007-F': { name: 'Carbon Fiber Series', page: 'carbon', finish: 'carbon', card: '' },
  '1008-L': { name: 'Laser Series', page: 'chameleon', finish: 'color shift', card: 'color shift' }
};
const PALTRIX_FAMILY = { A: 'grey', B: 'black / brown', C: 'cyan / teal', G: 'gold / grey', L: 'color shift', N: 'green', O: 'orange', P: 'pink', R: 'red', S: 'silver', U: 'blue', V: 'purple / violet', W: 'white', Y: 'yellow' };
export const PALTRIX_COLORS = Object.fromEntries(`
1002-C-C80|Crystal Aqua Blue
1002-C-Y70|Cuban Sand Yellow (Deep)
1002-C-B20|Crystal Black
1002-C-A65|Crystal Chalk Grey
1002-C-N64|Crystal Khaki Green
1002-C-P91|Crystal Lavender Purple
1002-C-U52|Crystal Miami Blue
1002-C-A59|Crystal Nardo Grey
1002-C-B30|Crystal Paint Chocolate
1002-C-R39|Crystal Racing Red
1002-C-Y83|Sahara Yellow
1002-C-Y87|Butter Yellow (NIO)
1002-C-P95|Crystal Star Viot
1002-C-U59|Crystal Autumn Blue
1002-C-A50|Crystal Battleship Grey
1002-C-V50|Crystal Beetroot Purple
1002-C-A57|Crystal Brooklyn Grey
1002-C-A44|Crystal Cement Grey
1002-C-N25|Crystal Dark Jade Green
1002-C-A66|Crystal Genmaicha Brown
1002-C-U90|Crystal Glacier Blue
1002-C-N83|Crystal Greyish Green
1002-C-P89|Crystal Koi Pink
1002-C-P40|Crystal Lilac Purple
1002-C-N65|Crystal Lizard Green (Audi)
1002-C-O61|Crystal Lotus Orange
1002-C-U05|Crystal Lugano Blue
1002-C-U65|Crystal Meissen Blue
1002-C-P66|Crystal Mirror Sky Pink
1002-C-V66|Crystal Mist Grey Purple
1002-C-V77|Crystal Morandi Purple
1002-C-P56|Crystal Oolong Milk Tea Pink
1002-C-W90|Crystal Pepper White
1002-C-A33|Crystal Polar Grey
1002-C-U49|Crystal Porcelain Blue
1002-C-P81|Crystal Sakura Pink
1002-C-U73|Crystal Sea Breeze Blue
1002-C-P86|Crystal Shell Pink
1002-C-U80|Crystal Sky Blue
1002-C-U61|Crystal Star Blue
1002-C-Y74|Crystal Sunbathe Yellow (NIO)
1002-C-Y79|Crystal Sunflower Yellow
1002-C-N26|Crystal Turquoise Green
1002-C-V52|Crystal Victoria Purple
1002-C-N90|Crystal Water Green
1002-C-W96|Crystal White
1002-C-C73|Crystal Zandvoort Blue
1002-C-N53|Glossy Khaki Green
1002-C-N32|Hell Green (Audi)
1002-C-A31|High Gloss Cement Grey
1002-C-A43|High Gloss Dark Gray
1002-C-O52|Lava Orange (Porsche)
1002-C-Y61|Original Desert Yellow (Mercedes-Benz)
1002-C-N84|Segano Green (Rolls Royce)
1002-C-O78|Tiffany (McLaren)
1005-Y-N01|Matte Combat Green
1005-Y-W10|Matte Liquid Metal Crescent White
1005-Y-S01|Matte Mountain Grey
1005-Y-W01|Matte Pearl White
1005-Y-S05|Matte Aluminium Mercury
1005-Y-Y84|Matte AMG Desert Yellow (Mercedes-Benz)
1005-Y-B01|Matte Black
1005-Y-U10|Matte Blue Charm Gold
1005-Y-W02|Matte Ceramic White
1005-Y-V06|Matte Chrome Purple
1005-Y-S08|Matte Chrome Tungsten
1005-Y-P01|Matte Fresh Pink
1005-Y-R01|Matte Grey Charm Red
1005-Y-N05|Matte Liquid Combat Green
1005-Y-G03|Matte Liquid Shadow Gold (Lamborghini)
1005-Y-R02|Matte Romanee Red
1005-Y-W09|Matte Twilight White
1005-Y-V05|Matte Violet Purple
1005-Y-V07|Satin Black Magic Purple
1005-Y-U11|Satin Competition Blue (Aston Martin)
1005-Y-S09|Satin Dark Silver
1005-Y-N04|Satin Olive Green (Aston Martin)
1005-Y-V01|Satin Pinot Noir Purple Metallic
1005-Y-W03|Super Matte White
1006-Z-V04|Berry Purple
1006-Z-N08|Emerald Green
1006-Z-A01|Graphite Gray
1006-Z-V10|Midnight Purple
1006-Z-O03|Racing Orange
1006-Z-N09|Acid Green
1006-Z-U12|Aquamarine Black (BMW)
1006-Z-R10|Black Cherry Wine (Rolls-Royce)
1006-Z-U01|Blue and Purple
1006-Z-U07|Blue Crystal
1006-Z-U14|Blue Metallic (Porsche)
1006-Z-R09|Brocade Red
1006-Z-U08|Carbon Grey Blue (BMW)
1006-Z-N12|Eucalyptus Green
1006-Z-U03|Flowing Black Charm Blue
1006-Z-R02|Flowing Black Charm Red
1006-Z-U13|Gentian Blue (Porsche)
1006-Z-N14|Ghost Green Metallic
1006-Z-R11|Glazed Tatar Red Metallic
1006-Z-U06|Interstellar Blue Liquid Metal
1006-Z-B02|Liquid Metal Coffee
1006-Z-N11|Liquid Metal Green
1006-Z-V08|Liquid Metal Purple
1006-Z-O02|Lotus Orange
1006-Z-O01|Lucky Orange
1006-Z-V06|Metallic Amethyst
1006-Z-U09|Metallic Paint Glacier Blue
1006-Z-A03|Nardo Gray (Audi)
1006-Z-R03|Pearl Wine Red
1006-Z-N10|Royal Green
1006-Z-N15|Sand Green (Porsche)
1006-Z-U02|Sapphire Blue
1006-Z-R08|Sparkling Red Purple
1006-Z-U04|Tanzanite Blue
1006-Z-C01|Tiffany Charm Gold
1006-Z-L03|Purple Red Blue
1006-Z-L01|Chameleon Green Silver Purple
1006-Z-L02|Chameleon Purple Blue Cyan
1003-H-P05|Magic Purple
1003-H-A04|Dreamy Volcano Grey
1003-H-P06|Matte Metallic Sakura Pink
1003-H-G05|Blue Charm Gold
1003-H-P03|Candy Magic Pink
1003-H-B03|Colorful Cerulean Blue
1003-H-N05|Colorful Mint Green
1003-H-Y01|Coral Orange (Aston Martin)
1003-H-R06|Crimson Red (Tesla)
1003-H-V08|Deep Orchid Amethyst
1003-H-G02|Deep Space Grey
1003-H-W14|Diamond Pearl White
1003-H-P02|Diamond Rose Pink
1003-H-W13|Diamond White Charm Gold
1003-H-W06|Diamond White to Blue
1003-H-W04|Diamond White to Purple
1003-H-W02|Diamond White to Red
1003-H-U03|Glowing Blue Charm Pink
1003-H-P04|Glowing Vibrant Pink
1003-H-U01|Gold Diamond Glacier Blue
1003-H-V10|Gray Violet (Bentley)
1003-H-U02|Grey Charm Blue
1003-H-R05|Grey Charm Red
1003-H-V09|Magic Grey Charm Purple
1003-H-W15|Moonlight White
1003-H-W16|Pearl White (Lexus)
1003-H-B04|Pearlescent Black
1003-H-W07|Phantom White to Gold
1003-H-R02|Twilight Red
1003-H-W09|Twilight White
1003-H-B01|Yuanfeng Blue Charm Gold
1007-F-B01|Black Carbon Fiber
1004-J-S09|Alexander Silver
1004-J-S17|Tungsten Steel (Purple)
2004-J-V04|BMW Purple
2004-J-U08|Glacier Blue
1004-J-S01|Gt Silver
1004-J-P01|Ice Berry Pink
2004-J-C02|Liquid Metal Bronze
2004-J-U10|Liquid Metal Lake Blue
1004-J-U05|Crystal Diamond Blue
2004-J-N02|Francesca Green
2004-J-S18|Liquid Dark Silver
1004-J-R06|Liquid Metal Charming Red
2004-J-S11|Liquid Metal Grey
2004-J-U11|Liquid Metal Grise Cyan
2004-J-P03|Liquid Metal Jedi Pink
2004-J-C01|Liquid Metal Loganberry
2004-J-S04|Liquid Metal Silver
2004-J-U06|Liquid Metal Somato Blue
2004-J-S21|Liquid Metallic Gunmetal Gray
1004-J-U07|Metallic Fog Blue
2004-J-S06|Metallic Gunmetal Grey
1004-J-G07|Milan Gold
1004-J-S19|Moonlight Lime (Mercedes-Benz)
2004-J-V05|Rosemary Purple
1004-J-U13|Sepang Blue (Audi)
2004-J-G06|Victor Silver
1004-J-V06|Xiaguang Purple (Xiaomi)
1008-L-B01|Laser Black
`.trim().split('\n').map(l => l.split('|')));
const pNorm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function decodePaltrix(brand, code, name) {
  const b = String(brand || '').trim(), isBrand = /paltrix/i.test(b);
  if (b && !isBrand) return null;
  const m = String(code || '').toUpperCase().replace(/\s+/g, '').match(/^(\d{4})[-_.]?([A-Z])[-_.]?([A-Z])[-_.]?(\d{2})$/);
  let c = m ? m[1] + '-' + m[2] + '-' + m[3] + m[4] : '';
  if (c && !PALTRIX_SERIES[c.slice(0, 6)] && !isBrand) return null;
  if (!c && isBrand && name && !String(code || '').trim()) {          // no code printed: an exact catalog name only (two "Nardo" greys exist)
    const n = pNorm(name), hit = Object.keys(PALTRIX_COLORS).filter(k => pNorm(PALTRIX_COLORS[k]) === n);
    if (hit.length === 1) c = hit[0];
  }
  if (!c) return null;
  const ser = PALTRIX_SERIES[c.slice(0, 6)] || null, nm = PALTRIX_COLORS[c] || '';
  let finish = ser ? ser.finish : '', card = ser ? ser.card : '';
  if (c.startsWith('1005-Y') && /^satin/i.test(nm)) { finish = /metallic/i.test(nm) ? 'metallic satin' : 'satin'; card = 'satin'; }
  if (c.startsWith('1006-Z-L')) { finish = 'color shift'; card = 'color shift'; }
  return { code: c, name: nm, known: !!nm, series: ser ? ser.name : '', family: PALTRIX_FAMILY[c[7]] || '', finish, cardFinish: card,
    page: 'https://paltrixppf.com/colors/' + (ser ? ser.page : 'solid') + '/update/',
    url: nm ? 'https://paltrixppf.com/colors/' + (ser ? ser.page : 'solid') + '/update/' + nm.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '/' : '' };
}
export function paltrixLine(d) {
  return d.known
    ? 'Paltrix catalog (certain): ' + d.code + ' = ' + d.name + ', ' + d.series + ' (' + d.finish + '). Open its product page with web_fetch: ' + d.url + ' (if that address fails, the series list is ' + d.page + ').'
    : 'Paltrix code ' + d.code + ' is in the valid Paltrix format' + (d.series ? ' - ' + d.series + ' (' + d.finish + ')' : '') + (d.family ? ', ' + d.family + ' family' : '') + ', but not in the catalog list we have - look for it on paltrixppf.com; if it is not there, match from the sample photo and the name.';
}
const HEX = /^#?[0-9a-f]{6}$/i;
export function validateFilm(sp) {
  sp = sp && typeof sp === 'object' ? sp : {};
  return usDeep(validateFilm0(sp));
}
function validateFilm0(sp) {
  const hx = v => (HEX.test(String(v || '')) ? '#' + String(v).replace('#', '').toUpperCase() : '');
  const ft = ['color PPF', 'clear PPF', 'vinyl wrap', 'paint'], fin = FILM_TOOL.input_schema.properties.finish.enum;
  return {
    brand: clean(sp.brand, 40), product_line: clean(sp.product_line, 60), color_name: clean(sp.color_name, 60), code: clean(sp.code, 40),
    film_type: ft.includes(sp.film_type) ? sp.film_type : '', clear: sp.clear === true || sp.film_type === 'clear PPF',
    finish: fin.includes(sp.finish) ? sp.finish : '', base_color: clean(sp.base_color, 160),
    hex: { highlight: hx(sp.hex && sp.hex.highlight), mid: hx(sp.hex && sp.hex.mid), shadow: hx(sp.hex && sp.hex.shadow) },
    flake: { present: !!(sp.flake && sp.flake.present), color: clean(sp.flake && sp.flake.color, 60), size: clean(sp.flake && sp.flake.size, 20) },
    shift: { colors: clean(sp.shift && sp.shift.colors, 120) },
    lighting: ['sun', 'shade', 'overcast', 'night'].reduce((o, k) => { o[k] = clean(sp.lighting && sp.lighting[k], 200); return o; }, {}),
    render_notes: clean(sp.render_notes, 600),
    confidence: ['exact', 'close', 'estimate'].includes(sp.confidence) ? sp.confidence : 'estimate',
    sources: (Array.isArray(sp.sources) ? sp.sources : []).slice(0, 6).map(x => ({ title: clean(x && x.title, 120), url: /^https?:\/\//.test(String(x && x.url || '')) ? clean(x.url, 400) : '' })).filter(x => x.url),
    note: clean(sp.note, 600)
  };
}
const usSpell = v => typeof v === 'string' ? v.replace(/colour/g, 'color').replace(/Colour/g, 'Color').replace(/COLOUR/g, 'COLOR') : v;
function usDeep(o) { if (typeof o === 'string') return usSpell(o); if (Array.isArray(o)) return o.map(usDeep); if (o && typeof o === 'object') { for (const k of Object.keys(o)) if (k !== 'url') o[k] = usDeep(o[k]); } return o; }
export function filmRequest(body, env) {
  const ask = ['Brand: ' + clean(body.brand, 40), 'Product line: ' + clean(body.line, 60), 'Color name: ' + clean(body.name, 60), 'Color code: ' + clean(body.code, 40),
    'Owner says the finish is: ' + (clean(body.finish, 30) || 'not sure'), body.notes ? 'Owner notes: ' + clean(body.notes, 300) : '',
    decodePaltrix(body.brand, body.code, body.name) ? paltrixLine(decodePaltrix(body.brand, body.code, body.name)) : '',
    body.swatch && PHOTO_LIGHT[body.photoLight] ? PHOTO_LIGHT[body.photoLight] + ' Give the hex values and base color for the film itself in open shade, not as the photo shows it.' : ''].filter(Boolean).join('\n');
  const content = [];
  if (body.swatch && /^[A-Za-z0-9+/=]+$/.test(String(body.swatch).slice(0, 200))) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: body.swatch } }, { type: 'text', text: 'Above: the owner\'s photo of the sample.' });
  content.push({ type: 'text', text: 'Research this film so a render can match it exactly:\n' + ask });
  return { model: env.STUDIO_MODEL || DEFAULT_MODEL, max_tokens: 8000, system: FILM_BRIEF,
    /* SC1o - research could search but not open a page: "I could not open the paltrixppf.com page for 1002-C-A31". Web fetch
       (beta web-fetch-2025-09-10) opens the maker's page; the exact URL is in the request so it is allowed to. */
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }, { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 4 }, FILM_TOOL], tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content }] };
}
export async function runFilm({ body, store, fetchImpl, env }) {
  const id = safeId(body && body.id);
  if (!id) return { ok: false, error: 'bad id' };
  const key = 'film/' + id;
  await store.setJSON(key, { status: 'working', at: new Date().toISOString() });
  try {
    if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set in Netlify');
    if (!body.swatch && body.swatchId) { const im = await store.get('img/' + safeId(body.swatchId), { type: 'json' }); body = Object.assign({}, body, { swatch: (im && im.jpg) || '' }); }
    const req = filmRequest(body, env);
    let found = null, searches = 0;
    for (let turn = 0; turn < 6 && !found; turn++) {
      const res = await fetchImpl(API_URL, { method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-fetch-2025-09-10', 'content-type': 'application/json' }, body: JSON.stringify(req) });
      const txt = await res.text(); let d = null; try { d = JSON.parse(txt); } catch (e) {}
      if (!res.ok) throw new Error('Claude API ' + res.status + ': ' + ((d && d.error && d.error.message) || txt.slice(0, 200)));
      const blocks = (d && d.content) || [];
      searches += blocks.filter(b => b.type === 'server_tool_use').length;
      const use = blocks.find(b => b.type === 'tool_use' && b.name === 'submit_film');
      if (use) { found = use.input; break; }
      // pause_turn: hand the paused turn back unchanged; end_turn without the tool: ask for it
      req.messages = req.messages.concat({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '(no reply)' }] });
      if (d.stop_reason !== 'pause_turn') req.messages.push({ role: 'user', content: [{ type: 'text', text: 'Call submit_film now with what you found.' }] });
    }
    if (!found) throw new Error('The research did not finish - try again');
    const spec = validateFilm(found);
    const pd = decodePaltrix(body.brand, body.code, body.name);
    if (pd) {
      spec.code = pd.code; spec.brand = 'Paltrix';
      if (pd.known) { spec.color_name = pd.name; spec.product_line = pd.series; }
      if (!spec.finish && pd.finish) spec.finish = pd.finish;
      if (/recogni[sz]|format|invalid|not a (valid|known)|doesn.t match|unknown code/i.test(spec.note))
        spec.note = pd.known ? 'Paltrix ' + pd.code + ' is ' + pd.name + ' (' + pd.series + ').' : 'Paltrix ' + pd.code + ' is not on their site yet - matched from your card photo and the name. Check it against the card.';
    }
    await store.setJSON(key, { status: 'done', spec, searches, at: new Date().toISOString(), core: CORE_BUILD });
    return { ok: true, spec };
  } catch (e) {
    await store.setJSON(key, { status: 'error', error: clean(e && e.message || e, 300) });
    return { ok: false, error: String(e && e.message || e) };
  }
}
/* ══ SC1k - COLOR CARDS ═══════════════════════════════════════════════════
   Cole: "i only have sample color cards for the brands of all the colors". A photo of a maker's sample card
   (one chip or a whole fan / swatch book page) is read by Claude's vision: every chip, the brand / line / name /
   code printed by it, its finish, and where it sits in the photo, so the page can cut each chip out as that
   color's sample photo. */
export const CARD_TOOL = {
  name: 'submit_card',
  description: 'Return every color chip on the sample card photo.',
  input_schema: {
    type: 'object',
    properties: {
      brand: { type: 'string', description: 'The maker printed on the card, if any (XPEL, 3M, Avery Dennison, Paltrix, STEK, Inozetek ...)' },
      product_line: { type: 'string', description: 'The line printed on the card, if any (2080, SW900, Color PPF, Super Gloss ...)' },
      chips: {
        type: 'array', maxItems: 60,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The color name printed by the chip, exactly as printed' },
            code: { type: 'string', description: 'The code printed by the chip, exactly as printed (e.g. S261, P701G). Empty if none.' },
            finish: { type: 'string', enum: ['', 'gloss', 'satin', 'matte', 'metallic', 'color shift', 'chrome', 'clear'], description: 'From the printed text first, else from how the chip looks. Empty if unsure.' },
            box: { type: 'object', description: 'Where the COLORED area of the chip is in the photo, as fractions of the photo width / height (0-1), left x, top y, width w, height h. Only the color, not the label.',
              properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, required: ['x', 'y', 'w', 'h'] },
            readable: { type: 'boolean', description: 'False when the printed name or code could not be read clearly' }
          },
          required: ['name', 'box']
        }
      },
      note: { type: 'string', description: 'Anything the owner should check (glare on a chip, a label cut off, a chip with no label)' }
    },
    required: ['chips']
  }
};
export const CARD_BRIEF = 'You read photos of wrap and paint protection film sample cards for Excess Look Auto Solutions, a detailing and PPF shop. '
  + 'Find every color chip on the card. For each one, copy the name and code printed next to it exactly as printed - never guess a code that is not printed. '
  + 'Give the box of the colored area itself (not the label, not the card border) as fractions of the photo. Read the brand and product line from the card. '
  + 'Paltrix chips are coded like 1002-C-A31 (series - letter - family letter + 2 digits) - copy it as printed. '
  + 'Then call submit_card once.';
export function validateCard(c) {
  c = c && typeof c === 'object' ? c : {};
  const fin = CARD_TOOL.input_schema.properties.chips.items.properties.finish.enum;
  const n = v => Math.min(1, Math.max(0, Number(v) || 0));
  const chips = (Array.isArray(c.chips) ? c.chips : []).slice(0, 60).map(x => {
    const b = x && x.box || {};
    let bx = { x: n(b.x), y: n(b.y), w: n(b.w), h: n(b.h) };
    bx.w = Math.min(bx.w, 1 - bx.x); bx.h = Math.min(bx.h, 1 - bx.y);
    return { name: clean(x && x.name, 60), code: clean(x && x.code, 40), finish: fin.includes(x && x.finish) ? x.finish : '', box: bx, readable: !(x && x.readable === false) };
  }).filter(x => (x.name || x.code) && x.box.w > 0.005 && x.box.h > 0.005);
  const brand = clean(c.brand, 40);
  let pal = false;
  chips.forEach(x => { const d = decodePaltrix(brand, x.code, x.name); if (d) { pal = true; x.code = d.code; if (d.known && !x.name) x.name = d.name; if (d.cardFinish) x.finish = d.cardFinish; } });
  return { brand: brand || (pal ? 'Paltrix' : ''), product_line: clean(c.product_line, 60), chips, note: clean(c.note, 300) };
}
export async function runCard({ body, store, fetchImpl, env }) {
  const id = safeId(body && body.id);
  if (!id) return { ok: false, error: 'bad id' };
  const key = 'card/' + id;
  await store.setJSON(key, { status: 'working', at: new Date().toISOString() });
  try {
    if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set in Netlify');
    let jpg = String(body.jpg || '');
    if (!jpg && body.imgId) { const im = await store.get('img/' + safeId(body.imgId), { type: 'json' }); jpg = (im && im.jpg) || ''; }
    if (!/^[A-Za-z0-9+/=]+$/.test(jpg.slice(0, 200)) || jpg.length < 100) throw new Error('The card photo did not arrive - try again');
    const req = { model: env.STUDIO_MODEL || DEFAULT_MODEL, max_tokens: 8000, system: CARD_BRIEF, tools: [CARD_TOOL], tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpg } },
        { type: 'text', text: 'Read every chip on this sample card.' + (body.hint ? ' The owner says: ' + clean(body.hint, 200) : '') }] }] };
    let found = null;
    for (let turn = 0; turn < 2 && !found; turn++) {
      const res = await fetchImpl(API_URL, { method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(req) });
      const txt = await res.text(); let d = null; try { d = JSON.parse(txt); } catch (e) {}
      if (!res.ok) throw new Error('Claude API ' + res.status + ': ' + ((d && d.error && d.error.message) || txt.slice(0, 200)));
      const use = ((d && d.content) || []).find(b => b.type === 'tool_use' && b.name === 'submit_card');
      if (use) { found = use.input; break; }
      req.messages = req.messages.concat({ role: 'assistant', content: (d && d.content && d.content.length) ? d.content : [{ type: 'text', text: '(no reply)' }] },
        { role: 'user', content: [{ type: 'text', text: 'Call submit_card now.' }] });
    }
    if (!found) throw new Error('The card could not be read - try a straighter, closer photo');
    const card = validateCard(found);
    if (!card.chips.length) throw new Error('No color chips found on that photo - fill the frame with the card, straight on');
    await store.setJSON(key, { status: 'done', card, at: new Date().toISOString() });
    if (body.imgId) await store.delete('img/' + safeId(body.imgId));
    return { ok: true, card };
  } catch (e) {
    await store.setJSON(key, { status: 'error', error: clean(e && e.message || e, 300) });
    return { ok: false, error: String(e && e.message || e) };
  }
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
