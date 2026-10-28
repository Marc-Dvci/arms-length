import { evaluate } from './evaluate';
import { canonicalJson, sha256 } from './evidence';
import { nameOf } from './explain';
import { DEFAULT_POLICY, RULES_VERSION } from './rules';
import type { ChangeChain, Policy, RuleId, VerdictValue } from './types';

export interface PopulationRow {
  deployment: string;
  at: string;
  env: string;
  commit: string;
  workItem: string;
  pr: string | null;
  verdict: VerdictValue;
  rule: RuleId | null;
  approvers: string[];
  evidenceHash: string;
}

export interface PopulationResult {
  period: { from: string; to: string };
  rulesVersion: string;
  policy: Policy;
  rows: PopulationRow[];
  summary: { deployments: number; workItems: number; pass: number; fail: number; cannotDetermine: number };
  exceptions: PopulationRow[];
  evidenceSetHash: string;
}

/**
 * The quarter-end control test: every production deployment in the period, each with the
 * verdict of the work item it shipped. `from` is inclusive and `to` exclusive.
 */
export function runPopulationTest(chains: ChangeChain[], from: string, to: string, policy: Policy = DEFAULT_POLICY): PopulationResult {
  const lo = Date.parse(from);
  const hi = Date.parse(to);
  const rows: PopulationRow[] = [];
  for (const chain of chains) {
    const inPeriod = chain.deployments.filter(
      (d) => policy.productionEnvironments.includes(d.env) && Date.parse(d.at) >= lo && Date.parse(d.at) < hi,
    );
    if (!inPeriod.length) continue;
    const v = evaluate(chain, policy);
    for (const d of inPeriod) {
      const a = v.deployments.find((x) => x.id === d.id)!;
      const pr = a.pr ? v.pullRequests.find((p) => p.pr === a.pr) : undefined;
      rows.push({
        deployment: d.id,
        at: d.at,
        env: d.env,
        commit: d.commit,
        workItem: chain.workItem.key,
        pr: a.pr,
        // A deployment inherits the work item's failure when its own pull request passed but another rule broke.
        verdict: a.verdict === 'PASS' ? v.verdict : a.verdict,
        rule: a.verdict === 'PASS' ? v.rule : a.rule,
        approvers: (pr?.counted ?? []).map((c) => nameOf(chain, c.ref)),
        evidenceHash: v.evidenceHash,
      });
    }
  }
  rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.deployment < b.deployment ? -1 : 1));
  const exceptions = rows.filter((r) => r.verdict !== 'PASS');
  const evidenceSetHash = sha256(
    canonicalJson({
      rulesVersion: RULES_VERSION,
      policy,
      period: { from, to },
      rows: rows.map((r) => ({ deployment: r.deployment, workItem: r.workItem, verdict: r.verdict, rule: r.rule, evidenceHash: r.evidenceHash })),
    }),
  );
  return {
    period: { from, to },
    rulesVersion: RULES_VERSION,
    policy,
    rows,
    summary: {
      deployments: new Set(rows.map((r) => r.deployment)).size,
      workItems: new Set(rows.map((r) => r.workItem)).size,
      pass: rows.filter((r) => r.verdict === 'PASS').length,
      fail: rows.filter((r) => r.verdict === 'FAIL').length,
      cannotDetermine: rows.filter((r) => r.verdict === 'CANNOT_DETERMINE').length,
    },
    exceptions,
    evidenceSetHash,
  };
}
