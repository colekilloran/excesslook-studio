// studio-recolor-background.mjs - Color Lineup renders (up to 15 minutes).
// Netlify answers 202 at once; each render's status and image land in the
// store under cl/<job>/... and the page polls studio-api?op=cl-status.
import { getStore } from '@netlify/blobs';
import { runRecolor, authOk } from '../lib/studio-core.mjs';

const envOf = () => ({
  STUDIO_PASSCODE: Netlify.env.get('STUDIO_PASSCODE'),
  OPENAI_API_KEY: Netlify.env.get('OPENAI_API_KEY'),
  OPENAI_IMAGE_MODEL: Netlify.env.get('OPENAI_IMAGE_MODEL'),
  OPENAI_IMAGE_QUALITY: Netlify.env.get('OPENAI_IMAGE_QUALITY')
});

export default async (req) => {
  const env = envOf();
  if (req.method !== 'POST' || !authOk(req.headers.get('x-studio-key'), env)) return;
  let body = null;
  try { body = await req.json(); } catch (e) { return; }
  await runRecolor({ body, store: getStore({ name: 'studio', consistency: 'strong' }), fetchImpl: fetch, env });
};
