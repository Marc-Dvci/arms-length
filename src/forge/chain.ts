import { assignmentsFromHistory, emergencyFromHistory, kindFromAccountType } from '../adapters/jira';
import { evaluate } from '../core/evaluate';
import { explain, type Explanation } from '../core/explain';
import type { ChangeChain, Person, Ref, Verdict } from '../core/types';
import { getChangelog, getIssue, getUser, setIssueProperty } from './jira';
import { getConfig, getDeclarations, getDemoChain, getDeployments, getPullRequests, kvs, K, type AppConfig } from './store';

export interface Assessed {
  chain: ChangeChain;
  verdict: Verdict;
  explanation: Explanation;
  source: 'demo' | 'live';
}

async function person(ref: Ref, config: AppConfig, hints: Record<Ref, { name: string; type?: string }>): Promise<Person | null> {
  const override = config.identities[ref];
  // Unmapped commit authors (raw:) and Bitbucket-only accounts (bb:{uuid}) are not Atlassian accounts, and their
  // characters are not allowed in storage keys.
  const account = !ref.startsWith('raw:') && !ref.startsWith('bb:');
  const cached = account ? ((await kvs.get<Person>(K.person(ref))) as Person | undefined) : undefined;
  if (override) return { name: cached?.name ?? hints[ref]?.name ?? ref, kind: override.kind, ...(override.actsAs ? { actsAs: override.actsAs } : {}) };
  if (cached) return cached;
  // Bitbucket app users (access-token bots, apps) act for an agent even when Jira does not know them.
  const appUser = hints[ref]?.type === 'app_user' ? ({ name: hints[ref].name, kind: 'agent' } as Person) : null;
  if (!account) return appUser;
  const user = await getUser(ref);
  if (!user) return appUser;
  const p: Person = { name: user.displayName ?? hints[ref]?.name ?? ref, kind: appUser ? 'agent' : kindFromAccountType(user.accountType) };
  await kvs.set(K.person(ref), p);
  return p;
}

/** Rebuilds the change chain of a work item from Jira, the app's MCP records and the pull request snapshots. */
export async function liveChain(key: string, config: AppConfig): Promise<ChangeChain> {
  const [issue, changelog, declarations, prs, deployments] = await Promise.all([
    getIssue(key),
    getChangelog(key),
    getDeclarations(key),
    getPullRequests(key),
    getDeployments(key),
  ]);
  const automationActors = new Set(Object.entries(config.identities).filter(([, o]) => o.kind === 'automation').map(([ref]) => ref));
  const assignments = changelog ? assignmentsFromHistory(issue, changelog, automationActors) : [];
  const automationRules: ChangeChain['automationRules'] = {};
  for (const ref of automationActors) automationRules[ref] = { owner: config.identities[ref].owner ?? null };

  const refs = new Set<Ref>();
  const hints: Record<Ref, { name: string; type?: string }> = {};
  if (issue.fields.reporter?.accountId) refs.add(issue.fields.reporter.accountId);
  for (const a of assignments) [a.by, a.to].forEach((r) => refs.add(r));
  for (const d of declarations) refs.add(d.principal);
  for (const pr of prs) {
    Object.assign(hints, pr.people ?? {});
    [pr.author, ...pr.commits.map((c) => c.author), ...pr.reviews.map((r) => r.by)].forEach((r) => refs.add(r));
  }
  for (const [ref, o] of Object.entries(config.identities)) {
    refs.add(ref);
    if (o.actsAs) refs.add(o.actsAs);
  }
  const people: Record<Ref, Person> = {};
  await Promise.all(
    [...refs].map(async (ref) => {
      const p = await person(ref, config, hints);
      if (p) people[ref] = p;
    }),
  );

  return {
    workItem: { key: issue.key, requester: issue.fields.reporter?.accountId ?? null, summary: issue.fields.summary },
    people,
    assignments,
    declarations,
    automationRules,
    pullRequests: prs,
    deployments,
    emergency: changelog ? emergencyFromHistory(issue, changelog, config.emergencyLabel) : null,
    history: { jira: changelog ? 'complete' : 'missing', scm: prs.every((p) => p.complete !== false) ? 'complete' : 'missing' },
  };
}

/** Evaluates a work item and mirrors the verdict into the issue property that JQL indexes. */
export async function assessIssue(key: string, opts: { writeProperty?: boolean } = {}): Promise<Assessed> {
  const config = await getConfig();
  const demo = await getDemoChain(key);
  const chain = demo ?? (await liveChain(key, config));
  const verdict = evaluate(chain, config.policy);
  const assessed: Assessed = { chain, verdict, explanation: explain(chain, verdict), source: demo ? 'demo' : 'live' };
  if (opts.writeProperty !== false) {
    const prod = verdict.deployments.map((d) => d.at).sort();
    await setIssueProperty(key, {
      verdict: verdict.verdict,
      rule: verdict.rule ?? 'none',
      evidenceHash: verdict.evidenceHash,
      rulesVersion: verdict.rulesVersion,
      lastProductionDeploy: prod.at(-1) ?? null,
      productionDeployments: prod.length,
      updatedAt: new Date().toISOString(),
    }).catch(() => undefined);
  }
  return assessed;
}
