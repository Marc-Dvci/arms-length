import type { WebTriggerRequest, WebTriggerResponse } from '@forge/api';
import { gateMessage } from '../core/explain';
import { canonicalJson, sha256 } from '../core/evidence';
import { evaluate } from '../core/evaluate';
import { SIGNATURE_HEADER, verify } from '../core/signature';
import type { PullRequest, Ref, VerdictValue } from '../core/types';
import { assessIssue } from './chain';
import { appendUnique, getConfig, readValue, updateValue, kvs, K, type StoredPullRequest } from './store';

const reply = (statusCode: number, body: unknown): WebTriggerResponse => ({
  statusCode,
  headers: { 'Content-Type': ['application/json'] },
  body: JSON.stringify(body),
});

export const commitKey = (repo: string, hash: string) => K.commit(sha256(canonicalJson([repo.toLowerCase(), hash.toLowerCase()])));
const fullHash = (hash: unknown): hash is string => typeof hash === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(hash);
const fullRepository = (repo: unknown): repo is string => typeof repo === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);

export interface SnapshotMessage {
  op: 'pr-snapshot';
  workspace: string;
  snapshot: {
    pullRequest: PullRequest;
    repositoryFullName?: string;
    sourceUpdatedAt?: string;
    observedAt?: string;
    people: Record<Ref, { name: string; type?: string }>;
    workItems: string[];
    complete: boolean;
  };
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
  if (
    !pullRequest ||
    !Array.isArray(pullRequest.commits) ||
    !Array.isArray(pullRequest.reviews) ||
    !Array.isArray(workItems) ||
    workItems.length > 20 ||
    workItems.some((k) => !/^[A-Z][A-Z0-9_]*-\d+$/.test(k))
  )
    throw new Error('Invalid pull request snapshot.');
  const now = new Date().toISOString();
  const repositoryFullName = msg.snapshot.repositoryFullName?.toLowerCase();
  if (repositoryFullName && !fullRepository(repositoryFullName)) throw new Error('Invalid repository identity.');
  const id = repositoryFullName ? `${repositoryFullName}#${pullRequest.id.split('#').at(-1)}` : pullRequest.id;
  const observedAt = msg.snapshot.observedAt ?? now;
  const sourceUpdatedAt =
    msg.snapshot.sourceUpdatedAt ??
    [...pullRequest.commits.map((c) => c.at), ...pullRequest.reviews.map((r) => r.at), pullRequest.mergedAt, pullRequest.createdAt]
      .filter((s): s is string => !!s)
      .sort((a, b) => Date.parse(a) - Date.parse(b))
      .at(-1)!;
  if (![observedAt, sourceUpdatedAt].every((t) => Number.isFinite(Date.parse(t))) || Date.parse(observedAt) > Date.now() + 60000)
    throw new Error('Invalid snapshot revision time.');
  const incoming: StoredPullRequest = {
    ...pullRequest,
    id,
    workItems: [...new Set(workItems)],
    workspace: msg.workspace,
    ...(repositoryFullName ? { repositoryFullName } : {}),
    sourceUpdatedAt,
    observedAt,
    receivedAt: now,
    complete,
    people,
  };
  const stored = await updateValue<StoredPullRequest>(K.pr(id), (prior) => {
    if (
      prior &&
      (Date.parse(prior.sourceUpdatedAt ?? prior.createdAt) > Date.parse(sourceUpdatedAt) ||
        Date.parse(prior.observedAt ?? prior.receivedAt) > Date.parse(observedAt))
    )
      return prior;
    // A pull request cannot return to OPEN after it has been merged or declined.
    if (prior && prior.state !== 'OPEN' && incoming.state === 'OPEN') return prior;
    if (prior && msg.snapshot.observedAt && prior.observedAt === observedAt && prior.sourceUpdatedAt === sourceUpdatedAt) {
      const { receivedAt: _oldReceipt, ...oldEvidence } = prior;
      const { receivedAt: _newReceipt, ...newEvidence } = incoming;
      if (canonicalJson(oldEvidence) !== canonicalJson(newEvidence)) return { ...incoming, complete: false };
    }
    return incoming;
  });
  const legacyId = `${stored.repo}#${stored.id.split('#').at(-1)}`;
  const legacy = stored.repositoryFullName && legacyId !== stored.id ? await readValue<StoredPullRequest>(K.pr(legacyId)) : undefined;
  for (const key of stored.workItems)
    await updateValue<string[]>(K.prsOf(key), (ids = []) => [
      ...ids.filter((id) => id !== stored.id && !(legacy && legacy.workspace === stored.workspace && !legacy.repositoryFullName && id === legacyId)),
      stored.id,
    ]);
  if (stored.repositoryFullName)
    for (const hash of [...stored.commits.map((c) => c.hash), stored.mergeCommit].filter((h): h is string => fullHash(h))) {
      await appendUnique<string>(commitKey(stored.repositoryFullName, hash), stored.id, (a, b) => a === b);
    }
  type History = { reviewer: Ref; repo: string; pr: string; at: string };
  const mine = stored.reviews.filter((r) => r.action === 'approved').map((r) => ({ reviewer: r.by, repo: stored.repo, pr: stored.id, at: r.at }));
  await updateValue<History[]>(K.reviews(stored.repo), (history = []) => [...history.filter((h) => h.pr !== stored.id), ...mine].slice(-500));
  return stored;
}

async function onSnapshot(msg: SnapshotMessage) {
  const stored = await storeSnapshot(msg);
  if (!stored.workItems.length) {
    return {
      verdict: 'CANNOT_DETERMINE' as VerdictValue,
      message: "Arm's Length CANNOT DETERMINE: the branch name and title name no Jira work item.",
      workItems: [],
    };
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
  const at = new Date().toISOString();
  const log = (entry: Record<string, unknown>) =>
    updateValue<Record<string, unknown>[]>('gate-log', (rows = []) => [...rows, { at, ...msg, ...entry }].slice(-50));
  const repo = typeof msg.repo === 'string' ? msg.repo.toLowerCase() : '';
  const ids = fullRepository(repo) && fullHash(msg.commit) ? ((await readValue<string[]>(commitKey(repo, msg.commit))) ?? []) : [];
  const candidates = await Promise.all(ids.map((id) => readValue<StoredPullRequest>(K.pr(id))));
  const pr = candidates.filter(
    (p): p is StoredPullRequest =>
      !!p &&
      p.repositoryFullName === repo &&
      p.state === 'MERGED' &&
      !!p.mergedAt &&
      p.complete &&
      (p.mergeCommit === msg.commit || p.commits.at(-1)?.hash === msg.commit),
  );
  if (pr.length !== 1) {
    const message = `Arm's Length FAIL: the full commit and repository must identify one complete, merged pull request with that final or merge commit (AL-7).`;
    await log({ allow: false, message });
    return { allow: false, verdict: 'FAIL', message, workItems: [] };
  }
  const source = pr[0];
  const production = config.policy.productionEnvironments.includes(msg.environment);
  const results = [];
  for (const key of source.workItems) {
    const a = await assessIssue(key, { writeProperty: false });
    const deployment = { id: `${repo}-${msg.build ?? at}`, env: msg.environment, at, commit: msg.commit, triggeredBy: msg.triggeredBy, pipeline: repo };
    const projected = { ...a.chain, deployments: [...a.chain.deployments.filter((d) => d.id !== deployment.id), deployment] };
    const verdict = evaluate(projected, config.policy);
    results.push({ key, verdict: verdict.verdict, rule: verdict.rule, message: gateMessage(projected, verdict) });
  }
  const allow = results.length > 0 && results.every((r) => r.verdict === 'PASS');
  if (allow && production) {
    for (const key of source.workItems) {
      await appendUnique(
        K.deployments(key),
        { id: `${repo}-${msg.build ?? at}`, env: msg.environment, at, commit: msg.commit, triggeredBy: msg.triggeredBy, pipeline: repo },
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
