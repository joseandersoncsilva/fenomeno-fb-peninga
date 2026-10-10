// Server-only REST helper. Never expose SUPABASE_SECRET_KEY to browsers.
const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
export async function db(path, { method = 'GET', body, prefer } = {}) {
  if (!base || !key) throw new Error('Supabase server environment is not configured');
  const response = await fetch(base.replace(/\/$/,'') + '/rest/v1/' + path, {
    method,
    signal: AbortSignal.timeout(12000),
    redirect: 'error',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) throw new Error('Supabase request failed: ' + response.status);
  const payload = await response.text();
  if (!payload.trim()) return null;
  try { return JSON.parse(payload); }
  catch { throw new Error('Supabase returned an invalid JSON response'); }
}
