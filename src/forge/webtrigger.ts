import type { WebTriggerRequest, WebTriggerResponse } from '@forge/api';
import { gateMessage } from '../core/explain';
import { SIGNATURE_HEADER, verify } from '../core/signature';
import type { PullRequest, Ref, VerdictValue } from '../core/types';
import { assessIssue } from './chain';
import { appendUnique, getConfig, getList, kvs, K, type StoredPullRequest } from './store';

const reply = (statusCode: number, body: unknown): WebTriggerResponse => ({
  statusCode,
  headers: { 'Content-Type': ['application/json'] },
  body: JSON.stringify(body),
});

export const commitKey = (hash: string) => K.commit(hash.slice(0, 12).toLowerCase());

export interface SnapshotMessage {
  op: 'pr-snapshot';
  workspace: string;
  snapshot: { pullRequest: PullRequest; people: Record<Ref, { name: string; type?: string }>; workItems: string[]; complete: boolean };
}

export interface GateMessage {
  op: 'deploy-gate';
  repo: string;
  commit: string;
  environment: string;
  build?: string;
  triggeredBy?: string;
}

export async function storeSnapshot(msg: SnapshotMessage): Promise<StoredPullRequest> {
  const { pullRequest, people, workItems, complete } = msg.snapshot;
  const stored: StoredPullRequest = { ...pullRequest, workItems, workspace: msg.workspace, receivedAt: new Date().toISOString(), complete, people };
  await kvs.set(K.pr(pullRequest.id), stored);
  for (const key of workItems) await appendUnique<string>(K.prsOf(key), pullRequest.id, (a, b) => a === b);
  for (const hash of [...pullRequest.commits.map((c) => c.hash), pullRequest.mergeCommit].filter((h): h is string => !!h)) {
    await kvs.set(commitKey(hash), pullRequest.id);
  }
  const history = await getList<{ reviewer: Ref; repo: string; pr: string; at: string }>(K.reviews(pullRequest.repo));
  const others = history.filter((h) => h.pr !== pullRequest.id);
  const mine = pullRequest.reviews.filter((r) => r.action === 'approved').map((r) => ({ reviewer: r.by, repo: pullRequest.repo, pr: pullRequest.id, at: r.at }));
  await kvs.set(K.reviews(pullRequest.repo), [...others, ...mine].slice(-500));
  return stored;
}

async function onSnapshot(msg: SnapshotMessage) {
  const stored = await storeSnapshot(msg);
  if (!stored.workItems.length) {
    return { verdict: 'CANNOT_DETERMINE' as VerdictValue, message: "Arm's Length CANNOT DETERMINE: the branch name and title name no Jira work item.", workItems: [] };
  }
  const results = [];
  for (const key of stored.workItems) {
    try {
      const a = await assessIssue(key);
      const pr = a.verdict.pullRequests.find((p) => p.pr === stored.id);
      results.push({ key, verdict: (pr?.verdict ?? a.verdict.verdict) as VerdictValue, message: gateMessage(a.chain, a.verdict, stored.id) });
    } catch {
      results.push({ key, verdict: 'CANNOT_DETERMINE' as VerdictValue, message: `Arm's Length CANNOT DETERMINE: ${key} could not be read.` });
    }
  }
  const worst = results.find((r) => r.verdict === 'FAIL') ?? results.find((r) => r.verdict === 'CANNOT_DETERMINE') ?? results[0];
  return { verdict: worst.verdict, message: worst.message, workItems: results };
}

async function onGate(msg: GateMessage) {
  const config = await getConfig();
  const prId = (await kvs.get<string>(commitKey(msg.commit))) as string | undefined;
  const at = new Date().toISOString();
  const log = (entry: Record<string, unknown>) =>
    getList<Record<string, unknown>>('gate-log').then((l) => kvs.set('gate-log', [...l, { at, ...msg, ...entry }].slice(-50)));
  if (!prId) {
    const message = `Arm's Length FAIL: commit ${msg.commit.slice(0, 12)} is not part of any pull request on record (AL-7).`;
    await log({ allow: false, message });
    return { allow: false, verdict: 'FAIL', message, workItems: [] };
  }
  const pr = (await kvs.get<StoredPullRequest>(K.pr(prId))) as StoredPullRequest;
  const production = config.policy.productionEnvironments.includes(msg.environment);
  const results = [];
  for (const key of pr.workItems) {
    const a = await assessIssue(key, { writeProperty: false });
    results.push({ key, verdict: a.verdict.verdict, rule: a.verdict.rule, message: gateMessage(a.chain, a.verdict) });
  }
  const allow = results.length > 0 && results.every((r) => r.verdict === 'PASS');
  if (allow && production) {
    for (const key of pr.workItems) {
      await appendUnique(
        K.deployments(key),
        { id: `${msg.repo}-${msg.build ?? at}`, env: msg.environment, at, commit: msg.commit, triggeredBy: msg.triggeredBy, pipeline: msg.repo },
        (a, b) => a.id === b.id,
      );
      await assessIssue(key);
    }
  }
  const blocking = results.find((r) => r.verdict !== 'PASS');
  const message = allow
    ? `Arm's Length PASS: ${results.map((r) => r.key).join(', ')} independently approved; release allowed.`
    : (blocking?.message ?? "Arm's Length FAIL: no work item linked.");
  await log({ allow, message });
  return { allow, verdict: allow ? 'PASS' : (blocking?.verdict ?? 'FAIL'), message, workItems: results };
}

/** Signed endpoint for the Bitbucket app and the Pipelines release gate. */
export async function handler(req: WebTriggerRequest): Promise<WebTriggerResponse> {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  const secret = (await kvs.getSecret<string>(K.secret)) as string | undefined;
  if (!secret) return reply(503, { error: "Arm's Length is not paired yet. Open the app's settings in Jira to create a pairing secret." });
  const header = req.headers[SIGNATURE_HEADER]?.[0] ?? req.headers[SIGNATURE_HEADER.toLowerCase()]?.[0];
  const check = verify(secret, req.body, header);
  if (!check.ok) return reply(401, { error: `Signature ${check.reason}` });
  let msg: SnapshotMessage | GateMessage | { op: 'ping' };
  try {
    msg = JSON.parse(req.body);
  } catch {
    return reply(400, { error: 'Body is not JSON' });
  }
  try {
    if (msg.op === 'ping') return reply(200, { ok: true });
    if (msg.op === 'pr-snapshot') return reply(200, await onSnapshot(msg));
    if (msg.op === 'deploy-gate') return reply(200, await onGate(msg));
    return reply(400, { error: 'Unknown operation' });
  } catch (e) {
    return reply(500, { allow: false, verdict: 'CANNOT_DETERMINE', message: `Arm's Length CANNOT DETERMINE: ${(e as Error).message}`.slice(0, 300) });
  }
}
