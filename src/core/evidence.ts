import { createHash } from 'node:crypto';
import type { ChangeChain, Policy } from './types';

/** JSON with sorted object keys, so equal values always serialise to equal strings. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const byTime = <T extends { at: string }>(a: T, b: T) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

/**
 * The part of a chain a verdict may depend on. Free text (titles, descriptions, comments,
 * commit messages, summaries) and display names are left out, so they cannot change a verdict
 * and the evidence hash proves it.
 */
export function decisionEvidence(chain: ChangeChain) {
  const people: Record<string, { kind: string; actsAs?: string }> = {};
  for (const [ref, p] of Object.entries(chain.people)) people[ref] = { kind: p.kind, actsAs: p.actsAs };
  return {
    workItem: { key: chain.workItem.key, requester: chain.workItem.requester },
    people,
    assignments: [...chain.assignments].sort(byTime).map((a) => ({ at: a.at, by: a.by, to: a.to, via: a.via })),
    declarations: [...chain.declarations]
      .sort(byTime)
      .map((d) => ({ at: d.at, principal: d.principal, branch: d.branch })),
    automationRules: chain.automationRules,
    pullRequests: [...chain.pullRequests]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((pr) => ({
        id: pr.id,
        repo: pr.repo,
        author: pr.author,
        sourceBranch: pr.sourceBranch,
        state: pr.state,
        createdAt: pr.createdAt,
        mergedAt: pr.mergedAt,
        mergedBy: pr.mergedBy,
        mergeCommit: pr.mergeCommit,
        commits: pr.commits.map((c) => ({ hash: c.hash, author: c.author, at: c.at })),
        reviews: [...pr.reviews]
          .sort((a, b) => byTime(a, b) || (a.by < b.by ? -1 : a.by > b.by ? 1 : 0))
          .map((r) => ({ by: r.by, action: r.action, at: r.at, commit: r.commit })),
      })),
    deployments: [...chain.deployments]
      .sort((a, b) => byTime(a, b) || (a.id < b.id ? -1 : 1))
      .map((d) => ({ id: d.id, env: d.env, at: d.at, commit: d.commit, triggeredBy: d.triggeredBy })),
    emergency: chain.emergency ?? null,
    history: chain.history,
  };
}

export function evidenceHash(chain: ChangeChain, policy: Policy, rulesVersion: string): string {
  return sha256(canonicalJson({ rulesVersion, policy, evidence: decisionEvidence(chain) }));
}
