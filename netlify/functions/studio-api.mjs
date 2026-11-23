// studio-api.mjs - the small API behind Reel Studio: passcode check, job
// status, stills upload, the owner's style rules, feedback and approvals.
import { getStore } from '@netlify/blobs';
import { handleApi, authOk } from '../lib/studio-core.mjs';

const envOf = () => ({
  ANTHROPIC_API_KEY: Netlify.env.get('ANTHROPIC_API_KEY'),
  STUDIO_PASSCODE: Netlify.env.get('STUDIO_PASSCODE'),
  STUDIO_MODEL: Netlify.env.get('STUDIO_MODEL'),
  OPENAI_API_KEY: Netlify.env.get('OPENAI_API_KEY')
});
const out = (status, json) => new Response(JSON.stringify(json), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
});

export default async (req) => {
  const env = envOf();
  if (!authOk(req.headers.get('x-studio-key'), env)) return out(401, { error: 'Wrong passcode' });
  const url = new URL(req.url);
  const query = Object.fromEntries(url.searchParams.entries());
  let body = null;
  if (req.method === 'POST') { try { body = await req.json(); } catch (e) { return out(400, { error: 'Bad JSON' }); } }
  try {
    const r = await handleApi({ method: req.method, op: query.op, query, body, store: getStore({ name: 'studio', consistency: 'strong' }), env });
    return out(r.status, r.json);
  } catch (e) {
    return out(500, { error: String(e && e.message || e).slice(0, 300) });
  }
};
