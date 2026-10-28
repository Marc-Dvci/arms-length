/**
 * In-memory stand-ins for Forge storage and the Jira REST API, used by the integration tests.
 * They implement only the calls the app makes, with the response shapes of the Jira Cloud REST v3 docs.
 */
import type { JiraChangelogEntry, JiraIssue, JiraUserRef } from '../src/adapters/jira';

export const memory = { store: new Map<string, unknown>(), secrets: new Map<string, unknown>() };

export const fakeKvs = {
  get: async (k: string) => structuredClone(memory.store.get(k)),
  set: async (k: string, v: unknown) => void memory.store.set(k, structuredClone(v)),
  delete: async (k: string) => void memory.store.delete(k),
  getSecret: async (k: string) => memory.secrets.get(k),
  setSecret: async (k: string, v: unknown) => void memory.secrets.set(k, v),
  query: () => {
    let prefix = '';
    const q = {
      where: (_f: string, cond: { prefix: string }) => ((prefix = cond.prefix), q),
      limit: () => q,
      cursor: () => q,
      getMany: async () => ({
        results: [...memory.store.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value: structuredClone(value) })),
      }),
    };
    return q;
  },
};

export interface FakeSite {
  issues: Record<string, JiraIssue & { id: string }>;
  changelogs: Record<string, JiraChangelogEntry[]>;
  users: Record<string, JiraUserRef>;
  properties: Record<string, unknown>;
  comments: Record<string, unknown[]>;
  created: { fields: Record<string, unknown> }[];
  devops: unknown[];
  confluence: { method: string; path: string; body?: { key?: string; value?: string; spaceId?: string; title?: string } }[];
  confluenceTitles: Set<string>;
  failChangelog: Set<string>;
  rejectLabels: boolean;
}

export const site: FakeSite = { issues: {}, changelogs: {}, users: {}, properties: {}, comments: {}, created: [], devops: [], confluence: [], confluenceTitles: new Set(), failChangelog: new Set(), rejectLabels: false };

export function resetSite() {
  memory.store.clear();
  memory.secrets.clear();
  Object.assign(site, { issues: {}, changelogs: {}, users: {}, properties: {}, comments: {}, created: [], devops: [], confluence: [], confluenceTitles: new Set(), failChangelog: new Set(), rejectLabels: false });
}

const ok = (body: unknown, status = 200) =>
  ({ ok: status < 300, status, statusText: 'OK', json: async () => body, text: async () => JSON.stringify(body), headers: new Headers() }) as unknown as Response;

export async function fakeRequestJira(path: string, init?: RequestInit): Promise<Response> {
  const url = new URL(path, 'https://site.atlassian.net');
  const p = url.pathname;
  const method = init?.method ?? 'GET';
  let m: RegExpMatchArray | null;
  if ((m = p.match(/^\/rest\/api\/3\/issue\/([^/]+)\/changelog$/))) {
    const key = decodeURIComponent(m[1]);
    if (site.failChangelog.has(key)) return ok({ errorMessages: ['nope'] }, 500);
    const all = site.changelogs[key] ?? [];
    const startAt = Number(url.searchParams.get('startAt') ?? 0);
    const max = Number(url.searchParams.get('maxResults') ?? 100);
    const values = all.slice(startAt, startAt + max);
    return ok({ startAt, maxResults: max, total: all.length, isLast: startAt + values.length >= all.length, values });
  }
  if ((m = p.match(/^\/rest\/api\/3\/issue\/([^/]+)\/properties\/([^/]+)$/)) && method === 'PUT') {
    site.properties[`${decodeURIComponent(m[1])}/${m[2]}`] = JSON.parse(String(init?.body));
    return ok({}, 200);
  }
  if ((m = p.match(/^\/rest\/api\/3\/issue\/([^/]+)\/comment$/)) && method === 'POST') {
    const key = decodeURIComponent(m[1]);
    site.comments[key] = [...(site.comments[key] ?? []), JSON.parse(String(init?.body))];
    return ok({ id: String(site.comments[key].length) }, 201);
  }
  if (p === '/rest/api/3/issue/bulk' && method === 'POST') {
    const body = JSON.parse(String(init?.body)) as { issueUpdates: { fields: Record<string, unknown> }[] };
    const issues: { key: string }[] = [];
    const errors: { failedElementNumber: number }[] = [];
    body.issueUpdates.forEach((u, i) => {
      if (site.rejectLabels && u.fields.labels) return errors.push({ failedElementNumber: i });
      site.created.push({ fields: u.fields });
      issues.push({ key: `PAY-${site.created.length}` });
    });
    return ok({ issues, errors }, 201);
  }
  if (p === '/rest/api/3/issue' && method === 'POST') {
    const body = JSON.parse(String(init?.body));
    site.created.push(body);
    return ok({ id: String(1000 + site.created.length), key: `OPS-${site.created.length}` }, 201);
  }
  if ((m = p.match(/^\/rest\/api\/3\/issue\/([^/]+)$/))) {
    const issue = site.issues[decodeURIComponent(m[1])];
    return issue ? ok(issue) : ok({ errorMessages: ['Issue does not exist'] }, 404);
  }
  if (p === '/rest/api/3/user') {
    const user = site.users[url.searchParams.get('accountId') ?? ''];
    return user ? ok(user) : ok({}, 404);
  }
  if (p === '/rest/api/3/serverInfo') return ok({ baseUrl: 'https://site.atlassian.net' });
  if ((m = p.match(/^\/rest\/api\/3\/project\/([^/]+)$/))) return ok({ id: '1', key: m[1], name: m[1], issueTypes: [{ id: '10001', name: 'Task' }] });
  if (p.startsWith('/rest/devinfo') || p.startsWith('/rest/deployments')) {
    // Jira rejects the whole request when a timestamp lacks seconds (2026-07-02T09:55Z).
    const stamps = [...String(init?.body ?? '').matchAll(/"lastUpdated?":"([^"]+)"/g)].map((x) => x[1]);
    const bad = stamps.find((t) => !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(t));
    if (bad) return ok({ errorMessages: [`'lastUpdate' is not a valid timestamp. Must be an ISO8601 / RFC3339 form: ${bad}`] }, 400);
    site.devops.push({ p, body: init?.body });
    return ok({ acceptedRepositories: [] }, 202);
  }
  return ok({ errorMessages: [`unhandled ${method} ${p}`] }, 404);
}

/** Confluence REST as the app sees it: pages and page properties, recorded in site.confluence. */
export async function fakeRequestConfluence(path: string, init?: RequestInit): Promise<Response> {
  const url = new URL(path, 'https://site.atlassian.net');
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  site.confluence.push({ method, path: url.pathname, body });
  const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.pathname === '/wiki/api/v2/spaces') {
    return reply({ results: [
      { id: '9', key: '~7120200a', name: 'Marc Donovici', type: 'personal' },
      { id: '7', key: 'SD', name: 'Software development', type: 'onboarding' },
    ] });
  }
  if (url.pathname === '/wiki/api/v2/pages' && method === 'POST') {
    if (site.confluenceTitles.has(body.title)) return reply({ errors: [{ title: 'A page with this title already exists' }] }, 400);
    site.confluenceTitles.add(body.title);
  }
  if (url.pathname === '/wiki/api/v2/pages' && method === 'POST') return reply({ id: '622595', _links: { base: 'https://site.atlassian.net/wiki', webui: '/spaces/SD/pages/622595' } });
  if (/^\/wiki\/api\/v2\/pages\/\d+\/properties$/.test(url.pathname) && method === 'POST') return reply({ id: '1', key: body.key, value: body.value });
  return reply({ message: `unhandled ${method} ${url.pathname}` }, 404);
}

/** route`` as Forge implements it: interpolated values are URL-encoded. */
export function fakeRoute(strings: TemplateStringsArray, ...values: unknown[]) {
  return strings.reduce((acc, s, i) => acc + s + (i < values.length ? encodeURIComponent(String(values[i])) : ''), '');
}
