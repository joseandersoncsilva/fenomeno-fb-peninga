import { timingSafeEqual } from 'node:crypto';

export function safeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function sandboxReady() {
  return process.env.VERCEL_ENV === 'preview'
    && process.env.VERCEL_GIT_COMMIT_REF === 'feat/supabase-asaas-backend'
    && process.env.ASAAS_ENV === 'sandbox'
    && Boolean(process.env.ASAAS_SANDBOX_API_KEY && process.env.SUPABASE_SECRET_KEY);
}

export async function asaas(path, { method = 'GET', body } = {}) {
  if (!sandboxReady()) throw new Error('Sandbox Preview required');
  const response = await fetch('https://api-sandbox.asaas.com/v3' + path, {
    method, signal: AbortSignal.timeout(12000), redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'FBPeningaCheckout/1.0 (sandbox)',
      access_token: process.env.ASAAS_SANDBOX_API_KEY },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) {
    // Never log remote descriptions: they can contain personal data or credentials.
    throw new Error('Asaas HTTP ' + response.status);
  }
  return response.json();
}

export function invoiceURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'sandbox.asaas.com') return url.href;
  } catch {}
  throw new Error('Invalid Sandbox invoice URL');
}
