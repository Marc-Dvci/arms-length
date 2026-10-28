import api, { route } from '@forge/api';
import type { JiraChangelogEntry, JiraIssue, JiraUserRef } from '../adapters/jira';

export const PROPERTY_KEY = 'arms-length';

async function json<T>(res: Response | Awaited<ReturnType<ReturnType<typeof api.asApp>['requestJira']>>, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300));
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export async function getIssue(key: string): Promise<JiraIssue & { id: string }> {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${key}?fields=summary,created,reporter,creator,assignee,labels,status`);
  return json(res, `Reading ${key}`);
}

/** The full changelog, or null when any page could not be read. */
export async function getChangelog(key: string): Promise<JiraChangelogEntry[] | null> {
  const out: JiraChangelogEntry[] = [];
  let startAt = 0;
  for (let page = 0; page < 50; page++) {
    const res = await api.asApp().requestJira(route`/rest/api/3/issue/${key}/changelog?startAt=${startAt}&maxResults=100`);
    if (!res.ok) return null;
    const body = (await res.json()) as { values: JiraChangelogEntry[]; isLast?: boolean; total?: number; maxResults: number };
    out.push(...body.values);
    startAt += body.values.length;
    if (body.isLast || body.values.length === 0 || (body.total !== undefined && startAt >= body.total)) return out;
  }
  return null;
}

const userCache = new Map<string, JiraUserRef | null>();

export async function getUser(accountId: string): Promise<JiraUserRef | null> {
  if (userCache.has(accountId)) return userCache.get(accountId)!;
  const res = await api.asApp().requestJira(route`/rest/api/3/user?accountId=${accountId}`);
  const user = res.ok ? ((await res.json()) as JiraUserRef) : null;
  userCache.set(accountId, user);
  return user;
}

export async function setIssueProperty(key: string, value: unknown): Promise<void> {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${key}/properties/${PROPERTY_KEY}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!res.ok && res.status !== 201) throw new Error(`Writing the verdict property of ${key} failed: ${res.status}`);
}

export async function addComment(key: string, paragraphs: string[]): Promise<{ id: string }> {
  const body = {
    body: {
      type: 'doc',
      version: 1,
      content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
    },
  };
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${key}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return json(res, `Commenting on ${key}`);
}

export async function createIssue(fields: Record<string, unknown>): Promise<{ id: string; key: string }> {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  return json(res, 'Creating a work item');
}

/**
 * Creates work items in one call (Jira accepts up to 50). Items Jira rejects are retried with only
 * project, type and summary, for projects whose create screen lacks labels or description.
 */
export async function createIssues(items: Record<string, unknown>[]): Promise<string[]> {
  const keys: string[] = [];
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50);
    const res = await api.asApp().requestJira(route`/rest/api/3/issue/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueUpdates: batch.map((fields) => ({ fields })) }),
    });
    const body = (await res.json()) as { issues?: { key: string }[]; errors?: { failedElementNumber: number }[] };
    const failed = new Set((body.errors ?? []).map((e) => e.failedElementNumber));
    const created = [...(body.issues ?? [])];
    for (let j = 0; j < batch.length; j++) {
      if (!failed.has(j) && res.ok) {
        keys.push(created.shift()!.key);
        continue;
      }
      if (!failed.has(j)) created.shift();
      const { project, issuetype, summary } = batch[j] as { project: unknown; issuetype: unknown; summary: unknown };
      keys.push((await createIssue({ project, issuetype, summary })).key);
    }
  }
  return keys;
}

export async function getProject(key: string): Promise<{ id: string; key: string; name: string; issueTypes?: { id: string; name: string; subtask?: boolean }[] }> {
  const res = await api.asApp().requestJira(route`/rest/api/3/project/${key}`);
  return json(res, `Reading project ${key}`);
}

export async function listProjects(): Promise<{ id: string; key: string; name: string }[]> {
  const res = await api.asApp().requestJira(route`/rest/api/3/project/search?maxResults=50&orderBy=name`);
  const body = await json<{ values: { id: string; key: string; name: string }[] }>(res, 'Listing projects');
  return body.values;
}

export async function siteUrl(): Promise<string> {
  const res = await api.asApp().requestJira(route`/rest/api/3/serverInfo`);
  const body = await json<{ baseUrl: string }>(res, 'Reading the site address');
  return body.baseUrl;
}

/** POST to the Development Information or Deployments API of Jira Software. */
export async function postDevOps(path: 'devinfo' | 'deployments', body: unknown): Promise<unknown> {
  const res =
    path === 'devinfo'
      ? await api.asApp().requestJira(route`/rest/devinfo/0.10/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await api.asApp().requestJira(route`/rest/deployments/0.1/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return json(res, `Sending ${path} data`);
}

export async function deleteDevOpsByProperty(property: string, value: string): Promise<void> {
  await api.asApp().requestJira(route`/rest/devinfo/0.10/bulkByProperties?${property}=${value}`, { method: 'DELETE' });
  await api.asApp().requestJira(route`/rest/deployments/0.1/bulkByProperties?${property}=${value}`, { method: 'DELETE' });
}
