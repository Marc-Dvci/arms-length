import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signed requests between the Bitbucket app, the Pipelines gate and the Jira app's web trigger.
 * Header format: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`.
 */
export const SIGNATURE_HEADER = 'x-arms-length-signature';
export const MAX_SKEW_SECONDS = 300;

export function newSecret(): string {
  return randomBytes(32).toString('hex');
}

export function sign(secret: string, body: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac('sha256', secret).update(`${nowSeconds}.${body}`, 'utf8').digest('hex');
  return `t=${nowSeconds},v1=${mac}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'missing' | 'malformed' | 'expired' | 'mismatch' };

export function verify(secret: string, body: string, header: string | undefined, nowSeconds = Math.floor(Date.now() / 1000)): VerifyResult {
  if (!header) return { ok: false, reason: 'missing' };
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=', 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(parts.v1 ?? '')) return { ok: false, reason: 'malformed' };
  if (Math.abs(nowSeconds - t) > MAX_SKEW_SECONDS) return { ok: false, reason: 'expired' };
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${body}`, 'utf8').digest('hex'), 'hex');
  const given = Buffer.from(parts.v1, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
