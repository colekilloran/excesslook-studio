// studio-card-background.mjs - reads a photo of a sample color card (up to 15 minutes).
// Netlify answers 202 at once; the chips land under card/<id> and the page polls studio-api?op=card.
import { getStore } from '@netlify/blobs';
import { runCard, authOk } from '../lib/studio-core.mjs';

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
  await runCard({ body, store: getStore({ name: 'studio', consistency: 'strong' }), fetchImpl: fetch, env });
};
