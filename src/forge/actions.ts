import { RULES } from '../core/rules';
import type { Ref } from '../core/types';
import { assessIssue } from './chain';
import { declareAgentWork, defaultPeriod, populationTest, postManagementResponse, whoMustApprove } from './services';

/**
 * Rovo actions and MCP tools. Inputs arrive as top-level payload keys. The caller's identity
 * comes from the invocation context and is never read from the inputs.
 */
type ActionPayload = Record<string, unknown> & {
  context?: { accountId?: string; principal?: { accountId?: string }; jira?: { issueKey?: string } };
};
type InvocationContext = { principal?: { accountId?: string }; accountId?: string } | undefined;

export function callerOf(payload: ActionPayload, context: InvocationContext): Ref | null {
  return context?.principal?.accountId ?? context?.accountId ?? payload.context?.principal?.accountId ?? payload.context?.accountId ?? null;
}

function workItemOf(payload: ActionPayload): string {
  const raw = String(payload.workItem ?? payload.workItemKey ?? payload.context?.jira?.issueKey ?? '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,9}-\d+$/.test(raw)) throw new Error('Give a Jira work item key such as PAY-482.');
  return raw;
}

const safely =
  <A extends unknown[]>(fn: (...a: A) => Promise<unknown>) =>
  async (...a: A) => {
    try {
      return await fn(...a);
    } catch (e) {
      return { error: (e as Error).message };
    }
  };

/** MCP tool: the coding agent declares the person it works for before it opens a pull request. */
export const declareAgentWorkAction = safely(async (payload: ActionPayload, context: InvocationContext) => {
  const caller = callerOf(payload, context);
  if (!caller) return { error: 'The call carries no user identity, so no principal can be recorded.' };
  const branch = typeof payload.branch === 'string' && payload.branch.trim() ? payload.branch.trim() : undefined;
  const label = typeof payload.agent === 'string' && payload.agent.trim() ? payload.agent.trim().slice(0, 60) : undefined;
  const { recorded, who } = await declareAgentWork(caller, workItemOf(payload), branch, label);
  return {
    recorded: { workItem: who.workItem, principalAccountId: recorded.principal, branch: recorded.branch ?? 'every branch', at: recorded.at },
    note: 'The principal is the account that made this call. Its approval will not count for agent-written commits on this work item.',
    mustNotApprove: who.mustNotApprove,
    suggestedReviewers: who.suggestions,
  };
});

/** MCP tool and Rovo action: who may and may not approve a work item's pull request. */
export const whoMustApproveAction = safely(async (payload: ActionPayload) => {
  const who = await whoMustApprove(workItemOf(payload), typeof payload.pullRequest === 'string' ? payload.pullRequest : undefined);
  return {
    workItem: who.workItem,
    pullRequest: who.pullRequest,
    verdict: who.verdict,
    rule: who.rule,
    mustNotApprove: who.mustNotApprove,
    suggestedReviewers: who.suggestions.map((s) => ({ name: s.name, accountId: s.ref, reviewsInRepo: s.reviews, repo: s.repo, lastReview: s.lastAt })),
    reviewerHistorySource: who.historySource,
    explanation: who.explanation,
  };
});

/** MCP tool and Rovo action: the verdict, its rule and the evidence hash. */
export const changeEvidenceAction = safely(async (payload: ActionPayload) => {
  const a = await assessIssue(workItemOf(payload), { writeProperty: false });
  const rule = a.verdict.rule ? RULES[a.verdict.rule] : null;
  return {
    workItem: a.verdict.workItem,
    verdict: a.verdict.verdict,
    rule: rule ? { id: rule.id, title: rule.title, statement: rule.statement, references: rule.references } : null,
    flags: a.verdict.flags,
    headline: a.explanation.headline,
    explanation: a.explanation.lines,
    pullRequests: a.verdict.pullRequests.map((p) => ({
      id: p.pr,
      state: p.state,
      verdict: p.verdict,
      rule: p.rule,
      independentApprovers: p.counted.map((c) => a.chain.people[c.ref]?.name ?? c.ref),
      ignoredApprovals: p.ignored.map((i) => ({ name: a.chain.people[i.ref]?.name ?? i.ref, reason: i.reason })),
    })),
    productionDeployments: a.verdict.deployments,
    evidenceHash: a.verdict.evidenceHash,
    rulesVersion: a.verdict.rulesVersion,
    source: a.source,
  };
});

/** Rovo action: the population test for a period. */
export const populationTestAction = safely(async (payload: ActionPayload) => {
  const period = await defaultPeriod();
  const from = typeof payload.from === 'string' && payload.from ? new Date(payload.from).toISOString() : period.from;
  const to = typeof payload.to === 'string' && payload.to ? new Date(payload.to).toISOString() : period.to;
  const r = await populationTest(from, to);
  return {
    period: r.period,
    summary: r.summary,
    exceptions: r.exceptions.map((e) => ({ workItem: e.workItem, deployment: e.deployment, deployedAt: e.at, verdict: e.verdict, rule: e.rule })),
    evidenceSetHash: r.evidenceSetHash,
    rulesVersion: r.rulesVersion,
  };
});

/** Rovo action: posts a management response once the guard finds every fact in the evidence. */
export const managementResponseAction = safely(async (payload: ActionPayload) => {
  const text = String(payload.response ?? '').trim();
  if (text.length < 20) return { error: 'Give the full text of the management response.' };
  const out = await postManagementResponse(workItemOf(payload), text.slice(0, 4000));
  return out.posted
    ? { posted: true, commentId: out.commentId }
    : {
        posted: false,
        reason: 'The draft names facts that are not in the change evidence. Remove or correct them and try again.',
        problems: out.guard.problems,
      };
});
