import { decisionEvidence, evidenceHash } from './evidence';
import { DEFAULT_POLICY, FAIL_PRECEDENCE, RULES_VERSION, UNKNOWN_PRECEDENCE } from './rules';
import type {
  ChangeChain,
  ConflictedPerson,
  DeploymentAssessment,
  Finding,
  Flag,
  IgnoredReason,
  Policy,
  PrAssessment,
  Ref,
  Role,
  RuleId,
  Verdict,
  VerdictValue,
} from './types';

type Evidence = ReturnType<typeof decisionEvidence>;
type EvidencePr = Evidence['pullRequests'][number];

const HOUR_MS = 3_600_000;
const ms = (iso: string) => Date.parse(iso);

function pick(findings: Finding[]): { verdict: VerdictValue; rule: RuleId | null } {
  const fails = new Set(findings.filter((f) => f.outcome === 'FAIL').map((f) => f.rule));
  if (fails.size) return { verdict: 'FAIL', rule: FAIL_PRECEDENCE.find((r) => fails.has(r)) ?? null };
  const unknown = new Set(findings.filter((f) => f.outcome === 'CANNOT_DETERMINE').map((f) => f.rule));
  if (unknown.size) return { verdict: 'CANNOT_DETERMINE', rule: UNKNOWN_PRECEDENCE.find((r) => unknown.has(r)) ?? null };
  return { verdict: 'PASS', rule: null };
}

class Identities {
  constructor(private readonly people: Evidence['people']) {}
  kind(ref: Ref) {
    return this.people[ref]?.kind;
  }
  known(ref: Ref) {
    return ref in this.people;
  }
  isHuman(ref: Ref) {
    return this.kind(ref) === 'human';
  }
  /** The agent a non-human account stands for, or null for a person. */
  agentOf(ref: Ref): Ref | null {
    const p = this.people[ref];
    if (!p || p.kind === 'human') return null;
    return p.actsAs ?? ref;
  }
}

function assessPullRequest(ev: Evidence, pr: EvidencePr, ids: Identities, policy: Policy): PrAssessment {
  const findings: Finding[] = [];
  const base = { pr: pr.id, repo: pr.repo, state: pr.state as PrAssessment['state'] };
  const empty = { agents: [], principals: {}, conflicted: [], counted: [], ignored: [], flags: [] as Flag[] };

  if (ev.history.scm === 'missing') {
    findings.push({ rule: 'AL-5', outcome: 'CANNOT_DETERMINE', pr: pr.id, message: 'Repository history is unavailable.' });
    return { ...base, ...empty, head: null, findings, ...pick(findings) };
  }
  const head = pr.commits.at(-1)?.hash ?? null;
  if (!head) {
    findings.push({ rule: 'AL-5', outcome: 'CANNOT_DETERMINE', pr: pr.id, message: 'The pull request has no commits on record.' });
    return { ...base, ...empty, head: null, findings, ...pick(findings) };
  }

  const actors = [pr.author, ...pr.commits.map((c) => c.author), ...pr.reviews.map((r) => r.by)];
  const unresolved = [...new Set(actors.filter((ref) => !ids.known(ref)))];
  if (unresolved.length) {
    findings.push({
      rule: 'AL-5',
      outcome: 'CANNOT_DETERMINE',
      pr: pr.id,
      people: unresolved,
      message: 'Some accounts on the pull request could not be resolved.',
    });
  }

  // Agents whose work is in this pull request.
  const agents = [...new Set([pr.author, ...pr.commits.map((c) => c.author)].map((r) => ids.agentOf(r)).filter((r): r is Ref => !!r))];

  // Principals: who directed each agent.
  const principals: Record<Ref, Ref[]> = {};
  const unknownPrincipal = new Set<Ref>();
  for (const agent of agents) principals[agent] = [];
  if (agents.length) {
    if (ev.history.jira === 'missing') {
      findings.push({
        rule: 'AL-5',
        outcome: 'CANNOT_DETERMINE',
        pr: pr.id,
        people: agents,
        message: 'Jira history is unavailable, so who assigned the agents is unknown.',
      });
    }
    for (const a of ev.assignments) {
      const agent = ids.agentOf(a.to);
      if (!agent || !(agent in principals)) continue;
      const rule = a.via?.automationRule;
      if (rule || ids.kind(a.by) === 'automation') {
        const owner = rule ? ev.automationRules[rule]?.owner : null;
        if (owner) principals[agent].push(owner);
        else unknownPrincipal.add(agent);
      } else if (ids.isHuman(a.by)) {
        principals[agent].push(a.by);
      } else {
        unknownPrincipal.add(agent);
      }
    }
    for (const d of ev.declarations) {
      if (d.branch && d.branch !== pr.sourceBranch) continue;
      for (const agent of agents) principals[agent].push(d.principal);
    }
    for (const agent of agents) {
      principals[agent] = [...new Set(principals[agent])];
      if (ev.history.jira === 'complete' && (unknownPrincipal.has(agent) || principals[agent].length === 0)) {
        findings.push({
          rule: 'AL-4',
          outcome: 'CANNOT_DETERMINE',
          pr: pr.id,
          people: [agent],
          message: unknownPrincipal.has(agent)
            ? 'An automation rule assigned the agent and the rule owner is unknown.'
            : 'Nobody is on record as having directed the agent.',
        });
      }
    }
  }

  // Conflicted people and their roles.
  const roles = new Map<Ref, { roles: Set<Role>; directed: Set<Ref> }>();
  const mark = (ref: Ref, role: Role, agent?: Ref) => {
    const entry = roles.get(ref) ?? { roles: new Set<Role>(), directed: new Set<Ref>() };
    entry.roles.add(role);
    if (agent) entry.directed.add(agent);
    roles.set(ref, entry);
  };
  if (ev.workItem.requester) mark(ev.workItem.requester, 'requester');
  else findings.push({ rule: 'AL-5', outcome: 'CANNOT_DETERMINE', pr: pr.id, message: 'The requester of the work item is unknown.' });
  for (const ref of [pr.author, ...pr.commits.map((c) => c.author)]) if (ids.isHuman(ref)) mark(ref, 'implementer');
  for (const [agent, refs] of Object.entries(principals)) for (const ref of refs) mark(ref, 'principal', agent);
  const conflicted: ConflictedPerson[] = [...roles.entries()].map(([ref, e]) => ({
    ref,
    roles: [...e.roles],
    directed: [...e.directed],
  }));

  // Current approval of each reviewer: the last review action decides.
  const current = new Map<Ref, { at: string; commit: string } | null>();
  for (const r of pr.reviews) current.set(r.by, r.action === 'approved' ? { at: r.at, commit: r.commit } : null);

  const counted: PrAssessment['counted'] = [];
  const ignored: PrAssessment['ignored'] = [];
  const merged = pr.state === 'MERGED' && pr.mergedAt ? ms(pr.mergedAt) : null;
  const emergency = !!ev.emergency;
  for (const [ref, approval] of current) {
    if (!approval) continue;
    const ignore = (reason: IgnoredReason) => ignored.push({ ref, at: approval.at, reason });
    if (!ids.isHuman(ref)) { ignore('non_human'); continue; }
    if (roles.has(ref)) { ignore('conflicted'); continue; }
    const after = merged !== null && ms(approval.at) > merged;
    if (after && !(emergency && ms(approval.at) - merged <= policy.emergencyWindowHours * HOUR_MS)) { ignore('after_merge'); continue; }
    if (approval.commit !== head) { ignore('stale'); continue; }
    counted.push({ ref, at: approval.at, retro: after });
  }

  if (!counted.length) {
    const reasons = new Set(ignored.map((i) => i.reason));
    const candidates = new Set<RuleId>(['AL-1']);
    if (reasons.has('stale')) candidates.add('AL-2');
    if (reasons.has('after_merge')) candidates.add('AL-6');
    if (reasons.has('non_human')) candidates.add('AL-3');
    const rule = FAIL_PRECEDENCE.find((r) => candidates.has(r))!;
    const messages: Record<string, string> = {
      'AL-1': 'No approval from anyone outside the people who requested, wrote or directed the change.',
      'AL-2': 'The independent approval was given on an earlier commit than the one merged.',
      'AL-3': 'The only approval from outside the chain came from a non-human account.',
      'AL-6': emergency
        ? 'The independent approval came after the merge, outside the emergency window.'
        : 'The independent approval came after the merge, and no emergency was declared.',
    };
    findings.push({ rule, outcome: 'FAIL', pr: pr.id, people: conflicted.map((c) => c.ref), message: messages[rule] });
  }

  const flags: Flag[] = counted.length && counted.every((c) => c.retro) ? ['RETRO_APPROVAL'] : [];
  return { ...base, head, agents, principals, conflicted, counted, ignored, findings, flags, ...pick(findings) };
}

/** Evaluates a change chain against the independence policy. Pure and deterministic. */
export function evaluate(chain: ChangeChain, policy: Policy = DEFAULT_POLICY): Verdict {
  const ev = decisionEvidence(chain);
  const ids = new Identities(ev.people);
  const active = ev.pullRequests.filter((pr) => pr.state !== 'DECLINED');
  const prs = active.map((pr) => assessPullRequest(ev, pr, ids, policy));
  const findings: Finding[] = prs.flatMap((p) => p.findings);

  const production = ev.deployments.filter((d) => policy.productionEnvironments.includes(d.env));
  const deployments: DeploymentAssessment[] = production.map((d) => {
    const source = ev.pullRequests.find(
      (pr) => pr.state === 'MERGED' && (pr.mergeCommit === d.commit || pr.commits.some((c) => c.hash === d.commit)),
    );
    const assessed = source ? prs.find((p) => p.pr === source.id) : undefined;
    if (assessed) return { ...d, pr: assessed.pr, verdict: assessed.verdict, rule: assessed.rule };
    const finding: Finding =
      ev.history.scm === 'missing'
        ? { rule: 'AL-5', outcome: 'CANNOT_DETERMINE', deployment: d.id, message: 'Repository history is unavailable, so the deployed commit cannot be traced.' }
        : { rule: 'AL-7', outcome: 'FAIL', deployment: d.id, message: 'The deployed commit is not part of any merged pull request of the work item.' };
    findings.push(finding);
    return { ...d, pr: null, verdict: finding.outcome, rule: finding.rule };
  });

  if (!active.length && !production.length) {
    findings.push({ rule: 'AL-8', outcome: 'CANNOT_DETERMINE', message: 'No pull request is linked to the work item.' });
  }

  const flags = [...new Set(prs.filter((p) => p.verdict === 'PASS').flatMap((p) => p.flags))];
  return {
    workItem: ev.workItem.key,
    ...pick(findings),
    flags,
    findings,
    pullRequests: prs,
    deployments: deployments.map(({ id, env, at, commit, pr, verdict, rule }) => ({ id, env, at, commit, pr, verdict, rule })),
    rulesVersion: RULES_VERSION,
    policyVersion: policy.version,
    evidenceHash: evidenceHash(chain, policy, RULES_VERSION),
  };
}
