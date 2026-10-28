import api, { route } from '@forge/api';
import { describeRoles, nameOf } from '../core/explain';
import { allowedFromEvidence, checkDraft, type GuardResult } from '../core/guard';
import { runPopulationTest, type PopulationResult } from '../core/population';
import { suggestReviewers, type ReviewRecord } from '../core/reviewers';
import { RULES } from '../core/rules';
import type { ChangeChain, Ref } from '../core/types';
import { buildWorkpaper } from '../core/workpaper';
import { assessIssue, liveChain, type Assessed } from './chain';
import { reviewsFromGraph } from './graph';
import { addComment, createIssue, getIssue, getProject, getUser, siteUrl } from './jira';
import { appendUnique, getConfig, getDemoIndex, getList, K, listByPrefix } from './store';

export interface Suggestion {
  ref: Ref;
  name: string;
  reviews: number;
  repo: string;
  lastAt: string;
}

export interface WhoMustApprove {
  workItem: string;
  verdict: string;
  rule: string | null;
  pullRequest: string | null;
  mustNotApprove: { ref: Ref; name: string; why: string }[];
  suggestions: Suggestion[];
  historySource: string;
  explanation: string[];
}

async function reviewHistory(chain: ChangeChain, source: Assessed['source']): Promise<{ records: ReviewRecord[]; source: string }> {
  if (source === 'demo') {
    const demo = await listByPrefix<ChangeChain>('demo:');
    const records = demo.flatMap(({ value }) =>
      value.pullRequests.flatMap((pr) => pr.reviews.filter((r) => r.action === 'approved').map((r) => ({ reviewer: r.by, repo: pr.repo, pr: pr.id, at: r.at }))),
    );
    return { records, source: 'demo bank' };
  }
  const repos = [...new Set(chain.pullRequests.map((p) => p.repo))];
  const stored = (await Promise.all(repos.map((r) => getList<ReviewRecord>(K.reviews(r))))).flat();
  const graph = await reviewsFromGraph();
  return graph.records.length
    ? { records: [...graph.records, ...stored], source: 'Teamwork Graph and Bitbucket snapshots' }
    : { records: stored, source: 'Bitbucket snapshots' };
}

export async function whoMustApprove(key: string, prId?: string): Promise<WhoMustApprove> {
  const a = await assessIssue(key, { writeProperty: false });
  const config = await getConfig();
  const pr =
    a.verdict.pullRequests.find((p) => p.pr === prId) ??
    a.verdict.pullRequests.find((p) => p.verdict !== 'PASS' && p.state === 'OPEN') ??
    a.verdict.pullRequests.find((p) => p.verdict !== 'PASS') ??
    a.verdict.pullRequests[0];
  const conflicted = pr?.conflicted ?? [];
  const history = await reviewHistory(a.chain, a.source);
  const kindOf = async (ref: Ref) => a.chain.people[ref]?.kind ?? (a.source === 'live' ? ((await getUser(ref))?.accountType === 'app' ? 'agent' : 'human') : undefined);
  const kinds: Record<Ref, string | undefined> = {};
  for (const r of new Set(history.records.map((h) => h.reviewer))) kinds[r] = await kindOf(r);
  const now = new Date().toISOString();
  const repo = pr?.repo ?? a.chain.pullRequests[0]?.repo ?? '';
  const raw = suggestReviewers({
    history: history.records,
    repo,
    exclude: conflicted.map((c) => c.ref),
    kindOf: (r) => kinds[r] as never,
    now: a.source === 'demo' ? '2026-10-28T09:00:00Z' : now,
    lookbackDays: config.reviewerLookbackDays,
  });
  const names: Record<Ref, string> = {};
  for (const s of raw) names[s.ref] = a.chain.people[s.ref]?.name ?? (await getUser(s.ref))?.displayName ?? s.ref;
  return {
    workItem: key,
    verdict: a.verdict.verdict,
    rule: a.verdict.rule,
    pullRequest: pr?.pr ?? null,
    mustNotApprove: conflicted.map((c) => ({ ref: c.ref, name: nameOf(a.chain, c.ref), why: describeRoles(a.chain, c) })),
    suggestions: raw.map((s) => ({ ...s, name: names[s.ref] })),
    historySource: history.source,
    explanation: a.explanation.lines,
  };
}

/** Every chain with production deployments: the demo bank and live work items. */
export async function populationChains(): Promise<ChangeChain[]> {
  const config = await getConfig();
  const demo = (await listByPrefix<ChangeChain>('demo:')).map((x) => x.value);
  const liveKeys = (await listByPrefix<unknown[]>('deploys:')).filter((x) => x.value.length).map((x) => x.key.slice('deploys:'.length));
  const demoKeys = new Set(demo.map((c) => c.workItem.key));
  const live = await Promise.all(liveKeys.filter((k) => !demoKeys.has(k)).map((k) => liveChain(k, config)));
  return [...demo, ...live];
}

export async function populationTest(from: string, to: string): Promise<PopulationResult> {
  const config = await getConfig();
  return runPopulationTest(await populationChains(), from, to, config.policy);
}

/** The default test period: the demo quarter when the demo bank is loaded, otherwise the last full quarter. */
export async function defaultPeriod(): Promise<{ from: string; to: string }> {
  if (await getDemoIndex()) return { from: '2026-07-01T00:00:00Z', to: '2026-10-01T00:00:00Z' };
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3);
  const to = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 3, 1));
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Opens one work item per exception for the control owner, and returns their links. */
export async function raiseExceptions(result: PopulationResult, projectKey: string): Promise<Record<string, string>> {
  const project = await getProject(projectKey);
  const type = project.issueTypes?.find((t) => !t.subtask && /task/i.test(t.name)) ?? project.issueTypes?.find((t) => !t.subtask);
  const base = await siteUrl();
  const raised = await getList<{ id: string; key: string }>('exceptions');
  const links: Record<string, string> = {};
  for (const e of result.exceptions) {
    const id = `${e.deployment}|${e.workItem}|${result.evidenceSetHash.slice(0, 12)}`;
    const existing = raised.find((r) => r.id === id);
    if (existing) {
      links[`${e.deployment}|${e.workItem}`] = `${base}/browse/${existing.key}`;
      continue;
    }
    const rule = e.rule ? RULES[e.rule] : null;
    const text = [
      `Deployment ${e.deployment} of ${e.workItem} on ${e.at.slice(0, 10)} returned ${e.verdict.replace('_', ' ')}${rule ? ` under ${rule.id} (${rule.title})` : ''}.`,
      rule ? rule.statement : '',
      `Evidence hash ${e.evidenceHash}. Population test evidence set ${result.evidenceSetHash}.`,
    ].filter(Boolean);
    const created = await createIssue({
      project: { key: projectKey },
      issuetype: type ? { id: type.id } : { name: 'Task' },
      summary: `Change independence exception: ${e.workItem} (${e.rule ?? e.verdict})`,
      labels: ['arms-length-exception'],
      description: { type: 'doc', version: 1, content: text.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) },
    });
    await appendUnique('exceptions', { id, key: created.key }, (a, b) => a.id === b.id);
    links[`${e.deployment}|${e.workItem}`] = `${base}/browse/${created.key}`;
  }
  return links;
}

export async function listSpaces(): Promise<{ id: string; key: string; name: string }[]> {
  const res = await api.asUser().requestConfluence(route`/wiki/api/v2/spaces?limit=50&type=global`);
  if (!res.ok) throw new Error(`Confluence spaces could not be listed (${res.status}). Is Confluence on this site?`);
  return ((await res.json()) as { results: { id: string; key: string; name: string }[] }).results;
}

/** Publishes the workpaper as a Confluence page created by the person running the test. */
export async function publishWorkpaper(result: PopulationResult, spaceId: string, links: Record<string, string>, preparedBy: string): Promise<string> {
  const base = await siteUrl();
  const wp = buildWorkpaper(result, { site: new URL(base).host, preparedBy, preparedAt: new Date().toISOString(), exceptionLinks: links });
  const post = (title: string) =>
    api.asUser().requestConfluence(route`/wiki/api/v2/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spaceId, status: 'current', title, body: { representation: 'storage', value: wp.storage } }),
    });
  let res = await post(wp.title);
  if (res.status === 400 || res.status === 409) res = await post(`${wp.title} (${result.evidenceSetHash.slice(0, 8)})`);
  if (!res.ok) throw new Error(`The workpaper could not be published (${res.status}).`);
  const page = (await res.json()) as { id: string; _links?: { webui?: string; base?: string } };
  return page._links?.webui ? `${page._links.base ?? `${base}/wiki`}${page._links.webui}` : `${base}/wiki/pages/viewpage.action?pageId=${page.id}`;
}

/** Records who directs agent work. The principal is the caller, never an input. */
export async function declareAgentWork(caller: Ref, key: string, branch?: string, agentLabel?: string) {
  const issue = await getIssue(key);
  const declaration = { at: new Date().toISOString(), principal: caller, ...(branch ? { branch } : {}), ...(agentLabel ? { agentLabel } : {}) };
  await appendUnique(K.declarations(issue.key), declaration, (a, b) => a.principal === b.principal && (a.branch ?? '') === (b.branch ?? ''));
  const who = await whoMustApprove(issue.key);
  return { recorded: declaration, who };
}

/** Posts a drafted management response, only when every fact in it is in the evidence. */
export async function postManagementResponse(key: string, text: string): Promise<{ posted: boolean; guard: GuardResult; commentId?: string }> {
  const a = await assessIssue(key, { writeProperty: false });
  // The reviewers the app itself proposes may be named too, with their review counts.
  const who = await whoMustApprove(key);
  const guard = checkDraft(
    text,
    allowedFromEvidence(a.chain, a.verdict, { names: who.suggestions.map((s) => s.name), numbers: who.suggestions.map((s) => s.reviews) }),
  );
  if (!guard.ok) return { posted: false, guard };
  const comment = await addComment(key, ["Management response (checked by Arm's Length against the change evidence):", ...text.split(/\n{2,}/)]);
  return { posted: true, guard, commentId: comment.id };
}
