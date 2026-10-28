import api from '@forge/api';
import type { ReviewRecord } from '../core/reviewers';

/**
 * Review history from the Teamwork Graph: which people reviewed which pull requests.
 * Runs as the current user, so it only sees what that user may see.
 */
const REVIEWS_CYPHER = `MATCH (u:AtlassianUser)-[:atlassian_user_reviewed_pull_requests]->(pr:ExternalPullRequest)
RETURN u, pr LIMIT 500`;

const QUERY = `query ArmsLengthReviews($cypherQuery: String!) {
  cypherQuery(query: $cypherQuery) {
    edges { node { columns { key value } } }
  }
}`;

const accountFromAri = (ari: string) => ari.split('/').at(-1) ?? ari;
const repoFromUrl = (url: string) => url.match(/\/([^/]+)\/pull-requests?\//)?.[1] ?? url.match(/\/([^/]+)\/pull\//)?.[1];

export interface GraphReviews {
  records: ReviewRecord[];
  source: 'teamwork-graph' | 'unavailable';
  error?: string;
}

export async function reviewsFromGraph(): Promise<GraphReviews> {
  try {
    const res = await api.asUser().requestTeamworkGraph(QUERY, { cypherQuery: REVIEWS_CYPHER });
    const body = (await res.json()) as {
      data?: { cypherQuery?: { edges?: { node: { columns: { key: string; value: Record<string, unknown> } [] } }[] } };
      errors?: { message: string }[];
    };
    if (!res.ok || body.errors?.length) return { records: [], source: 'unavailable', error: body.errors?.[0]?.message ?? `HTTP ${res.status}` };
    const records: ReviewRecord[] = [];
    for (const edge of body.data?.cypherQuery?.edges ?? []) {
      const cols = Object.fromEntries(edge.node.columns.map((c) => [c.key, c.value as Record<string, unknown>]));
      const user = cols.u ?? {};
      const pr = cols.pr ?? {};
      const data = (pr.data ?? pr) as Record<string, unknown>;
      const ari = String(user.ari ?? user.id ?? (user.data as Record<string, unknown> | undefined)?.ari ?? '');
      const url = String(data.url ?? '');
      const repo = repoFromUrl(url);
      if (!ari || !repo) continue;
      records.push({ reviewer: accountFromAri(ari), repo, pr: url, at: String(data.lastUpdatedAt ?? data.lastUpdate ?? new Date(0).toISOString()) });
    }
    return { records, source: 'teamwork-graph' };
  } catch (e) {
    return { records: [], source: 'unavailable', error: (e as Error).message };
  }
}
