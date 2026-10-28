import { evaluate } from '../core/evaluate';
import { gateMessage } from '../core/explain';
import type { ChangeChain, Ref } from '../core/types';
import { buildDemoBank, DEMO_OPEN_ITEM, DEMO_ROLES } from '../demo/bank';
import { assessIssue } from './chain';
import { createIssues, deleteDevOpsByProperty, getProject, getUser, postDevOps } from './jira';
import { getDemoChain, getDemoIndex, kvs, K, listByPrefix, type DemoIndex } from './store';

const REPO_URL = 'https://github.com/Marc-Dvci/arms-length';
const DEMO_PROPERTY = 'armsLengthDemo';

/** Replaces demo keys (PAY-431) with the keys Jira gave the created work items. */
function rekey(chain: ChangeChain, keys: Record<string, string>): ChangeChain {
  const c = structuredClone(chain);
  const from = c.workItem.key;
  const to = keys[from];
  c.workItem.key = to;
  for (const pr of c.pullRequests) pr.sourceBranch = pr.sourceBranch.replace(from, to);
  return c;
}

/** Jira's development and deployment APIs want full ISO 8601 timestamps, with seconds. */
const isoFull = (stamp: string) => new Date(stamp).toISOString();

const docUrl = (anchor: string) => `${REPO_URL}/blob/main/docs/demo-bank.md#${anchor.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

async function pushDevInfo(chains: ChangeChain[], demoKeys: Record<string, string>) {
  const byRepo = new Map<string, ChangeChain[]>();
  for (const c of chains) for (const pr of c.pullRequests) byRepo.set(pr.repo, [...(byRepo.get(pr.repo) ?? []), c]);
  const seq = Date.now();
  const repositories = [...byRepo.entries()].map(([repo, cs]) => ({
    id: `arms-length-demo-${repo}`,
    name: repo,
    url: docUrl(repo),
    updateSequenceId: seq,
    pullRequests: cs.flatMap((c) =>
      c.pullRequests
        .filter((pr) => pr.repo === repo)
        .map((pr) => {
          const current = new Map(pr.reviews.map((r) => [r.by, r.action]));
          return {
            id: pr.id.replace('#', '-'),
            updateSequenceId: seq,
            associations: [{ associationType: 'issueIdOrKeys', values: [c.workItem.key] }],
            status: pr.state,
            title: c.workItem.summary ?? pr.id,
            author: { name: c.people[pr.author]?.name ?? pr.author },
            commentCount: 0,
            sourceBranch: pr.sourceBranch,
            destinationBranch: 'main',
            lastUpdate: isoFull(pr.mergedAt ?? pr.reviews.at(-1)?.at ?? pr.createdAt),
            reviewers: [...current.entries()]
              .filter(([by]) => c.people[by])
              .map(([by, action]) => ({ name: c.people[by].name, approvalStatus: action === 'approved' ? 'APPROVED' : 'UNAPPROVED', ...(by.startsWith('u:') || by.startsWith('a:') || by.startsWith('b:') || by.startsWith('s:') ? {} : { accountId: by }) })),
            url: docUrl(`${repo}-${pr.id.split('#')[1]}`),
            displayId: `#${pr.id.split('#')[1]}`,
          };
        }),
    ),
  }));
  await postDevOps('devinfo', { repositories, properties: { [DEMO_PROPERTY]: 'bank' } });

  const deployments = chains.flatMap((c) =>
    c.deployments.map((d, i) => ({
      deploymentSequenceNumber: Number(d.id.replace(/\D/g, '')) * 10 + i,
      updateSequenceNumber: seq,
      associations: [{ associationType: 'issueIdOrKeys', values: [c.workItem.key] }],
      displayName: `${d.pipeline ?? 'release'} ${d.id}`,
      url: docUrl(d.id),
      description: `Deployed ${d.commit}`,
      lastUpdated: isoFull(d.at),
      label: d.commit,
      state: 'successful',
      pipeline: { id: d.pipeline ?? 'payments-release', displayName: d.pipeline ?? 'payments-release', url: docUrl('pipelines') },
      environment: { id: d.env, displayName: d.env, type: d.env === 'production' ? 'production' : 'staging' },
    })),
  );
  for (let i = 0; i < deployments.length; i += 100) {
    await postDevOps('deployments', { deployments: deployments.slice(i, i + 100), properties: { [DEMO_PROPERTY]: 'bank' } });
  }
  return { demoKeys };
}

/** Runs async work in parallel batches, to stay inside the resolver's time limit. */
async function inBatches<T>(items: T[], size: number, fn: (t: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

/** Creates the demo bank's work items in a project and stores their change chains. */
export async function loadDemoBank(projectKey: string, caller: Ref): Promise<DemoIndex> {
  const existing = await getDemoIndex();
  if (existing) return existing;
  const project = await getProject(projectKey);
  const type = project.issueTypes?.find((t) => !t.subtask && /task|story/i.test(t.name)) ?? project.issueTypes?.find((t) => !t.subtask);
  const bank = buildDemoBank();
  const roles = Object.entries(DEMO_ROLES).map(([ref, role]) => `${bank[0].people[ref]?.name}: ${role}`).join('; ');
  const created = await createIssues(
    bank.map((c) => ({
      project: { key: project.key },
      issuetype: type ? { id: type.id } : { name: 'Task' },
      summary: `${c.workItem.summary} [${c.workItem.key}]`,
      labels: ['arms-length-demo', ...(c.emergency ? ['emergency-change'] : [])],
      description: {
        type: 'doc',
        version: 1,
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: `Demo bank work item ${c.workItem.key}. Its change chain (people, agents, pull requests, deployments) is synthetic and stored by Arm's Length.` }] },
          { type: 'paragraph', content: [{ type: 'text', text: `Synthetic team: ${roles}.` }] },
        ],
      },
    })),
  );
  const keys: Record<string, string> = {};
  bank.forEach((c, i) => (keys[c.workItem.key] = created[i]));
  const chains = bank.map((c) => rekey(c, keys));
  await inBatches(chains, 10, (c) => kvs.set(K.demoChain(c.workItem.key), c));
  const devInfo = await pushDevInfo(chains, keys).then(
    () => 'sent',
    (e: Error) => `not sent: ${e.message}`.slice(0, 200),
  );
  const index: DemoIndex = { projectKey: project.key, loadedAt: new Date().toISOString(), loadedBy: caller, keys, devInfo };
  await kvs.set(K.demoIndex, index);
  await inBatches(chains, 10, (c) => assessIssue(c.workItem.key).catch(() => undefined));
  return index;
}

/** Sends the stored demo chains to Jira's development panel again, after a failed first send. */
export async function resendDevInfo(): Promise<DemoIndex | null> {
  const index = await getDemoIndex();
  if (!index) return null;
  const chains = (await Promise.all(Object.values(index.keys).map((key) => getDemoChain(key)))).filter((c): c is ChangeChain => !!c);
  const devInfo = await pushDevInfo(chains, index.keys).then(
    () => 'sent',
    (e: Error) => `not sent: ${e.message}`.slice(0, 200),
  );
  const next = { ...index, devInfo };
  await kvs.set(K.demoIndex, next);
  return next;
}

export async function removeDemoBank(): Promise<void> {
  for (const { key } of await listByPrefix('demo:')) await kvs.delete(key);
  await kvs.delete(K.demoIndex);
  await deleteDevOpsByProperty(DEMO_PROPERTY, 'bank').catch(() => undefined);
}

/** The work item created for PAY-482, the open pull request a judge can approve. */
export async function demoSceneKey(): Promise<string | null> {
  return (await getDemoIndex())?.keys[DEMO_OPEN_ITEM] ?? null;
}

async function update(key: string, change: (c: ChangeChain) => void) {
  const chain = await getDemoChain(key);
  if (!chain) throw new Error(`${key} is not part of the demo bank.`);
  change(chain);
  await kvs.set(K.demoChain(key), chain);
  await pushDevInfo([chain], {}).catch(() => undefined);
  return assessIssue(key);
}

/** Approves the open demo pull request as the person clicking, on its current head commit. */
export async function demoApprove(key: string, caller: Ref) {
  const user = await getUser(caller);
  return update(key, (c) => {
    const pr = c.pullRequests.find((p) => p.state === 'OPEN');
    if (!pr) throw new Error('The demo pull request is already merged.');
    c.people[caller] = { name: user?.displayName ?? 'You', kind: 'human' };
    pr.reviews.push({ by: caller, action: 'approved', at: new Date().toISOString(), commit: pr.commits.at(-1)!.hash });
  });
}

/**
 * Merges the open demo pull request and deploys it, through the same check the Pipelines gate
 * runs: a pull request without independent approval is not deployed.
 */
export async function demoShip(key: string, caller: Ref) {
  const chain = await getDemoChain(key);
  if (!chain) throw new Error(`${key} is not part of the demo bank.`);
  const pr = chain.pullRequests.find((p) => p.state === 'OPEN');
  if (!pr) throw new Error('The demo pull request is already merged.');
  const before = evaluate(chain);
  const assessed = before.pullRequests.find((p) => p.pr === pr.id);
  if (assessed?.verdict !== 'PASS') return { shipped: false, message: gateMessage(chain, before, pr.id) };
  const result = await update(key, (c) => {
    const open = c.pullRequests.find((p) => p.id === pr.id)!;
    const now = Date.now();
    open.state = 'MERGED';
    open.mergedAt = new Date(now).toISOString();
    open.mergedBy = caller;
    open.mergeCommit = `${open.commits.at(-1)!.hash.slice(0, 3)}m3e2`;
    c.deployments.push({ id: `prod-${open.id.split('#')[1]}`, env: 'production', at: new Date(now + 60_000).toISOString(), commit: open.mergeCommit, triggeredBy: 'pipeline', pipeline: 'payments-release' });
  });
  return { shipped: true, message: gateMessage(result.chain, result.verdict), assessed: result };
}
