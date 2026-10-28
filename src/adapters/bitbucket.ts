import type { Commit, PullRequest, PullRequestState, Ref, Review } from '../core/types';
import { workItemKeys } from './jira';

/** Subset of Bitbucket Cloud REST 2.0 shapes the adapter reads. */
export interface BbAccount {
  type?: string;
  uuid?: string;
  account_id?: string;
  display_name?: string;
  nickname?: string;
}

export interface BbPullRequest {
  id: number;
  title?: string;
  state: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED' | 'DRAFT';
  author: BbAccount;
  created_on: string;
  updated_on?: string;
  closed_by?: BbAccount | null;
  source: { branch: { name: string }; commit?: { hash: string } };
  destination?: { branch: { name: string } };
  merge_commit?: { hash: string } | null;
  participants?: { user: BbAccount; role?: string; approved: boolean; state?: string | null; participated_on?: string | null }[];
  links?: { html?: { href: string } };
}

export type BbActivity =
  | { approval: { date: string; user: BbAccount } }
  | { changes_requested: { date: string; user: BbAccount } }
  | { update: { date: string; state?: string; source?: { commit?: { hash: string } }; author?: BbAccount } }
  | { comment: unknown };

export interface BbCommit {
  hash: string;
  date: string;
  author: { raw?: string; user?: BbAccount };
}

export interface BbPerson {
  name: string;
  /** Bitbucket account type, used as a hint for the identity registry. */
  type?: string;
}

/** Atlassian account ID when Bitbucket gives one, so the reference matches Jira's. */
export function refOf(a: BbAccount | undefined | null): Ref {
  if (!a) return 'bb:unknown';
  return a.account_id ?? (a.uuid ? `bb:${a.uuid}` : `bb:${a.display_name ?? 'unknown'}`);
}

const sameCommit = (a: string, b: string) => a.length && b.length && (a.startsWith(b) || b.startsWith(a));

/**
 * Builds the pull request snapshot the rule engine reads. Commit times come from the activity
 * timeline when Bitbucket records the push, since author dates can be set by anyone.
 */
export function snapshotFromBitbucket(input: {
  repoSlug: string;
  pr: BbPullRequest;
  activity: BbActivity[];
  commits: BbCommit[];
}): { pullRequest: PullRequest; people: Record<Ref, BbPerson>; workItems: string[]; complete: boolean } {
  const { pr, repoSlug } = input;
  const people: Record<Ref, BbPerson> = {};
  const remember = (a: BbAccount | undefined | null) => {
    if (!a) return 'bb:unknown';
    const ref = refOf(a);
    people[ref] = { name: a.display_name ?? a.nickname ?? ref, type: a.type };
    return ref;
  };

  const updates = input.activity
    .filter((x): x is Extract<BbActivity, { update: unknown }> => 'update' in x)
    .map((x) => x.update)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const headAt = (t: string): string | null => {
    let head: string | null = null;
    for (const u of updates) if (u.date <= t && u.source?.commit?.hash) head = u.source.commit.hash;
    return head;
  };

  // Bitbucket lists commits newest first.
  const ordered = [...input.commits].reverse();
  const pushedAt = (hash: string): string | undefined => updates.find((u) => u.source?.commit?.hash && sameCommit(u.source.commit.hash, hash))?.date;
  const commits: Commit[] = ordered.map((c) => ({
    hash: c.hash,
    author: c.author.user ? remember(c.author.user) : `raw:${c.author.raw ?? 'unknown'}`,
    at: pushedAt(c.hash) ?? c.date,
  }));
  const finalHead = pr.source.commit?.hash;
  if (finalHead && commits.length && !sameCommit(commits.at(-1)!.hash, finalHead)) {
    const i = commits.findIndex((c) => sameCommit(c.hash, finalHead));
    if (i >= 0) commits.push(...commits.splice(i, 1));
  }
  const fullHash = (h: string | null) => (h ? (commits.find((c) => sameCommit(c.hash, h))?.hash ?? h) : null);

  const approvals = new Map<Ref, string>();
  for (const x of input.activity) {
    if ('approval' in x) {
      const ref = remember(x.approval.user);
      if (!approvals.has(ref) || approvals.get(ref)! < x.approval.date) approvals.set(ref, x.approval.date);
    }
  }
  const reviews: Review[] = [];
  for (const p of pr.participants ?? []) {
    const ref = remember(p.user);
    if (p.approved) {
      const at = approvals.get(ref) ?? p.participated_on ?? pr.updated_on ?? pr.created_on;
      reviews.push({ by: ref, action: 'approved', at, commit: fullHash(headAt(at)) ?? '' });
    } else if (p.state === 'changes_requested') {
      const at = p.participated_on ?? pr.updated_on ?? pr.created_on;
      reviews.push({ by: ref, action: 'changes_requested', at, commit: fullHash(headAt(at)) ?? '' });
    }
  }

  const state: PullRequestState = pr.state === 'MERGED' ? 'MERGED' : pr.state === 'DECLINED' || pr.state === 'SUPERSEDED' ? 'DECLINED' : 'OPEN';
  const mergedAt = state === 'MERGED' ? (updates.filter((u) => u.state === 'MERGED').at(-1)?.date ?? pr.updated_on) : undefined;
  const author = remember(pr.author);
  const pullRequest: PullRequest = {
    id: `${repoSlug}#${pr.id}`,
    repo: repoSlug,
    title: pr.title,
    url: pr.links?.html?.href,
    author,
    sourceBranch: pr.source.branch.name,
    state,
    createdAt: pr.created_on,
    ...(mergedAt ? { mergedAt } : {}),
    ...(state === 'MERGED' && pr.closed_by ? { mergedBy: remember(pr.closed_by) } : {}),
    ...(pr.merge_commit?.hash ? { mergeCommit: pr.merge_commit.hash } : {}),
    commits,
    reviews,
  };
  // Without push events the head at each approval is unknown, so the history counts as incomplete.
  return { pullRequest, people, workItems: workItemKeys(pr.source.branch.name, pr.title), complete: updates.length > 0 && commits.length > 0 };
}
