// studio-plan-background.mjs - runs one AI edit (up to 15 minutes).
// Netlify answers the caller 202 straight away; the result lands in the
// store under job/<id> and the page polls studio-api?op=job for it.
import { getStore } from '@netlify/blobs';
import { runPlan, authOk } from '../lib/studio-core.mjs';

const envOf = () => ({
  ANTHROPIC_API_KEY: Netlify.env.get('ANTHROPIC_API_KEY'),
  STUDIO_PASSCODE: Netlify.env.get('STUDIO_PASSCODE'),
  STUDIO_MODEL: Netlify.env.get('STUDIO_MODEL')
});

export default async (req) => {
  const env = envOf();
  if (req.method !== 'POST' || !authOk(req.headers.get('x-studio-key'), env)) return;
  let body = null;
  try { body = await req.json(); } catch (e) { return; }
  await runPlan({ body, store: getStore({ name: 'studio', consistency: 'strong' }), fetchImpl: fetch, env });
};
