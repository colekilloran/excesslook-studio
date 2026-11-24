// studio-film-background.mjs - researches one wrap / PPF film on the web (up to 15 minutes).
// Netlify answers 202 at once; the spec lands under film/<id> and the page polls studio-api?op=film.
import { getStore } from '@netlify/blobs';
import { runFilm, authOk } from '../lib/studio-core.mjs';

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
  await runFilm({ body, store: getStore({ name: 'studio', consistency: 'strong' }), fetchImpl: fetch, env });
};
