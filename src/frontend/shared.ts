import { invoke } from '@forge/bridge';
import type { ApprovalStatus } from '../core/viewmodel';
import type { VerdictValue } from '../core/types';

export const AGENT = { key: 'arms-length-agent', name: "Arm's Length" };

export const verdictAppearance: Record<VerdictValue, 'success' | 'removed' | 'moved'> = {
  PASS: 'success',
  FAIL: 'removed',
  CANNOT_DETERMINE: 'moved',
};

export const verdictMessage: Record<VerdictValue, 'success' | 'error' | 'warning'> = {
  PASS: 'success',
  FAIL: 'error',
  CANNOT_DETERMINE: 'warning',
};

export const approvalAppearance: Record<ApprovalStatus, 'success' | 'removed' | 'moved' | 'default'> = {
  counts: 'success',
  conflicted: 'removed',
  stale: 'moved',
  after_merge: 'moved',
  non_human: 'default',
};

export function approvalLabel(status: ApprovalStatus, retro: boolean): string {
  switch (status) {
    case 'counts':
      return retro ? 'Counts (emergency, after merge)' : 'Counts';
    case 'conflicted':
      return 'Not independent';
    case 'stale':
      return 'Earlier commit';
    case 'after_merge':
      return 'After the merge';
    case 'non_human':
      return 'Not a person';
  }
}

export const quarterOf = (iso: string) => {
  const d = new Date(iso);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
};

/** The last eight calendar quarters, newest first. */
export function recentQuarters(now = new Date()): { label: string; from: string; to: string }[] {
  const out = [];
  let y = now.getUTCFullYear();
  let q = Math.floor(now.getUTCMonth() / 3);
  for (let i = 0; i < 8; i++) {
    const from = new Date(Date.UTC(y, q * 3, 1)).toISOString();
    const to = new Date(Date.UTC(y, q * 3 + 3, 1)).toISOString();
    out.push({ label: `Q${q + 1} ${y}`, from, to });
    q -= 1;
    if (q < 0) {
      q = 3;
      y -= 1;
    }
  }
  return out;
}

/** Calls a resolver function and returns its result. */
export async function call<T>(fn: string, payload?: Record<string, unknown>): Promise<T> {
  return (await invoke(fn, payload as never)) as unknown as T;
}
