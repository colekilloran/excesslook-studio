# Reel Studio - Excess Look

Raw footage in, finished reel out. `studio.html` is the whole page (built from
`src/studio-src.html` + `kit/` + `vendor/` by `tools/build.py`). The AI editor
lives in `netlify/functions` and `netlify/lib/studio-core.mjs`.

How a reel is made:
1. The page pulls a few small stills from each clip (the video never leaves the device).
2. It uploads them to `studio-api?op=frames`, then starts `studio-plan-background`.
3. The background function sends the stills, the owner's rules and past approved
   edits to the Claude API and stores the edit plan in Netlify Blobs.
4. The page polls `studio-api?op=job`, applies the plan and renders the MP4 on the device.
5. Notes ("what should change") are saved; a note marked as a rule applies to every
   reel; every exported AI reel is kept as an approved example.

Netlify environment variables:
- `ANTHROPIC_API_KEY` - the Claude API key (secret)
- `STUDIO_PASSCODE` - the studio passcode, 6+ characters (12+ recommended)
- `STUDIO_MODEL` - optional, defaults to `claude-sonnet-5-5`

Tests: `bash tests/run-all.sh` (build, xlcheck, core, UI, auto edit end to end).
Build marker: `window.XL_STUDIO_BUILD` in the page, `CORE_BUILD` in the core.
