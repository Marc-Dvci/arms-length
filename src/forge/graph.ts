import api from '@forge/api';
import type { ReviewRecord } from '../core/reviewers';

/**
 * Review history from the Teamwork Graph: which people reviewed which pull requests.
 * Runs as the current user, so it only sees what that user may see.
 *
 * The Cypher is a persisted query owned by this app, executed with customQuery:
 *   MATCH (u:AtlassianUser)-[:atlassian_user_reviewed_pull_requests]->(pr:ExternalPullRequest) RETURN u, pr
 */
export const REVIEWS_QUERY_KEY = '75a2ffe3-ae39-4542-b1f8-e2b7a868efd0';
const PAGE_SIZE = 25;
const MAX_PAGES = 20;

// Teamwork Graph requires operation names shaped company_operation.
export const QUERY = `query armslength_reviews($queryKey: String!, $after: String) {
  customQuery(queryKey: $queryKey, first: ${PAGE_SIZE}, after: $after) {
    edges {
      node {
        columns {
          key
          value {
            __typename
            ... on CypherQueryResultNode {
              id
              data {
                __typename
                ... on AtlassianUser { accountId name }
                ... on ExternalPullRequest { url displayName repositoryId lastUpdatedAt }
              }
            }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

type Data = { accountId?: string; name?: string; url?: string; displayName?: string; repositoryId?: string; lastUpdatedAt?: string };
export type GraphPage = {
  data?: {
    customQuery?: {
      edges?: { node: { columns: { key: string; value?: { data?: Data } | null }[] } }[];
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    };
  };
  errors?: { message: string }[];
};

const repoFromUrl = (url: string) => url.match(/\/([^/]+)\/pull-requests?\//)?.[1] ?? url.match(/\/([^/]+)\/pull\//)?.[1];

export interface GraphReviews {
  records: ReviewRecord[];
  source: 'teamwork-graph' | 'unavailable';
  error?: string;
}

/** Turns one page of (u, pr) rows into review records. Rows without a reviewer or a repository are skipped. */
export function recordsFromPage(page: GraphPage): ReviewRecord[] {
  const out: ReviewRecord[] = [];
  for (const edge of page.data?.customQuery?.edges ?? []) {
    const cols = Object.fromEntries(edge.node.columns.map((c) => [c.key, c.value?.data ?? {}]));
    const reviewer = cols.u?.accountId;
    const url = cols.pr?.url ?? '';
    const repo = repoFromUrl(url);
    if (!reviewer || !repo) continue;
    out.push({ reviewer, repo, pr: url, at: cols.pr?.lastUpdatedAt ?? new Date(0).toISOString() });
  }
  return out;
}

export async function reviewsFromGraph(): Promise<GraphReviews> {
  const records: ReviewRecord[] = [];
  try {
    let after: string | null = null;
    for (let i = 0; i < MAX_PAGES; i++) {
      const res = await api.asUser().requestTeamworkGraph(QUERY, { queryKey: REVIEWS_QUERY_KEY, after });
      const body = (await res.json()) as GraphPage;
      if (!res.ok || body.errors?.length) {
        const error = body.errors?.[0]?.message ?? `HTTP ${res.status}`;
        console.warn(`Teamwork Graph unavailable: ${error}`);
        return { records, source: records.length ? 'teamwork-graph' : 'unavailable', error };
      }
      records.push(...recordsFromPage(body));
      const info = body.data?.customQuery?.pageInfo;
      if (!info?.hasNextPage || !info.endCursor) break;
      after = info.endCursor;
    }
    console.log(`Teamwork Graph: ${records.length} review records`);
    return { records, source: 'teamwork-graph' };
  } catch (e) {
    console.warn(`Teamwork Graph unavailable: ${(e as Error).message}`);
    return { records, source: records.length ? 'teamwork-graph' : 'unavailable', error: (e as Error).message };
  }
}
