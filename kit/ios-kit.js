/* ══════════════════════════════════════════════════════════════════════════
   EXCESS LOOK - iOS KIT v2.11
   v2.11 (S19se, 2026-10-15): menu(anchor, items, opts). opts.host names the
   stacking context the anchor lives in, so the veil joins it and the pressed
   button stays sharp (a .modal is transformed; a phone's sticky modal header
   has its own z-index - the .cal-popup rule could not see either).
   opts.align 'end' lines the menu's right edge up with the anchor's, for a
   top-right button. Defaults unchanged. Proven in xslook-app/tests/test-invmenu.js.
   v2.10 (S19sb, 2026-10-13): two context-menu fixes. (1) A right-click also
   starts the long-press timer; when the release landed on the veil the timer
   was never cleared and the menu opened a second time 480ms later - now the
   contextmenu handler clears it. (2) A menu opened from inside a .cal-popup
   blurred its own row: the popup is a stacking context, so the lifted row
   could not rise above a <body>-level veil. The veil now joins that popup.
   Proven in xslook-app/tests/test-rostercost.js (4b) and on screen.
   v2.9 (S19rx, 2026-10-13): rubberBand moves like a rubber band. It eases
   out instead of jumping, never freezes at the peak, comes home on a
   critically damped spring (no overshoot, still in ~0.6s), and can be caught
   mid-return. Proven frame by frame in xslook-app/tests/test-rubberband.js.
   v2.8 (S19ol, 2026-09-18): rubberBand wheel listener is passive, and it
   caches scrollHeight/clientHeight instead of reading them every tick.
   Extracted from the running app, excess-look-v19se.html, block 0.
   The single source of truth for every interaction pattern.

   RULE: no lab and no production build reinvents any of these. Paste this
   whole file into a lab (inside one <script>), pair it with ios-kit.css, and
   call XLKit.init(). If a pattern needs changing, change it HERE and re-paste
   into the labs - never edit a copy in place.

   Covers:  press feedback . spring physics . rubber band . toast + undo
            themed dialog . themed prompt . context menu . bottom sheet
            counting numbers . collapsing title . tab bar shrink
            pull-down search . disclosure . escape handling . reduce motion
   ══════════════════════════════════════════════════════════════════════════ */
window.XLKit = (function () {

  const $ = id => document.getElementById(id);
  const reduced = () => document.body.classList.contains('rm')
    || matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── 1. SPRING PHYSICS ───────────────────────────────────────────────────
     Never use a CSS transition for a release-from-drag. A transition has one
     fixed curve and no memory of velocity; iOS uses a damped spring.
     k = stiffness, c = damping. k=110 c=13.5 settles in ~880ms with a 5px
     overshoot, which is the tuned default.                                  */
  function spring(from, onFrame, opts) {
    const o = Object.assign({ k: 110, c: 13.5, v0: 0, done: null }, opts || {});
    if (reduced()) { onFrame(0); if (o.done) o.done(); return () => {}; }
    let x = from, v = o.v0, raf = null, last = performance.now();
    const step = now => {
      const dt = Math.min(0.032, (now - last) / 1000); last = now;
      v += (-o.k * x - o.c * v) * dt;
      x += v * dt;
      if (Math.abs(x) < 0.15 && Math.abs(v) < 2) { onFrame(0); if (o.done) o.done(); return; }
      onFrame(x);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }

  /* ── 2. RUBBER BAND ──────────────────────────────────────────────────────
     Native overscroll stretch exists only on macOS trackpads and iOS. On a
     Windows desktop scrolling just stops dead, so every scrollable surface
     gets this or it silently feels wrong on half our devices.
     Pass the scroll container; it wraps its children in a transform layer.  */
  /* v2.0 - `opts.wheelOnly`.
     The mouse-drag half of this binds pointerdown/move/up to the scroller. In
     a lab that is harmless. In an app that already uses HTML5 draggable - a
     calendar job, a workflow card - it is not: during an HTML5 drag the
     browser SUPPRESSES pointermove and pointerup, so the internal `drag` flag
     is left true after the drag ends and the next mouse move stretches the
     page for no reason. wheelOnly keeps the wheel overscroll, which is the
     part anyone actually sees, and skips the pointer listeners entirely.
     Default false, so all 25 labs behave exactly as before. */
  /* v2.4 - short pages rubber band again, gently, and the host can listen.
     v2.3 switched the stretch off entirely on a scroller with nothing to
     scroll, because both edges read as true at once and every wheel event
     flung the content off screen. Cole wants those pages to respond to the
     pull instead of going dead - so the stretch comes back with a much
     shorter asymptote (`shortL`, default 44px: a nudge, not a fling), and
     `onStretch(px)` reports the visual offset every frame so the host can
     collapse a header, hold it in place, or whatever else fits the page. */
  /* v2.6 - LAYERS OVER THE SCROLLER. A modal, sheet, menu or overlay that
     lives INSIDE the scroller still receives the scroller's wheel and pointer
     listeners by bubbling. The rubber band and pull-to-search must ignore any
     event that started on one, or the page behind a modal stretches and the
     modal itself never scrolls. The host can extend the list with
     XLKit.setLayerSelector before wiring. */
  let LAYER_SELECTOR = '.cal-popup,.cal-expand-popup,.overlay,.pw-overlay,.move-sheet-overlay,.modal,.xl-dlg-veil,.xl-dlg,.xl-menu,.xl-sheet-veil,[data-layer]';
  function onLayer(e) {
    const t = e && e.target && e.target.closest ? e.target : null;
    return !!(t && t.closest(LAYER_SELECTOR));
  }
  function setLayerSelector(sel) { LAYER_SELECTOR = String(sel || LAYER_SELECTOR); }

  function rubberBand(el, opts) {
    if (!el || el.dataset.rb === '1') return;
    /* v2.5 - `shortBelow`. "Short" used to mean "cannot scroll at all", which
       left a gap: a page with 1-59px of range could scroll, so it got the
       long stretch and no stretch-driven collapse, but could never reach a
       60px scroll threshold either. It fell between both mechanisms.
       A page is now short when its scroll RANGE is under shortBelow. That is
       one threshold for both the stretch length and the host's decision
       about what drives its header - and the kit reports it, so the host
       does not compute its own slightly different version. */
    const ro = Object.assign({ wheelOnly: false, shortL: 44, shortBelow: 60, onStretch: null }, opts || {});
    el.dataset.rb = '1';
    let inner = el.querySelector(':scope > .xl-rb');
    if (!inner) {
      inner = document.createElement('div');
      inner.className = 'xl-rb';
      while (el.firstChild) inner.appendChild(el.firstChild);
      el.appendChild(inner);
    }
    let stretch = 0, shown = 0, relaxT = null, py = 0, drag = false;
    /* v2.9 / S19rx - THE STRETCH MOVES LIKE A RUBBER BAND, NOT A STEP AND A SPRING.
       Cole: it was never laggy - it was slow, not a natural fluid path.
       Measured on v2.8, one wheel click at the top of a long page: the
       content JUMPED the whole 47px in one frame, sat FROZEN at the peak for
       ~230ms (the 190ms "has the wheel stopped?" wait), then came back on
       spring() k=110 c=13.5 - underdamped, ratio .64 - so it crossed its
       resting place by 5% and was still moving ~830ms after the click.
       iOS returns a scroll edge on a CRITICALLY damped spring: no overshoot,
       home in about half a second, never frozen.

       Now one animator owns the offset. Each frame it moves `shown` toward a
       target on a critically damped spring, solved exactly (stable at any
       frame time, so a dropped frame never makes it jump):
         wheel feeding it  - target = damp(stretch), w = W_FOLLOW: a click
                             eases out over ~80ms instead of teleporting;
                             a trackpad's fine stream is followed within a
                             frame or two;
         input stopped     - after WAIT ms, target 0, w = W_HOME: 90% home
                             in ~0.3s, still by ~0.55s, never past zero.
       Interruptible both ways: a wheel event during the return picks the
       stretch up from where the content IS (undamp(shown)), so the band is
       caught mid-flight instead of snapping. A mouse drag still tracks 1:1
       and hands its release velocity to the return.
       spring() above is unchanged - its other callers keep their feel. */
    const W_FOLLOW = 38, W_HOME = 14, WAIT = 110;
    let vel = 0, target = 0, w = W_FOLLOW, raf = null, lastT = 0, held = false;
    /* ═══ v2.8 / S19ol - THE WHEEL IS PASSIVE, AND NOTHING IS MEASURED IN IT ═
       Cole: the rubber band is laggy when scrolling to the top of the page.

       The listener below was {passive:false} and read scrollHeight,
       clientHeight and scrollTop on EVERY wheel event to decide whether it
       was at an edge. Two costs, both paid on every tick of the wheel, not
       just at the edges:

         non-passive  - the browser cannot scroll until this handler returns,
                        so the compositor waits on the main thread every tick
         layout reads - each one can force a synchronous layout if anything
                        has changed since the last frame, and on this app
                        something usually has

       So ordinary scrolling, nowhere near an edge, ran through JavaScript
       and a possible layout before the page could move. That is the lag.

       Now: the listener is PASSIVE. It never calls preventDefault - it does
       not need to. At scrollTop 0 a wheel-up scrolls nothing natively, and
       overscroll-behavior:contain on the element stops the browser's own
       bounce and any chaining to the page. What the eye sees at the edge is
       entirely this code's transform, same as before, but the browser is
       free to scroll on the compositor and never waits for us.

       And the sizes are cached. scrollHeight and clientHeight are read once,
       then again only when something that changes them fires - a scroll, a
       resize, or the content growing (ResizeObserver on the inner wrapper).
       The wheel handler reads scrollTop, which is cheap, and two numbers. */
    el.style.overscrollBehavior = 'contain';
    let sh = 0, ch = 0, mRaf = null;
    const measure = () => { sh = el.scrollHeight; ch = el.clientHeight; };
    const remeasure = () => { if (mRaf) return; mRaf = requestAnimationFrame(() => { mRaf = null; measure(); }); };
    el.addEventListener('scroll', remeasure, { passive: true });
    window.addEventListener('resize', remeasure, { passive: true });
    if (window.ResizeObserver) { try { new ResizeObserver(remeasure).observe(inner); } catch (e) {} }
    measure();
    const atTop = () => el.scrollTop <= 0;
    const atBot = () => Math.ceil(el.scrollTop + ch) >= sh - 1;
    /* v2.1 - ASYMPTOTIC DAMPING, replacing a hard cap.
       Was: sign(d) * min(90, |d|^0.78). The min() is a WALL - pull past ~430
       units of input and the content simply stops moving, which reads as the
       scroll being broken rather than resisted.
       Now the standard rubber-band curve used by iOS and Chromium:
           f(x) = (x . dim . c) / (dim + c . x)
       It approaches dim*c and never reaches it, so the stretch always keeps
       growing while you keep scrolling and just gets progressively harder.
       L is the asymptote - the stretch approaches it and never arrives, so
       the further you pull the harder it resists, with no wall to hit.
       L is proportional to the viewport so it feels the same on a phone and a
       27" monitor, floored at 120px so a short window still gets a real
       effect. On an 800px viewport L = 224px, and:
         one wheel click ....  47px      sustained scroll .... 163px
         two clicks .........  78px      very long scroll ... 208px
       Do NOT write this as (x*dim*c)/(dim+c*x) with dim = clientHeight. That
       form's asymptote is dim, not dim*c - it was tried and produced 539px of
       stretch on a long scroll, most of the screen. */
    const isShort = () => (sh - ch) < ro.shortBelow;
    /* v2.7 - a page with NOTHING to scroll must not eat the wheel. When the
       content exactly fits - Cole's QB Export page was 1261px in a 1261px
       viewport - both edges read true, every wheel is an overscroll, and the
       page rubber bands instead of doing nothing. A stretch is a response to
       hitting the end of something; with no scroll range there is no end to
       hit. v2.3 had this and v2.4 removed it to give short pages a nudge;
       the nudge belongs to pages that CAN scroll a little, not to pages that
       cannot scroll at all. */
    const canScroll = () => (sh - ch) > 1;
    const damp = d => {
      const s = Math.sign(d), x = Math.abs(d);
      // A page with little or nothing to scroll gets a nudge, not a fling.
      const L = isShort() ? ro.shortL : Math.max(120, (ch || 600) * 0.28);
      return s * (x * L) / (L + x);
    };
    const paint = x => {
      shown = x;
      inner.style.transform = x ? 'translateY(' + x.toFixed(2) + 'px)' : '';
      if (ro.onStretch) ro.onStretch(x, isShort());
    };
    // v2.9 - the inverse of damp: how much input puts the content where it is now.
    const undamp = f => {
      const L = isShort() ? ro.shortL : Math.max(120, (ch || 600) * 0.28);
      const a = Math.min(Math.abs(f), L * 0.98);
      return Math.sign(f) * (a * L) / (L - a);
    };
    // v2.9 - critically damped step toward `target`, exact for any dt.
    const tick = now => {
      raf = null;
      if (held) return;                                 // a drag paints directly
      const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000)); lastT = now;
      const d0 = shown - target, ex = Math.exp(-w * dt);
      const d = (d0 + (vel + w * d0) * dt) * ex;
      vel = (vel - w * (vel + w * d0) * dt) * ex;
      if (target === 0 && Math.abs(d) < 0.15 && Math.abs(vel) < 4) { vel = 0; paint(0); return; }
      paint(target + d);
      raf = requestAnimationFrame(tick);
    };
    const run = () => {
      if (reduced()) { vel = 0; paint(target); return; }   // Reduce Motion: no travel, straight there
      if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(tick); }
    };
    const pull = () => { target = damp(stretch); w = W_FOLLOW; run(); };
    const relax = () => { clearTimeout(relaxT); stretch = 0; target = 0; w = W_HOME; run(); };
    /* v2.3 - a scroller with NOTHING TO SCROLL must not rubber band.
       When the content is shorter than the box, atTop() and atBot() are both
       true at once, so every wheel event reads as an overscroll: wheel down
       flings the content UP off the screen, wheel up drops it down, and the
       page never scrolls because it cannot. Any collapsing header driven by
       scrollTop can never fire on such a page, and the content bounces
       instead. Seen in production on every short page of XSLook.
       If there is nothing to scroll, do nothing: no preventDefault, no
       stretch, the event passes through untouched. */
    el.addEventListener('wheel', e => {
      if (onLayer(e)) return;                           // v2.6 - the wheel belongs to the modal
      if (!canScroll()) return;                         // v2.7 - nothing to scroll, nothing to stretch
      const up = e.deltaY < 0 && atTop(), down = e.deltaY > 0 && atBot();
      if (!up && !down) { if (stretch || shown) relax(); return; }
      // v2.8 - no preventDefault. See the note above: overscroll-behavior
      // does the containing, and a passive listener is not allowed to anyway.
      /* v2.1 - the +/-160 clamp on the RAW input is gone too. It was there to
         stop the old power curve running away; the asymptotic curve above
         cannot run away, so clamping the input just reintroduced the same
         wall one step earlier. Loosely bounded now only to keep the number
         sane over a very long scroll. */
      if (!stretch && shown) stretch = undamp(shown);   // v2.9 - caught mid-return: carry on from where it is
      stretch = Math.max(-4000, Math.min(4000, stretch + (-e.deltaY) * 0.6));
      pull();
      /* 110ms was too tight for a discrete mouse wheel: deliberate clicks can
         be 150ms apart, so each one sprang back before the next arrived and
         the whole thing stuttered instead of accumulating. 190ms lets a
         continuous scroll build, and still snaps back promptly on release.
         v2.9 - WAIT is 110ms again. The stutter 190ms fixed came from each
         click snapping back on its own; now the return is caught and
         carried by the next click, so a click series just keeps the band
         moving - and the freeze at the peak, which read as slowness, is
         nearly halved. */
      clearTimeout(relaxT); relaxT = setTimeout(relax, WAIT);
    }, { passive: true });
    if (ro.wheelOnly) return;
    // v2.9 - a drag tracks 1:1 (damped), can grab the band mid-return, and
    // releases with the velocity it was moving at.
    let pLast = 0, pT = 0;
    el.addEventListener('pointerdown', e => { if (e.pointerType === 'touch' || onLayer(e)) return; py = e.clientY - undamp(shown); drag = true; pLast = shown; pT = performance.now(); });   // v2.6 - not over a layer
    el.addEventListener('pointermove', e => {
      if (!drag) return;
      const d = e.clientY - py;
      if ((d > 0 && atTop()) || (d < 0 && atBot())) {
        held = true; clearTimeout(relaxT); stretch = d;
        const x = damp(d), now = performance.now();
        if (now > pT) vel = (x - pLast) / ((now - pT) / 1000);
        pLast = x; pT = now; paint(x);
      }
    });
    const up = () => { if (!drag) return; drag = false; if (performance.now() - pT > 80) vel = 0; held = false; relax(); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  /* ── 3. PRESS FEEDBACK ───────────────────────────────────────────────────
     Every interactive element responds inside 100ms. On the web there is no
     haptic engine, so the press-scale IS the haptic. Applied by class so no
     element is ever missed.                                                 */
  function pressAll(root) {
    (root || document).querySelectorAll(
      'button, .press, [role="button"], .app, .veh, .item, .tab, .mo, .tb-btn, .q'
    ).forEach(el => el.classList.add('press'));
  }

  /* ── 4. TOAST WITH UNDO ──────────────────────────────────────────────────
     Optimistic UI: act now, offer Undo. Confirm only destructive and
     irreversible things.                                                    */
  /* v1.8 - third argument {error:true} marks a failure. Added because the app
     and the pay page both call showToast(msg, isError) with a FLAG in the
     second slot, and a success checkmark next to "Charge failed" is a lie.
     A failure also gets longer on screen than a success: there is more to
     read and more at stake. */
  const TIC_OK  = '<polyline points="4,12 9,17 20,6"/>';
  const TIC_ERR = '<circle cx="12" cy="12" r="9"/><line x1="12" y1="7.4" x2="12" y2="13"/><circle cx="12" cy="16.6" r=".7"/>';
  let tT = null, undoFn = null;
  function toast(msg, undo, opts) {
    const o = Object.assign({ error: false }, opts || {});
    let t = $('xl-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'xl-toast'; t.className = 'xl-toast';
      t.innerHTML = '<div class="tic"><svg viewBox="0 0 24 24"></svg></div>'
        + '<span class="tt"></span><b class="tu" style="display:none">Undo</b>';
      document.body.appendChild(t);
      t.querySelector('.tu').addEventListener('click', () => {
        t.classList.remove('on'); if (undoFn) undoFn();
      });
    }
    t.classList.toggle('error', !!o.error);
    t.querySelector('.tic').innerHTML =
      '<svg viewBox="0 0 24 24">' + (o.error ? TIC_ERR : TIC_OK) + '</svg>';
    t.querySelector('.tt').textContent = msg;
    undoFn = undo || null;
    t.querySelector('.tu').style.display = undo ? 'inline' : 'none';
    t.classList.add('on');
    clearTimeout(tT);
    tT = setTimeout(() => t.classList.remove('on'), undo ? 5600 : (o.error ? 3400 : 2100));
  }

  /* ── 5. THEMED DIALOG - replaces every native confirm/alert ──────────── */
  /* `single: true` hides the cancel button. Use it when the dialog only tells
     you something - two buttons that do the same thing is a false choice, and
     it makes the reader stop and work out the difference for no reason. */
  function confirm(title, body, onOk, opts) {
    const o = Object.assign({ okText: 'Confirm', cancelText: 'Cancel', danger: false,
                              onCancel: null, single: false }, opts || {});
    let v = $('xl-dlg-veil'), d = $('xl-dlg');
    if (!v) {
      v = document.createElement('div'); v.id = 'xl-dlg-veil'; v.className = 'xl-dlg-veil';
      d = document.createElement('div'); d.id = 'xl-dlg'; d.className = 'xl-dlg';
      document.body.appendChild(v); document.body.appendChild(d);
      v.addEventListener('click', () => close(true));
    }
    const close = cancelled => {
      v.classList.remove('on'); d.classList.remove('on');
      if (cancelled && o.onCancel) o.onCancel();
    };
    d.innerHTML =
      '<div class="xl-dlg-ic' + (o.danger ? ' danger' : '') + '"><svg viewBox="0 0 24 24">'
      + (o.danger
        ? '<polyline points="4,7 20,7"/><path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2"/><path d="M6 7l1 13h10l1-13"/>'
        : '<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="16.5" r=".6"/>')
      + '</svg></div>'
      + '<div class="xl-dlg-t">' + title + '</div>'
      + '<div class="xl-dlg-b">' + body + '</div>'
      + '<div class="xl-dlg-btns">'
      + (o.single ? '' : '<button class="xl-btn ghost press xl-c">' + o.cancelText + '</button>')
      + '<button class="xl-btn ' + (o.danger ? 'danger' : 'gold') + ' press xl-o">' + o.okText + '</button></div>';
    const cancelBtn = d.querySelector('.xl-c');
    if (cancelBtn) cancelBtn.onclick = () => close(true);
    d.querySelector('.xl-o').onclick = () => { close(false); if (onOk) onOk(); };
    v.classList.add('on'); d.classList.add('on');
    pressAll(d);
  }

  /* ── 6. THEMED PROMPT - replaces native prompt() ─────────────────────── */
  function prompt(title, body, placeholder) {
    return new Promise(resolve => {
      confirm(title,
        body + '<input id="xl-prompt-in" class="xl-input" placeholder="' + (placeholder || '') + '" autocomplete="off">',
        () => { const el = $('xl-prompt-in'); resolve(el ? el.value.trim() : ''); },
        { okText: 'Add', onCancel: () => resolve('') });
      setTimeout(() => { const el = $('xl-prompt-in'); if (el) el.focus(); }, 80);
    });
  }

  /* ── 6b. MULTI-LINE PROMPT - "add several" always means several ─────────
     A single-line prompt for a bulk action is a bug. This takes one item per
     line, counts them live, and resolves an array.                          */
  function promptList(title, body, placeholder) {
    return new Promise(resolve => {
      confirm(title,
        body + '<textarea id="xl-prompt-list" class="xl-input xl-textarea" rows="5" placeholder="'
        + (placeholder || '') + '" autocomplete="off"></textarea>'
        + '<div class="xl-prompt-count" id="xl-prompt-count">Nothing entered yet</div>',
        () => {
          const el = $('xl-prompt-list');
          const lines = el ? el.value.split('\n').map(x => x.trim()).filter(Boolean) : [];
          resolve(lines);
        },
        { okText: 'Add', onCancel: () => resolve([]) });
      setTimeout(() => {
        const el = $('xl-prompt-list'), c = $('xl-prompt-count'), ok = document.querySelector('#xl-dlg .xl-o');
        if (!el) return;
        el.focus();
        const upd = () => {
          const n = el.value.split('\n').map(x => x.trim()).filter(Boolean).length;
          if (c) c.textContent = n ? n + ' vehicle' + (n === 1 ? '' : 's') + ' will be added' : 'One per line';
          if (ok) { ok.textContent = n > 1 ? 'Add ' + n : 'Add'; ok.disabled = n === 0; }
        };
        el.addEventListener('input', upd);
        upd();
      }, 80);
    });
  }

  /* ── 7. CONTEXT MENU ─────────────────────────────────────────────────────
     The pressed element lifts SHARP above the blur - it must never blur with
     the background. The menu anchors to that element, below it when there is
     room and above it when there is not.                                    */
  let menuEl = null, liftedEl = null;
  function menu(anchor, items, opts) {
    let v = $('xl-menu-veil'), m = $('xl-menu');
    if (!v) {
      v = document.createElement('div'); v.id = 'xl-menu-veil'; v.className = 'xl-menu-veil';
      m = document.createElement('div'); m.id = 'xl-menu'; m.className = 'xl-menu';
      document.body.appendChild(v); document.body.appendChild(m);
      v.addEventListener('click', closeMenu);
    }
    m.innerHTML = '';
    items.forEach(it => {
      if (it === '-') { const s = document.createElement('div'); s.className = 'xl-menu-sep'; m.appendChild(s); return; }
      const b = document.createElement('button');
      if (it.danger) b.className = 'red';
      b.innerHTML = (it.icon || '') + '<span>' + it.label + '</span>';
      b.addEventListener('click', () => { closeMenu(); if (it.action) it.action(); });
      m.appendChild(b);
    });
    /* v2.10 (S19sb) - inside a popup the pressed row could not rise above the
       veil: the popup is its own stacking context, so the row's z-index only
       counts inside it and the body-level veil blurred it with everything
       else. The veil now joins the popup it was opened from, so the row stays
       sharp above it there too. Outside a popup it lives in <body> as before. */
    /* v2.11 (S19se) - `opts.host`. A button in a modal's header sits inside
       stacking contexts the .cal-popup rule cannot see (the .modal is
       transformed; on a phone its sticky header has its own z-index), so the
       caller names the context its anchor lives in. Default unchanged. */
    const host = (opts && opts.host) || anchor.closest('.cal-popup') || document.body;
    if (v.parentNode !== host) host.appendChild(v);
    anchor.classList.add('xl-lifted'); liftedEl = anchor;
    const r = anchor.getBoundingClientRect();
    v.classList.add('on'); m.classList.add('on');
    const W = m.offsetWidth || 240, H = m.offsetHeight || 200, gap = 10;
    const below = r.bottom + gap + H <= window.innerHeight - 8;
    m.style.top = (below ? r.bottom + gap : Math.max(8, r.top - gap - H)) + 'px';
    /* v2.11 (S19se) - `opts.align: 'end'` lines the menu's right edge up with
       the anchor's, the way a top-right button's menu opens. Default unchanged. */
    const endAl = !!(opts && opts.align === 'end');
    m.style.left = Math.min(window.innerWidth - W - 8, Math.max(8, endAl ? r.right - W : r.left)) + 'px';
    m.style.transformOrigin = (below ? 'top' : 'bottom') + (endAl ? ' right' : ' left');
    menuEl = m;
    pressAll(m);
  }
  function closeMenu() {
    if ($('xl-menu-veil')) $('xl-menu-veil').classList.remove('on');
    if ($('xl-menu')) $('xl-menu').classList.remove('on');
    if (liftedEl) { liftedEl.classList.remove('xl-lifted'); liftedEl = null; }
  }
  /* Attaches long-press (480ms) and right-click to any element. */
  function attachMenu(el, itemsFn) {
    let h = null, sx = 0, sy = 0;
    el.addEventListener('pointerdown', e => {
      // A container can suppress menus for its children - used by arrange
      // mode, where a long-press means drag, not menu. Never do this with a
      // capture-phase stopPropagation: that kills every other handler too.
      if (el.closest('[data-noctx="1"]')) return;
      sx = e.clientX; sy = e.clientY;
      clearTimeout(h); h = setTimeout(() => menu(el, itemsFn()), 480);
    });
    el.addEventListener('pointermove', e => {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8) clearTimeout(h);
    });
    el.addEventListener('pointerup', () => clearTimeout(h));
    el.addEventListener('pointercancel', () => clearTimeout(h));
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      /* v2.10 (S19sb) - a right-click also starts the hold timer on pointerdown.
         If the release lands on the veil instead of the element, nothing
         cleared it, and 480ms later the menu opened a second time - on top of
         whatever the first menu's choice had just done. */
      clearTimeout(h);
      if (el.closest('[data-noctx="1"]')) return;
      menu(el, itemsFn());
    });
  }

  /* ── 7b. TAP vs HOLD ─────────────────────────────────────────────────────
     One button, two depths: a tap runs the most likely action, a hold (or a
     right-click) opens the full menu. The ellipsis in a nav bar is the
     canonical use. Cancels the tap if the finger moves, so a scroll that
     starts on the button never fires it.                                    */
  function tapHold(el, onTap, itemsFn) {
    let h = null, held = false, sx = 0, sy = 0;
    el.addEventListener('pointerdown', e => {
      if (el.closest('[data-noctx="1"]')) return;
      held = false; sx = e.clientX; sy = e.clientY;
      clearTimeout(h);
      h = setTimeout(() => { held = true; el.classList.add('xl-holding'); menu(el, itemsFn()); }, 420);
    });
    el.addEventListener('pointermove', e => {
      if (Math.hypot(e.clientX - sx, e.clientY - sy) > 8) clearTimeout(h);
    });
    el.addEventListener('pointerup', () => {
      clearTimeout(h);
      el.classList.remove('xl-holding');
      if (!held && onTap) onTap();
    });
    el.addEventListener('pointercancel', () => { clearTimeout(h); el.classList.remove('xl-holding'); });
    el.addEventListener('contextmenu', e => { e.preventDefault(); menu(el, itemsFn()); });
  }

  /* ── 8. BOTTOM SHEET - 1:1 grabber drag, interruptible, spring release ── */
  /* v1.9 - `opts.onClose` added.
     The labs all use `.on` to mean open, so v1.7 dismissed a sheet with
     el.classList.remove('on'). XSLook uses `.hidden` to mean CLOSED, on 296
     call sites, and it also runs real work on close - showConfirm's
     runConfirmCancel() consumes confirmCallback so it cannot leak into the
     next dialog. Dropping v1.7's sheet onto that app would animate a popup
     out of view and leave it OPEN, with its close logic never run.
     onClose lets the host say how a sheet closes. Default is unchanged, so
     every existing lab behaves exactly as before. */
  function sheet(el, grabber, opts) {
    if (!el || el.dataset.sheet === '1') return;
    const o = Object.assign({ onClose: null }, opts || {});
    el.dataset.sheet = '1';
    let sy = 0, cur = 0, dragging = false, last = 0, lastT = 0, vel = 0;
    const readY = () => {
      const m = getComputedStyle(el).transform;
      if (!m || m === 'none') return 0;
      const p = m.split(','); return parseFloat(p[5] || p[13] || 0);
    };
    grabber.addEventListener('pointerdown', e => {
      dragging = true; sy = e.clientY; last = sy; lastT = performance.now(); vel = 0;
      cur = readY();                       // interruptible: take over from where it is
      el.style.transition = 'none';
      el.style.transform = 'translateY(' + cur + 'px)';
      grabber.setPointerCapture(e.pointerId);
    });
    grabber.addEventListener('pointermove', e => {
      if (!dragging) return;
      const now = performance.now();
      vel = (e.clientY - last) / Math.max(1, now - lastT); last = e.clientY; lastT = now;
      const y = Math.max(-40, cur + (e.clientY - sy));
      el.style.transform = 'translateY(' + (y < 0 ? y * 0.35 : y) + 'px)';
    });
    const end = () => {
      if (!dragging) return; dragging = false;
      const y = readY();
      el.style.transition = '';
      if (vel > 0.9 || y > el.offsetHeight * 0.45) {
        el.style.transform = '';          // never leave a transform behind - it
                                          // creates a containing block for any
                                          // fixed or iframe child
        if (o.onClose) o.onClose(); else el.classList.remove('on');
      } else el.style.transform = 'translateY(0)';
    };
    grabber.addEventListener('pointerup', end);
    grabber.addEventListener('pointercancel', end);
  }

  /* ── 8b. FLIP - animate only what changed ────────────────────────────────
     Pass the elements that might move and a mutate function. Measures, runs
     the mutation, then glides each element from its old box to its new one.
     Never rebuild a list to reflect one item - that is what makes a web app
     feel like a web app.                                                    */
  function flip(els, mutate, ms) {
    const list = [...els];
    const before = new Map(list.map(e => [e, e.getBoundingClientRect()]));
    mutate();
    if (reduced()) return;
    [...new Set(list.concat([...document.querySelectorAll('[data-flip]')]))].forEach(e => {
      const b = before.get(e); if (!b || !e.isConnected) return;
      const a = e.getBoundingClientRect();
      const dx = b.left - a.left, dy = b.top - a.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      e.style.transition = 'none';
      e.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      requestAnimationFrame(() => {
        e.style.transition = 'transform ' + (ms || 620) + 'ms cubic-bezier(.22,.9,.30,1)';
        e.style.transform = '';
      });
      const clear = () => { e.style.transition = ''; e.style.transform = ''; e.removeEventListener('transitionend', clear); };
      e.addEventListener('transitionend', clear);
    });
  }

  /* ── 8c. MONEY ───────────────────────────────────────────────────────────
     One formatter and one parser, so no page invents its own rounding.      */
  const money = n => '$' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const money0 = n => '$' + Math.round(Number(n) || 0).toLocaleString();
  const parseMoney = v => Math.round((parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0) * 100) / 100;
  /* Binds a money input: selects on focus, normalises on blur, reports back. */
  function moneyField(input, onChange) {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('blur', () => {
      const v = parseMoney(input.value);
      input.value = v.toFixed(2);
      if (onChange) onChange(v);
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  }

  /* ── 8d. REPEATABLE ROWS - add / remove with undo ────────────────────────
     Service lines, materials, vehicles: every list a user can extend behaves
     the same, and every removal is undoable rather than gone.               */
  function repeater(opts) {
    const o = Object.assign({ host: null, rows: [], blank: () => ({}), render: null, onChange: null }, opts);
    function paint() {
      o.host.innerHTML = '';
      o.rows.forEach((r, i) => {
        const el = o.render(r, i);
        el.dataset.flip = '1';
        o.host.appendChild(el);
        const x = el.querySelector('[data-remove]');
        if (x) x.addEventListener('click', () => {
          const gone = o.rows[i];
          flip(o.host.children, () => { o.rows.splice(i, 1); paint(); });
          toast('Row removed', () => { o.rows.splice(i, 0, gone); paint(); if (o.onChange) o.onChange(); });
          if (o.onChange) o.onChange();
        });
      });
      pressAll(o.host);
      if (o.onChange) o.onChange();
    }
    function add() { o.rows.push(o.blank()); paint(); }
    paint();
    return { add, paint, rows: o.rows };
  }

  /* ── 8e. MULTI-SELECT FILTER CHIPS ───────────────────────────────────────
     Filters combine. Tapping Unpaid then Partial shows both, tapping again
     removes one, and the All chip is the clear. Returns a live Set, so a page
     asks "is this row in the active set" rather than tracking state itself.  */
  function chips(host, onChange) {
    const all = host.querySelector('[data-f="all"]');
    const active = new Set();
    function paint() {
      host.querySelectorAll('.xl-chip').forEach(c => {
        const f = c.dataset.f;
        c.classList.toggle('on', f === 'all' ? active.size === 0 : active.has(f));
      });
      if (onChange) onChange(active);
    }
    host.querySelectorAll('.xl-chip').forEach(c => {
      c.addEventListener('click', () => {
        const f = c.dataset.f;
        if (f === 'all') active.clear();
        else if (active.has(f)) active.delete(f);
        else active.add(f);
        paint();
      });
    });
    paint();
    return { active, paint, clear: () => { active.clear(); paint(); } };
  }

  /* ── 8f. HORIZONTAL ROWS ON DESKTOP ──────────────────────────────────────
     A touch device flicks a horizontal row naturally. A desktop mouse has no
     way to reach it: the scrollbar is hidden and the wheel scrolls the page.
     This maps a vertical wheel to horizontal, adds click-and-drag scrolling,
     and shows arrow buttons when there is more to see.                      */
  function hScroll(el) {
    if (!el || el.dataset.hs === '1') return;
    el.dataset.hs = '1';
    el.classList.add('xl-hs');
    // Wheel: a plain vertical wheel moves the row sideways.
    el.addEventListener('wheel', e => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;   // trackpad already horizontal
      e.preventDefault();
      el.scrollLeft += e.deltaY;
      fade();
    }, { passive: false });
    // Click and drag anywhere in the row that is not a control.
    let down = false, sx = 0, sl = 0, moved = false;
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') return;
      down = true; moved = false; sx = e.clientX; sl = el.scrollLeft;
    });
    el.addEventListener('pointermove', e => {
      if (!down) return;
      const dx = e.clientX - sx;
      if (Math.abs(dx) > 4) { moved = true; el.classList.add('xl-dragging'); }
      el.scrollLeft = sl - dx;
      fade();
    });
    const up = e => {
      if (!down) return;
      down = false; el.classList.remove('xl-dragging');
      // A drag must not also fire the button underneath.
      if (moved && e) { const t = e.target.closest('button'); if (t) { const stop = ev => { ev.stopPropagation(); ev.preventDefault(); t.removeEventListener('click', stop, true); }; t.addEventListener('click', stop, true); } }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', () => { down = false; el.classList.remove('xl-dragging'); });
    el.addEventListener('pointerleave', () => { down = false; el.classList.remove('xl-dragging'); });
    // Arrows, only while there is somewhere to go.
    const wrap = document.createElement('div');
    wrap.className = 'xl-hs-wrap';
    el.parentNode.insertBefore(wrap, el);
    wrap.appendChild(el);
    const mk = dir => {
      const b = document.createElement('button');
      b.className = 'xl-hs-arrow ' + (dir < 0 ? 'l' : 'r');
      b.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="' + (dir < 0 ? '15,5 8,12 15,19' : '9,5 16,12 9,19') + '"/></svg>';
      b.addEventListener('click', ev => {
        ev.stopPropagation();
        el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: 'smooth' });
        setTimeout(fade, 320);
      });
      wrap.appendChild(b);
      return b;
    };
    const L = mk(-1), R = mk(1);
    function fade() {
      const more = el.scrollWidth - el.clientWidth;
      const atL = el.scrollLeft <= 2, atR = el.scrollLeft >= more - 2;
      wrap.classList.toggle('has-more', more > 4);
      L.classList.toggle('off', atL);
      R.classList.toggle('off', atR || more <= 4);
      el.classList.toggle('fade-l', !atL);
      el.classList.toggle('fade-r', !atR && more > 4);
    }
    el.addEventListener('scroll', fade, { passive: true });
    new ResizeObserver(fade).observe(el);
    fade();
    return { fade };
  }

  /* ── 8g. SERVICE PICKER ──────────────────────────────────────────────────
     Every field that asks for a service name uses this. A plain <input> lets
     a typo through and a typo splits a service into two rows in QuickBooks
     and in every report. This is the iOS pattern instead: type to filter, the
     list shrinks as you go, arrows and Enter work, and only a real item can
     be committed - a free-typed value is rejected on blur.
     QB_ITEMS is the app's own 46-item list, kept here so no page invents it. */
  const QB_ITEMS = [
    '4 Stage (Car)',
    '4 Stage (Lg Utility/Van)',
    '4 Stage (SUV/Wagon)',
    'Black Out Emblems',
    'Body Repair',
    'Caliper Painting',
    'Ceramic Coating',
    'Ceramic Coating Wheels',
    'Ceramic Reactivation',
    'Chrome Delete',
    'Clay & Wax (Car)',
    'Clay & Wax (Lg Utility/Van)',
    'Clay & Wax (SUV/Wagon)',
    'Color Sand',
    'Complete Detail (Car)',
    'Complete Detail (Lg Util/Van)',
    'Complete Detail (SUV/Wagon)',
    'Detail',
    'Dent Removal',
    'Gas',
    'Headlight Restoration',
    'Install Parts',
    'Interior (Car)',
    'Interior (Lg Utility/Van)',
    'Interior (SUV/Wagon)',
    'Interior Ceramic Coating',
    'Leather Repair',
    'Maintenance Program',
    'Misc',
    'Paint',
    'Paint Correction',
    'Parking',
    'Parts',
    'Permanent Tire Dressing',
    'Powder Coating',
    'Window Tint',
    'Vinyl Wrap',
    'PPF (Paint Protection Film)',
    'Tip',
    'Wash (Car)',
    'Wash (Lg Utility/Van)',
    'Wash (SUV/Wagon)',
    'Wheel Repair',
    'Window Repair',
    'low',
    'normal',
    'high'
  ];
  /* Generic selection-only picker. Any field constrained to a known set uses
     this - services, accounts, customers, contractors - so they all look and
     behave identically. Typing filters; only a choice commits. */
  function picker(input, opts) {
    const o = Object.assign({ items: [], onPick: null, empty: 'Nothing matches.' }, opts || {});
    if (input.dataset.sp === '1') return;
    input.dataset.sp = '1';
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('inputmode', 'search');
    input.classList.add('xl-sp-field');
    // The committed value is the ONLY value. Typing filters the list and
    // nothing else - a service name can only be set by choosing one, because
    // a typed name that QuickBooks does not know becomes a second line item
    // there and splits the service across every report.
    let committed = input.value || '';
    let idx = -1, open = false, picked = false;
    const list = document.createElement('div');
    list.className = 'xl-sp';
    document.body.appendChild(list);

    const place = () => {
      const r = input.getBoundingClientRect();
      const below = window.innerHeight - r.bottom > 220 || r.top < 240;
      list.style.left = r.left + 'px';
      list.style.width = r.width + 'px';
      list.style.top = below ? (r.bottom + 6) + 'px' : '';
      list.style.bottom = below ? '' : (window.innerHeight - r.top + 6) + 'px';
      list.style.transformOrigin = below ? 'top center' : 'bottom center';
    };
    const matches = () => {
      const q = input.value.trim().toLowerCase();
      if (!q || q === committed.toLowerCase()) return o.items;
      const a = [], b = [];
      o.items.forEach(it => {
        const l = it.toLowerCase();
        if (l.startsWith(q)) a.push(it); else if (l.includes(q)) b.push(it);
      });
      return a.concat(b);
    };
    const paint = () => {
      const m = matches();
      if (!m.length) {
        list.innerHTML = '<div class="xl-sp-empty">' + o.empty + '</div>';
        idx = -1;
        return;
      }
      const q = input.value.trim().toLowerCase();
      list.innerHTML = m.map((it, i) => {
        let label = it;
        if (q && q !== committed.toLowerCase()) {
          const p = it.toLowerCase().indexOf(q);
          if (p > -1) label = it.slice(0, p) + '<b>' + it.slice(p, p + q.length) + '</b>' + it.slice(p + q.length);
        }
        const cur = it === committed ? ' cur' : '';
        return '<button class="xl-sp-i' + (i === idx ? ' on' : '') + cur + '" data-i="' + i + '">' + label + '</button>';
      }).join('');
      list.querySelectorAll('.xl-sp-i').forEach(b2 => {
        // pointerdown, so the choice lands before blur can revert the field
        b2.addEventListener('pointerdown', e => { e.preventDefault(); pick(m[Number(b2.dataset.i)]); });
      });
    };
    const show = () => {
      open = true; picked = false; idx = -1;
      input.value = '';                       // clear to search, restore on cancel
      input.placeholder = committed || input.dataset.ph || 'Choose one';
      place(); paint(); list.classList.add('on');
      const cur = list.querySelector('.xl-sp-i.cur');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    };
    const hide = () => { open = false; list.classList.remove('on'); idx = -1; };
    const revert = () => { input.value = committed; input.placeholder = input.dataset.ph || 'Choose one'; };
    const pick = v => {
      picked = true; committed = v; input.value = v; input.placeholder = input.dataset.ph || 'Choose one';
      hide(); input.blur();
      if (o.onPick) o.onPick(v);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    input.addEventListener('focus', show);
    input.addEventListener('input', () => { idx = -1; if (!open) show(); else { place(); paint(); } });
    input.addEventListener('keydown', e => {
      const m = matches();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (!open) show();
        idx = e.key === 'ArrowDown' ? Math.min(m.length - 1, idx + 1) : Math.max(0, idx - 1);
        paint();
        const el = list.querySelector('.xl-sp-i.on'); if (el) el.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        // Enter chooses the highlighted item - it never accepts raw text.
        e.preventDefault();
        if (m.length) pick(idx > -1 ? m[idx] : m[0]);
        else toast('Pick one from the list');
      } else if (e.key === 'Escape') { e.preventDefault(); revert(); hide(); input.blur(); }
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        if (picked) { picked = false; return; }
        hide(); revert();      // nothing chosen means nothing changed
      }, 120);
    });
    window.addEventListener('resize', () => { if (open) place(); });
    window.addEventListener('scroll', () => { if (open) place(); }, true);
    return { show, hide, get value() { return committed; } };
  }

  /* Services: the same picker, pre-loaded with the QuickBooks item list. */
  function servicePicker(input, opts) {
    input.dataset.ph = input.dataset.ph || 'Choose a service';
    return picker(input, Object.assign({ items: QB_ITEMS,
      empty: 'No service matches.<br>Only names QuickBooks knows can be used.' }, opts || {}));
  }
  /* Accounts: identical cosmetics, because an account name must match exactly
     too - a near miss creates a second account and splits the billing. */
  function accountPicker(input, accounts, opts) {
    input.dataset.ph = input.dataset.ph || 'Choose an account';
    return picker(input, Object.assign({ items: accounts,
      empty: 'No account matches.<br>Only an existing account can be chosen.' }, opts || {}));
  }
  function servicePickerAll(root) {
    (root || document).querySelectorAll('input[data-service]').forEach(i => servicePicker(i));
  }

  /* ── 8h. PER-USER LAYOUT ─────────────────────────────────────────────────
     Anything a user can rearrange or resize is DATA keyed to their login, not
     markup and not the device. Merges on load, so an item added to the app
     later still appears for someone whose saved layout predates it.          */
  function layout(key, user, defaults) {
    const k = 'xl_' + key + '_' + (user || 'default');
    let state = { sizes: {}, order: [], hidden: [] };
    try { state = Object.assign(state, JSON.parse(localStorage.getItem(k) || '{}')); } catch (e) {}
    return {
      load(allIds, defaultSizes) {
        state.sizes = Object.assign({}, defaultSizes || defaults || {}, state.sizes);
        state.order = (state.order || []).filter(id => allIds.includes(id));
        allIds.forEach(id => {
          if (!state.order.includes(id)) state.order.push(id);
          if (!state.sizes[id]) state.sizes[id] = 'small';
        });
        state.hidden = (state.hidden || []).filter(id => allIds.includes(id));
        return state;
      },
      get: () => state,
      size: id => state.sizes[id] || 'small',
      setSize(id, sz) { state.sizes[id] = sz; this.save(); },
      setOrder(ids) { state.order = ids; this.save(); },
      hide(id) { if (!state.hidden.includes(id)) state.hidden.push(id); this.save(); },
      show(id) { state.hidden = state.hidden.filter(h => h !== id); this.save(); },
      visible: () => state.order.filter(id => !state.hidden.includes(id)),
      reset(defaultSizes, allIds) {
        state = { sizes: Object.assign({}, defaultSizes || defaults || {}), order: [...allIds], hidden: [] };
        this.save(); return state;
      },
      snapshot: () => JSON.parse(JSON.stringify(state)),
      restore(snap) { state = snap; this.save(); },
      save() { try { localStorage.setItem(k, JSON.stringify(state)); } catch (e) {} }
    };
  }

  /* ── 8i. DRAG TO REORDER ─────────────────────────────────────────────────
     Jiggle, 1:1 drag, FLIP on the tiles that move, spring back on release.
     Long-press opens a menu unless the container is marked [data-noctx].     */
  function reorder(grid, opts) {
    const o = Object.assign({ item: '.app', onDrop: null }, opts || {});
    if (grid.dataset.ro === '1') return;
    grid.dataset.ro = '1';
    let drag = null;
    grid.addEventListener('pointerdown', e => {
      if (!grid.classList.contains('jiggle')) return;
      const tile = e.target.closest(o.item);
      if (!tile || e.target.closest('button:not(' + o.item + ')')) return;
      e.preventDefault();
      const r = tile.getBoundingClientRect();
      drag = { tile, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, w: r.width, h: r.height };
      tile.setPointerCapture(e.pointerId);
      tile.style.transition = 'none'; tile.style.zIndex = '60'; tile.style.animation = 'none';
      tile.classList.add('dragging');
    });
    grid.addEventListener('pointermove', e => {
      if (!drag) return;
      drag.dx = e.clientX - drag.sx; drag.dy = e.clientY - drag.sy;
      drag.tile.style.transform = 'translate(' + drag.dx + 'px,' + drag.dy + 'px) scale(1.06)';
      drag.tile.style.pointerEvents = 'none';
      const over = document.elementFromPoint(e.clientX, e.clientY);
      drag.tile.style.pointerEvents = '';
      const target = over && over.closest(o.item);
      if (!target || target === drag.tile) return;
      const tiles = [...grid.children];
      const before = new Map(tiles.map(t => [t, t.getBoundingClientRect()]));
      const tr = target.getBoundingClientRect();
      grid.insertBefore(drag.tile, (e.clientX > tr.left + tr.width / 2) ? target.nextSibling : target);
      drag.sx = e.clientX - drag.dx; drag.sy = e.clientY - drag.dy;
      tiles.forEach(t => {
        if (t === drag.tile) return;
        const b = before.get(t), a2 = t.getBoundingClientRect();
        const ddx = b.left - a2.left, ddy = b.top - a2.top;
        if (!ddx && !ddy) return;
        t.style.transition = 'none';
        t.style.transform = 'translate(' + ddx + 'px,' + ddy + 'px)';
        requestAnimationFrame(() => { t.style.transition = 'transform .34s var(--decel)'; t.style.transform = ''; });
      });
      drag.dx = e.clientX - drag.sx; drag.dy = e.clientY - drag.sy;
      drag.tile.style.transform = 'translate(' + drag.dx + 'px,' + drag.dy + 'px) scale(1.06)';
    });
    const end = () => {
      if (!drag) return;
      const t = drag.tile; drag = null;
      t.classList.remove('dragging');
      t.style.transition = 'transform .42s var(--spring)';
      t.style.transform = '';
      setTimeout(() => { t.style.transition = ''; t.style.zIndex = ''; t.style.animation = ''; }, 440);
      if (o.onDrop) o.onDrop([...grid.children].map(c => c.dataset.id).filter(Boolean));
    };
    grid.addEventListener('pointerup', end);
    grid.addEventListener('pointercancel', end);
    grid.addEventListener('selectstart', e => { if (grid.classList.contains('jiggle')) e.preventDefault(); });
    grid.addEventListener('dragstart', e => { if (grid.classList.contains('jiggle')) e.preventDefault(); });
  }

  /* ── 8j. LEAVE THE LIST ──────────────────────────────────────────────────
     A working list holds only what still needs doing. When something is
     finished it shows for a beat, then slides out and collapses its own
     height so the rows below glide up. Undo puts it back where it was.       */
  function dismiss(el, opts) {
    const o = Object.assign({ flashClass: 'finishing', hold: 780, onGone: null }, opts || {});
    return new Promise(resolve => {
      const done = () => { if (o.onGone) o.onGone(); resolve(); };
      if (!el || !el.isConnected || reduced()) { done(); return; }
      if (o.flashClass) el.classList.add(o.flashClass);
      setTimeout(() => {
        el.style.maxHeight = el.offsetHeight + 'px';
        requestAnimationFrame(() => {
          el.classList.add('xl-leaving');
          setTimeout(done, 520);
        });
      }, o.flashClass ? o.hold : 0);
    });
  }

  /* ── 8k. MODE ────────────────────────────────────────────────────────────
     One entry point, several exits. Entering by accident is worse than an
     extra tap; being stuck in a mode is worse than both. Sets [data-noctx] so
     the kit's own long-press menus stand down while the mode is active.      */
  function mode(el, opts) {
    const o = Object.assign({ cls: 'arranging', onStart: null, onEnd: null, outside: null }, opts || {});
    let on = false;
    const start = () => {
      if (on) return;
      on = true;
      el.classList.add(o.cls);
      el.dataset.noctx = '1';
      if (o.onStart) o.onStart();
    };
    const stop = () => {
      if (!on) return;
      on = false;
      el.classList.remove(o.cls);
      delete el.dataset.noctx;
      if (o.onEnd) o.onEnd();
    };
    document.addEventListener('keydown', e => { if (e.key === 'Escape') stop(); });
    if (o.outside) o.outside.addEventListener('click', e => {
      if (on && !e.target.closest('.' + o.cls) && !e.target.closest('[data-mode-keep]')) stop();
    });
    return { start, stop, get active() { return on; } };
  }

  /* ── 8l. PRESENTER - one form, three presentations ───────────────────────
     A form is built ONCE and lives in a detached holder. A presentation
     ADOPTS that node - it is moved, never re-rendered - so half-typed fields,
     scroll position, focus and every listener survive a switch from sheet to
     full page. This is the pattern the app already uses for Dan's WO form
     (mount page-new into a popup, put it back on close), generalised.

       const wo = XLKit.presenter(document.getElementById('wo-form'));
       wo.open('sheet');      // slides up from the bottom
       wo.open('modal');      // centred dialog
       wo.open('page');       // takes the whole screen
       wo.open();             // picks by width: phone sheet, tablet modal
       wo.switchTo('page');   // same node, new frame, nothing lost
       wo.close();                                                          */
  function presenter(formEl, opts) {
    const o = Object.assign({ title: '', onOpen: null, onClose: null, onSwitch: null,
                              dismissible: true, pick: null }, opts || {});
    // Where the form lives when it is not on screen.
    const home = document.createElement('div');
    home.style.display = 'none';
    document.body.appendChild(home);
    home.appendChild(formEl);

    let frame = null, veil = null, cur = null;

    const build = kind => {
      veil = document.createElement('div');
      veil.className = 'xl-veil' + (kind === 'page' ? ' xl-veil-page' : '');
      frame = document.createElement('div');
      frame.className = 'xl-present xl-present-' + kind;
      const head = document.createElement('div');
      head.className = 'xl-present-head';
      head.innerHTML =
        (kind === 'sheet' ? '<div class="xl-grabber"></div>' : '')
        + '<div class="xl-present-bar">'
        + (kind === 'page' ? '<button class="xl-present-back" aria-label="Back">'
            + '<svg viewBox="0 0 24 24"><polyline points="14,5 7,12 14,19"/></svg></button>' : '')
        + '<div class="xl-present-title">' + (o.title || '') + '</div>'
        + (kind !== 'page' ? '<button class="xl-present-x" aria-label="Close">'
            + '<svg viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button>' : '')
        + '</div>';
      frame.appendChild(head);
      const body = document.createElement('div');
      body.className = 'xl-present-body';
      frame.appendChild(body);
      document.body.appendChild(veil);
      document.body.appendChild(frame);
      const x = head.querySelector('.xl-present-x') || head.querySelector('.xl-present-back');
      if (x) x.addEventListener('click', () => close());
      if (o.dismissible) veil.addEventListener('click', () => close());
      if (kind === 'sheet') sheet(frame, head.querySelector('.xl-grabber'));
      pressAll(frame);
      return body;
    };

    const teardown = () => {
      if (formEl.parentNode !== home) home.appendChild(formEl);   // keep the node alive
      if (frame) frame.remove();
      if (veil) veil.remove();
      frame = veil = null;
    };

    function open(kind) {
      const k = kind || (o.pick ? o.pick() : (window.innerWidth <= 520 ? 'sheet' : 'modal'));
      if (cur === k && frame) return;
      // Remember where the body was scrolled, so a switch does not jump.
      const prevBody = frame && frame.querySelector('.xl-present-body');
      const scrollTop = prevBody ? prevBody.scrollTop : 0;
      teardown();
      const body = build(k);
      body.appendChild(formEl);            // ADOPT - not a re-render
      cur = k;
      requestAnimationFrame(() => {
        veil.classList.add('on');
        frame.classList.add('on');
        body.scrollTop = scrollTop;
      });
      if (o.onOpen) o.onOpen(k);
      return k;
    }
    function switchTo(kind) {
      if (kind === cur) return;
      const from = cur;
      open(kind);
      if (o.onSwitch) o.onSwitch(kind, from);
    }
    function close() {
      if (!frame) return;
      const f = frame, v = veil;
      f.classList.remove('on');
      v.classList.remove('on');
      cur = null;
      setTimeout(() => { if (formEl.parentNode !== home) home.appendChild(formEl);
                         f.remove(); v.remove(); }, 420);
      frame = veil = null;
      if (o.onClose) o.onClose();
    }
    // Escape closes, and a width change re-picks the presentation only when
    // the caller did not name one.
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && frame) close(); });
    let rzT = null, auto = false;
    const openAuto = () => { auto = true; return open(); };
    window.addEventListener('resize', () => {
      if (!frame || !auto) return;
      clearTimeout(rzT);
      rzT = setTimeout(() => {
        const want = window.innerWidth <= 520 ? 'sheet' : 'modal';
        if (want !== cur) switchTo(want);
      }, 160);
    });
    return { open, openAuto, switchTo, close, get mode() { return cur; },
             get isOpen() { return !!frame; }, el: formEl };
  }

  /* ── 8m. GATED VISIBILITY ────────────────────────────────────────────────
     One file serves customers and staff. The real pay page decides by
     hostname, not by a login, so the CSS classes are the only thing between a
     customer and the staff controls - never rename them when porting.        */
  function audience(isCustomer) {
    document.body.classList.toggle('xl-customer', !!isCustomer);
    document.body.classList.toggle('xl-employee', !isCustomer);
  }

  /* ── 8n. FIELD ERROR ─────────────────────────────────────────────────────
     A validation message belongs beside the thing that is wrong, and the
     value the person typed is KEPT - nobody should retype a phone number
     because of a missing digit.                                              */
  function fieldError(input, message, holder) {
    const host = holder || input.parentNode.querySelector('.xl-field-err');
    input.classList.toggle('bad', !!message);
    if (host) { host.textContent = message || ''; host.classList.toggle('on', !!message); }
    if (message) { input.focus(); input.select && input.select(); }
    return !message;
  }

  /* ── 8o. CARD FIELD FORMATTING ───────────────────────────────────────────
     Light formatting only - Stripe does the real validation. This exists so
     the field behaves like every other card field the person has used.       */
  function cardFields(num, exp, cvc, zip, onBrand) {
    if (num) num.addEventListener('input', e => {
      const v = e.target.value.replace(/\D/g, '').slice(0, 16);
      e.target.value = v.replace(/(.{4})/g, '$1 ').trim();
      const b = v.startsWith('4') ? 'VISA' : /^5[1-5]/.test(v) ? 'MC'
              : /^3[47]/.test(v) ? 'AMEX' : /^6/.test(v) ? 'DISC' : '';
      if (onBrand) onBrand(b);
    });
    if (exp) exp.addEventListener('input', e => {
      const v = e.target.value.replace(/\D/g, '').slice(0, 4);
      e.target.value = v.length > 2 ? v.slice(0, 2) + ' / ' + v.slice(2) : v;
    });
    if (cvc) cvc.addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
    if (zip) zip.addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5); });
  }

  /* ── 8p. EDGE FADES ──────────────────────────────────────────────────────
     Adds and removes the fade classes as the row scrolls, so the hint only
     appears when there is genuinely more to see in that direction. Pairs with
     .xl-hscroll.                                                             */
  function hFade(el) {
    if (!el || el.dataset.hfade === '1') return;
    el.dataset.hfade = '1';
    /* Touch scrolls a row natively; a desktop pointer does not. Without this
       a drag SELECTS THE CHIP TEXT instead of scrolling, and a mouse wheel
       does nothing at all - the row looks stuck. hScroll adds wheel mapping,
       click-drag and keyboard, so every scroller gets it. */
    hScroll(el);
    /* The fade is what keeps the arrows from colliding with the chips, so the
       two are set up together and never separately. */
    /* Reachable without a mouse: the row takes focus and the arrow keys move
       it, so it is not a dead zone for anyone using a keyboard. */
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    if (!el.hasAttribute('role')) el.setAttribute('role', 'group');
    el.addEventListener('keydown', e => {
      const step = Math.max(120, el.clientWidth * 0.6);
      if (e.key === 'ArrowRight') { el.scrollLeft += step; e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { el.scrollLeft -= step; e.preventDefault(); }
      else if (e.key === 'Home') { el.scrollLeft = 0; e.preventDefault(); }
      else if (e.key === 'End') { el.scrollLeft = el.scrollWidth; e.preventDefault(); }
    });
    const upd = () => {
      const more = el.scrollWidth - el.clientWidth;
      // No overflow means no arrows, so the reserved lane is dropped and the
      // chips sit flush with the page gutter again.
      el.classList.toggle('no-arrows', more <= 4);
      const l = el.scrollLeft > 4, r = el.scrollLeft < more - 4 && more > 4;
      el.classList.toggle('fade-r', r && !l);
      el.classList.toggle('fade-l', l && !r);
      el.classList.toggle('fade-b', l && r);
    };
    el.addEventListener('scroll', upd, { passive: true });
    window.addEventListener('resize', upd);
    requestAnimationFrame(upd);
    setTimeout(upd, 160);
    return upd;
  }
  function hFadeAll(root) {
    (root || document).querySelectorAll('.xl-hscroll').forEach(hFade);
  }

  /* ── 9. COUNTING NUMBERS - values never snap ─────────────────────────── */
  function countTo(el, from, to, fmt, ms) {
    fmt = fmt || (n => Math.round(n).toLocaleString());
    if (reduced()) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = ms || 620;
    (function f(t) {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(f);
    })(t0);
  }

  /* ── 10. CHROME THAT GETS OUT OF THE WAY ─────────────────────────────────
     Large title collapses. Tab bar shrinks to a pill scrolling down and
     returns scrolling up. Search hides only on a FAST scroll away - a slow
     scroll leaves it open because you may be reading results.               */
  function chrome(scroller, opts) {
    /* v2.2 - `navOn` / `navOff` make the hysteresis window configurable.
       The 34/18 defaults assume the comment above is true: that nothing
       changes layout HEIGHT. When the host collapses a header that really
       does get shorter, the shrink pushes scroll position back across the
       threshold and the class flips on and off - the exact flicker the
       hysteresis exists to prevent.
       The rule: the window must be comfortably WIDER than the height the
       collapse removes. XSLook's header loses ~60px, so 16px of window
       oscillated 3.7x over. Defaults unchanged for the labs. */
    const o = Object.assign({ nav: null, tabbar: null, search: null, largeTitle: null,
                              navOn: 34, navOff: 18 }, opts || {});
    let lastY = 0, lastT = performance.now(), ticking = false;
    // The large title is scrolling content: it shrinks and fades continuously
    // with scroll position instead of snapping at a threshold, and the small
    // title in the bar fades in as it goes. Nothing changes layout height, so
    // there is no feedback loop and no flicker between the two states.
    const apply = () => {
      ticking = false;
      const y = scroller.scrollTop, now = performance.now();
      const v = (y - lastY) / Math.max(1, now - lastT);
      if (o.largeTitle) {
        const p = Math.max(0, Math.min(1, y / 46));           // 0 open, 1 collapsed
        o.largeTitle.style.transform = 'scale(' + (1 - p * 0.34) + ')';
        o.largeTitle.style.opacity = String(1 - p);
      }
      if (o.nav) {
        // Hysteresis so the hairline and the small title cannot chatter.
        const on = o.nav.classList.contains('compact');
        if (!on && y > o.navOn) o.nav.classList.add('compact');
        else if (on && y < o.navOff) o.nav.classList.remove('compact');
      }
      if (o.tabbar) {
        if (y > lastY + 4 && y > 60) o.tabbar.classList.add('mini');
        else if (y < lastY - 4) o.tabbar.classList.remove('mini');
      }
      if (o.search && o.search.classList.contains('open') && y > 12 && v > 1.4) {
        o.search.classList.remove('open');
      }
      lastY = y; lastT = now;
    };
    scroller.addEventListener('scroll', () => {
      // One update per frame. Reading and writing layout on every scroll event
      // is the other half of the jitter.
      if (!ticking) { ticking = true; requestAnimationFrame(apply); }
    }, { passive: true });
    apply();
    if (o.search) {
      scroller.addEventListener('wheel', e => {
        if (onLayer(e)) return;                         // v2.6 - a wheel inside a modal must not open search
        if (scroller.scrollTop <= 0 && e.deltaY < -30) o.search.classList.add('open');
      }, { passive: true });
      let ty = 0;
      scroller.addEventListener('touchstart', e => { ty = e.touches[0].clientY; }, { passive: true });
      scroller.addEventListener('touchmove', e => {
        if (scroller.scrollTop <= 0 && e.touches[0].clientY - ty > 60) o.search.classList.add('open');
      }, { passive: true });
    }
  }

  /* ── 11. DISCLOSURE - height morph, never a snap ─────────────────────── */
  function disclose(el) {
    const body = el.querySelector('.xl-disc-b');
    const open = !el.classList.contains('open');
    if (open) {
      el.classList.add('open');
      body.style.height = body.scrollHeight + 'px';
      setTimeout(() => { if (el.classList.contains('open')) body.style.height = 'auto'; }, 400);
    } else {
      body.style.height = body.scrollHeight + 'px';
      void body.offsetHeight;
      body.style.height = '0px';
      el.classList.remove('open');
    }
  }

  /* ── 11b. LOGO ───────────────────────────────────────────────────────────
     The only correct way to render the brand. Never set EXCESS LOOK in type. */
  const LOGO_SRC = 'https://static.wixstatic.com/media/ca3f28_d2ad9fca894a4bf5934cdc30a498c2c2~mv2.png';
  function logo(size) {
    // If the image cannot load - an offline device, or a sandboxed preview
    // that blocks external requests - it hides and keeps its space. It NEVER
    // falls back to the wordmark in type.
    return '<img class="xl-logo' + (size ? ' ' + size : '') + '" src="' + LOGO_SRC
      + '" alt="Excess Look Auto Solutions" onerror="this.dataset.failed=1">';
  }

  /* ── 12. INIT ─────────────────────────────────────────────────────────── */
  function init(opts) {
    const o = Object.assign({ scroller: null, nav: null, tabbar: null, search: null }, opts || {});
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) document.body.classList.add('rm');
    pressAll();
    if (o.scroller) { rubberBand(o.scroller); chrome(o.scroller, o); }
    // Every horizontal row gets desktop scrolling automatically.
    document.querySelectorAll('.xl-chips, .who-row, .months, [data-hscroll]').forEach(hScroll);
    servicePickerAll();
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      closeMenu();
      if ($('xl-dlg')) { $('xl-dlg').classList.remove('on'); $('xl-dlg-veil').classList.remove('on'); }
      document.querySelectorAll('.sheet.on,.xl-sheet.on').forEach(s => s.classList.remove('on'));
      document.querySelectorAll('.veil.on,.xl-veil.on').forEach(v => v.classList.remove('on'));
    });
  }

  return { init, spring, rubberBand, pressAll, toast, confirm, prompt, promptList, logo, LOGO_SRC,
           flip, money, money0, parseMoney, moneyField, repeater, chips, hScroll,
           picker, servicePicker, accountPicker, servicePickerAll, QB_ITEMS,
           audience, fieldError, cardFields, hFade, hFadeAll, layout, reorder, dismiss, mode, presenter,
           menu, attachMenu, tapHold, closeMenu, sheet, countTo, chrome, disclose, reduced, setLayerSelector};
})();
