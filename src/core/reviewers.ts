import type { Kind, Ref } from './types';

export interface ReviewRecord {
  reviewer: Ref;
  repo: string;
  pr: string;
  at: string;
}

export interface ReviewerSuggestion {
  ref: Ref;
  reviews: number;
  lastAt: string;
  repo: string;
}

/**
 * People who reviewed pull requests in the same repository recently and are outside the
 * conflicted set, ranked by review count, then by the most recent review.
 */
export function suggestReviewers(input: {
  history: ReviewRecord[];
  repo: string;
  exclude: Iterable<Ref>;
  kindOf: (ref: Ref) => Kind | undefined;
  now: string;
  lookbackDays?: number;
  limit?: number;
}): ReviewerSuggestion[] {
  const exclude = new Set(input.exclude);
  const since = Date.parse(input.now) - (input.lookbackDays ?? 90) * 86_400_000;
  const stats = new Map<Ref, { prs: Set<string>; lastAt: string }>();
  for (const r of input.history) {
    if (r.repo !== input.repo || exclude.has(r.reviewer) || input.kindOf(r.reviewer) !== 'human') continue;
    const t = Date.parse(r.at);
    if (t < since || t > Date.parse(input.now)) continue;
    const s = stats.get(r.reviewer) ?? { prs: new Set<string>(), lastAt: r.at };
    s.prs.add(r.pr);
    if (r.at > s.lastAt) s.lastAt = r.at;
    stats.set(r.reviewer, s);
  }
  return [...stats.entries()]
    .map(([ref, s]) => ({ ref, reviews: s.prs.size, lastAt: s.lastAt, repo: input.repo }))
    .sort((a, b) => b.reviews - a.reviews || (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0) || (a.ref < b.ref ? -1 : 1))
    .slice(0, input.limit ?? 3);
}
