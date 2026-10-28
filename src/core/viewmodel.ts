import { describeRoles, explain, explainPullRequest, listNames, nameOf } from './explain';
import { RULES } from './rules';
import type { ChangeChain, IgnoredReason, Ref, Verdict, VerdictValue } from './types';

export interface PersonView {
  ref: Ref;
  name: string;
  /** True when the reference is an Atlassian account the UI can render as a user. */
  account: boolean;
  agent: boolean;
}

export type ApprovalStatus = 'counts' | IgnoredReason;

export interface PanelView {
  workItem: string;
  source: 'demo' | 'live';
  verdict: VerdictValue;
  verdictLabel: string;
  rule: string | null;
  ruleTitle: string | null;
  headline: string;
  lines: string[];
  flags: string[];
  chain: { step: string; people: PersonView[]; note?: string }[];
  pullRequests: {
    id: string;
    url?: string;
    state: string;
    verdict: VerdictValue;
    rule: string | null;
    line: string;
    approvals: { person: PersonView; status: ApprovalStatus; at: string; retro: boolean }[];
    mustNotApprove: { person: PersonView; why: string }[];
  }[];
  deployments: { id: string; env: string; at: string; verdict: VerdictValue; pr: string | null }[];
  findings: { rule: string; title: string; outcome: string; message: string; references: string[] }[];
  evidenceHash: string;
  rulesVersion: string;
  policyVersion: string;
}

export const verdictLabel = (v: VerdictValue) => (v === 'CANNOT_DETERMINE' ? 'CANNOT DETERMINE' : v);

const isAccount = (ref: Ref) => !/^(u|a|b|s|x|raw|bb):/.test(ref);

export function panelView(chain: ChangeChain, v: Verdict, source: 'demo' | 'live'): PanelView {
  const person = (ref: Ref): PersonView => {
    const p = chain.people[ref];
    const agentRef = p && p.kind !== 'human' ? (p.actsAs ?? ref) : null;
    return { ref, name: agentRef && agentRef !== ref ? `${nameOf(chain, agentRef)} (${nameOf(chain, ref)})` : nameOf(chain, ref), account: isAccount(ref), agent: !!agentRef };
  };
  const unique = (refs: Ref[]) => [...new Set(refs)].map(person);
  const ex = explain(chain, v);
  const active = chain.pullRequests.filter((p) => p.state !== 'DECLINED');

  const chainSteps: PanelView['chain'] = [];
  if (chain.workItem.requester) chainSteps.push({ step: 'Requested', people: [person(chain.workItem.requester)] });
  const directed = v.pullRequests.flatMap((p) => Object.entries(p.principals).flatMap(([agent, refs]) => refs.map((r) => ({ r, agent }))));
  if (directed.length) {
    const byPerson = new Map<Ref, Set<Ref>>();
    for (const d of directed) byPerson.set(d.r, (byPerson.get(d.r) ?? new Set()).add(d.agent));
    chainSteps.push({
      step: 'Directed the agent',
      people: [...byPerson.keys()].map(person),
      note: [...byPerson.entries()].map(([r, agents]) => `${nameOf(chain, r)} directed ${listNames([...agents].map((a) => nameOf(chain, a)))}`).join('; '),
    });
  }
  const writers = active.flatMap((p) => [p.author, ...p.commits.map((c) => c.author)]);
  if (writers.length) chainSteps.push({ step: 'Wrote the change', people: unique(writers) });
  const approvers = v.pullRequests.flatMap((p) => [...p.counted.map((c) => c.ref), ...p.ignored.map((i) => i.ref)]);
  chainSteps.push({ step: 'Approved', people: unique(approvers), note: approvers.length ? undefined : 'No approval yet' });
  const deployers = chain.deployments.filter((d) => v.deployments.some((x) => x.id === d.id)).map((d) => d.triggeredBy).filter((r): r is Ref => !!r && r !== 'pipeline');
  if (v.deployments.length) chainSteps.push({ step: 'Deployed to production', people: unique(deployers), note: deployers.length ? undefined : 'By the release pipeline' });

  return {
    workItem: v.workItem,
    source,
    verdict: v.verdict,
    verdictLabel: verdictLabel(v.verdict),
    rule: v.rule,
    ruleTitle: v.rule ? RULES[v.rule].title : null,
    headline: ex.headline,
    lines: ex.lines,
    flags: v.flags,
    chain: chainSteps,
    pullRequests: v.pullRequests.map((p) => {
      const pr = chain.pullRequests.find((x) => x.id === p.pr);
      return {
        id: p.pr,
        url: pr?.url,
        state: p.state,
        verdict: p.verdict,
        rule: p.rule,
        line: explainPullRequest(chain, p),
        approvals: [
          ...p.counted.map((c) => ({ person: person(c.ref), status: 'counts' as const, at: c.at, retro: c.retro })),
          ...p.ignored.map((i) => ({ person: person(i.ref), status: i.reason, at: i.at, retro: false })),
        ].sort((a, b) => (a.at < b.at ? -1 : 1)),
        mustNotApprove: p.conflicted.map((c) => ({ person: person(c.ref), why: describeRoles(chain, c) })),
      };
    }),
    deployments: v.deployments.map((d) => ({ id: d.id, env: d.env, at: d.at, verdict: d.verdict, pr: d.pr })),
    findings: v.findings.map((f) => ({
      rule: f.rule,
      title: RULES[f.rule].title,
      outcome: verdictLabel(f.outcome),
      message: f.message,
      references: RULES[f.rule].references.map((r) => `${r.source}, ${r.clause}`),
    })),
    evidenceHash: v.evidenceHash,
    rulesVersion: v.rulesVersion,
    policyVersion: v.policyVersion,
  };
}
