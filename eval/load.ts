import { readFileSync } from 'node:fs';
import type { ChangeChain, Flag, Person, RuleId, VerdictValue } from '../src/core/types';

export interface LabelledCase {
  id: string;
  title: string;
  expected: { verdict: VerdictValue; rule: RuleId | null; flags: Flag[] };
  chain: ChangeChain;
}

interface CaseFile {
  set: string;
  policy: string;
  cast: Record<string, Person>;
  cases: { id: string; title: string; expected: LabelledCase['expected']; chain: Partial<ChangeChain> & Pick<ChangeChain, 'workItem'> }[];
}

/** Reads a case file and fills each chain's defaults (shared cast, empty lists, complete history). */
export function loadCases(path: string): { set: string; cases: LabelledCase[] } {
  const file = JSON.parse(readFileSync(path, 'utf8')) as CaseFile;
  return {
    set: file.set,
    cases: file.cases.map((c) => ({
      id: c.id,
      title: c.title,
      expected: { verdict: c.expected.verdict, rule: c.expected.rule ?? null, flags: c.expected.flags ?? [] },
      chain: {
        workItem: c.chain.workItem,
        people: { ...file.cast, ...(c.chain.people ?? {}) },
        assignments: c.chain.assignments ?? [],
        declarations: c.chain.declarations ?? [],
        automationRules: c.chain.automationRules ?? {},
        pullRequests: (c.chain.pullRequests ?? []).map((pr) => ({ ...pr, commits: pr.commits ?? [], reviews: pr.reviews ?? [] })),
        deployments: c.chain.deployments ?? [],
        emergency: c.chain.emergency ?? null,
        history: { jira: 'complete', scm: 'complete', ...(c.chain.history ?? {}) },
      },
    })),
  };
}
