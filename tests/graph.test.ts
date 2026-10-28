import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: { query: string; variables: Record<string, unknown> }[] = [];
let pages: unknown[] = [];

vi.mock('@forge/api', () => ({
  default: {
    asUser: () => ({
      requestTeamworkGraph: async (query: string, variables: Record<string, unknown>) => {
        calls.push({ query, variables });
        const body = pages.shift() ?? { errors: [{ message: 'no more pages' }] };
        return { ok: true, status: 200, json: async () => body };
      },
    }),
  },
}));

import { QUERY, REVIEWS_QUERY_KEY, reviewsFromGraph } from '../src/forge/graph';

/** One row as the Teamwork Graph returns it for `RETURN u, pr`. */
const row = (accountId: string, url: string, lastUpdatedAt: string) => ({
  node: {
    columns: [
      { key: 'u', value: { __typename: 'CypherQueryResultNode', id: `ari:user/${accountId}`, data: { __typename: 'AtlassianUser', accountId, name: accountId } } },
      { key: 'pr', value: { __typename: 'CypherQueryResultNode', id: `ari:pr/${url}`, data: { __typename: 'ExternalPullRequest', url, displayName: 'PR', repositoryId: 'r', lastUpdatedAt } } },
    ],
  },
});

beforeEach(() => {
  calls.length = 0;
  pages = [];
});

describe('Teamwork Graph review history', () => {
  it('pages through the persisted query and reads reviewer, repository and time', async () => {
    pages = [
      {
        data: {
          customQuery: {
            edges: [
              row('712020:tom', 'https://bitbucket.org/acme/payments-core/pull-requests/12', '2026-10-20T10:00:00Z'),
              row('712020:priya', 'https://github.com/acme/ledger-service/pull/7', '2026-10-21T10:00:00Z'),
            ],
            pageInfo: { hasNextPage: true, endCursor: 'c1' },
          },
        },
      },
      {
        data: {
          customQuery: {
            edges: [row('712020:tom', 'https://bitbucket.org/acme/payments-core/pull-requests/15', '2026-10-25T10:00:00Z'), { node: { columns: [{ key: 'u', value: null }] } }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    ];
    const out = await reviewsFromGraph();
    expect(out.source).toBe('teamwork-graph');
    expect(out.records).toEqual([
      { reviewer: '712020:tom', repo: 'payments-core', pr: 'https://bitbucket.org/acme/payments-core/pull-requests/12', at: '2026-10-20T10:00:00Z' },
      { reviewer: '712020:priya', repo: 'ledger-service', pr: 'https://github.com/acme/ledger-service/pull/7', at: '2026-10-21T10:00:00Z' },
      { reviewer: '712020:tom', repo: 'payments-core', pr: 'https://bitbucket.org/acme/payments-core/pull-requests/15', at: '2026-10-25T10:00:00Z' },
    ]);
    expect(calls.map((c) => c.variables)).toEqual([
      { queryKey: REVIEWS_QUERY_KEY, after: null },
      { queryKey: REVIEWS_QUERY_KEY, after: 'c1' },
    ]);
  });

  it('uses an operation name of the shape the Teamwork Graph accepts, and customQuery', () => {
    expect(QUERY).toMatch(/^query [a-z]{3,}_[a-z]{4,}\(/);
    expect(QUERY).toContain('customQuery(queryKey: $queryKey');
    expect(QUERY).not.toContain('cypherQuery(');
  });

  it('reports the API error and falls back', async () => {
    pages = [{ errors: [{ message: 'The cypherQuery field is restricted' }] }];
    const out = await reviewsFromGraph();
    expect(out).toEqual({ records: [], source: 'unavailable', error: 'The cypherQuery field is restricted' });
  });
});
