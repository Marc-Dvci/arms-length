import api, { assumeTrustedRoute, fetch, route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { snapshotFromBitbucket, type BbActivity, type BbCommit, type BbPullRequest } from '../../src/adapters/bitbucket';
import { SIGNATURE_HEADER, sign } from '../../src/core/signature';

export interface Pairing {
  endpoint: string;
}

export interface CheckResult {
  verdict: 'PASS' | 'FAIL' | 'CANNOT_DETERMINE';
  message: string;
  checkedAt: string;
  workItems?: { key: string; verdict: string }[];
}

const MAX_PAGES = 20;

async function pages<T>(first: string): Promise<{ values: T[]; complete: boolean }> {
  const values: T[] = [];
  let next: string | undefined = first;
  for (let i = 0; i < MAX_PAGES && next; i++) {
    const path = next.replace(/^https:\/\/api\.bitbucket\.org/, '');
    // Bitbucket's own `next` links are trusted; route`` would escape their query strings.
    const res = await api.asApp().requestBitbucket(assumeTrustedRoute(path));
    if (!res.ok) return { values, complete: false };
    const body = (await res.json()) as { values: T[]; next?: string };
    values.push(...body.values);
    next = body.next;
  }
  return { values, complete: !next };
}

/** Reads the pull request, its activity and its commits, and builds the snapshot. */
export async function readPullRequest(workspace: string, repository: string, id: number | string) {
  const res = await api.asApp().requestBitbucket(route`/2.0/repositories/${workspace}/${repository}/pullrequests/${id}`);
  if (!res.ok) throw new Error(`Bitbucket returned ${res.status} for the pull request.`);
  const pr = (await res.json()) as BbPullRequest & { destination?: { repository?: { full_name?: string; name?: string } } };
  const [activity, commits] = await Promise.all([
    pages<BbActivity>(`/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repository)}/pullrequests/${id}/activity?pagelen=50`),
    pages<BbCommit>(`/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repository)}/pullrequests/${id}/commits?pagelen=50`),
  ]);
  const slug = pr.destination?.repository?.full_name?.split('/').at(-1) ?? pr.destination?.repository?.name ?? repository;
  const snapshot = snapshotFromBitbucket({ repoSlug: slug, pr, activity: activity.values, commits: commits.values });
  return { ...snapshot, complete: snapshot.complete && activity.complete && commits.complete };
}

/** Sends the snapshot to the paired Jira site and returns its verdict. Unpaired or unreachable fails closed. */
export async function checkPullRequest(workspace: string, repository: string, id: number | string): Promise<CheckResult> {
  const checkedAt = new Date().toISOString();
  const pairing = (await kvs.get<Pairing>('pairing')) as Pairing | undefined;
  const secret = (await kvs.getSecret<string>('pairing-secret')) as string | undefined;
  if (!pairing || !secret) {
    return { verdict: 'CANNOT_DETERMINE', message: "Arm's Length is not paired with a Jira site yet. A workspace admin can pair it under Workspace settings > Arm's Length.", checkedAt };
  }
  const snapshot = await readPullRequest(workspace, repository, id);
  const body = JSON.stringify({ op: 'pr-snapshot', workspace, snapshot });
  const res = await fetch(pairing.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [SIGNATURE_HEADER]: sign(secret, body) },
    body,
  });
  if (!res.ok) {
    return { verdict: 'CANNOT_DETERMINE', message: `Arm's Length CANNOT DETERMINE: the Jira site answered ${res.status}.`, checkedAt };
  }
  const out = (await res.json()) as Omit<CheckResult, 'checkedAt'>;
  const result = { ...out, checkedAt };
  await kvs.set(`verdict:${snapshot.pullRequest.id}`, result);
  await kvs.set(`verdict-by-id:${repository}:${id}`, result);
  return result;
}

export async function ping(endpoint: string, secret: string): Promise<{ ok: boolean; status: number; error?: string }> {
  const body = JSON.stringify({ op: 'ping' });
  const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', [SIGNATURE_HEADER]: sign(secret, body) }, body });
  const text = await res.text();
  return { ok: res.ok, status: res.status, ...(res.ok ? {} : { error: text.slice(0, 200) }) };
}
