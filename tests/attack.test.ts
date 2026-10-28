import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/evaluate';
import type { ChangeChain } from '../src/core/types';
import { allCases, clone, INJECTIONS, inject, rng, shuffle } from './helpers';

const essentials = (c: ChangeChain) => {
  const v = evaluate(c);
  return { verdict: v.verdict, rule: v.rule, flags: v.flags, evidenceHash: v.evidenceHash };
};

describe('free text never changes a verdict', () => {
  it.each(INJECTIONS)('injection %#', (text) => {
    for (const c of allCases) expect(essentials(inject(c.chain, text)), c.id).toEqual(essentials(c.chain));
  });
});

describe('order and display names never change a verdict', () => {
  it('shuffling reviews, assignments, declarations, deployments and pull requests', () => {
    const rand = rng(20261028);
    for (let round = 0; round < 20; round++) {
      for (const c of allCases) {
        const m = clone(c.chain);
        m.assignments = shuffle(m.assignments, rand);
        m.declarations = shuffle(m.declarations, rand);
        m.deployments = shuffle(m.deployments, rand);
        m.pullRequests = shuffle(m.pullRequests, rand).map((pr) => ({ ...pr, reviews: shuffle(pr.reviews, rand) }));
        expect(essentials(m), c.id).toEqual(essentials(c.chain));
      }
    }
  });

  it('giving every person the same display name', () => {
    for (const c of allCases) {
      const m = clone(c.chain);
      for (const p of Object.values(m.people)) p.name = 'Alex Doe';
      expect(essentials(m), c.id).toEqual(essentials(c.chain));
    }
  });
});

describe('the verdict responds to the evidence that matters', () => {
  it('adding a current, independent, pre-merge approval turns every AL-1 failure into a pass', () => {
    const cases = allCases.filter((x) => x.expected.rule === 'AL-1');
    expect(cases.length).toBeGreaterThan(10);
    for (const c of cases) {
      const m = clone(c.chain);
      m.people['u:auditor'] = { name: 'Independent Reviewer', kind: 'human' };
      for (const pr of m.pullRequests.filter((p) => p.state !== 'DECLINED')) {
        const head = pr.commits.at(-1)!.hash;
        const at = pr.mergedAt ? new Date(Date.parse(pr.mergedAt) - 60_000).toISOString() : pr.createdAt;
        pr.reviews.push({ by: 'u:auditor', action: 'approved', at, commit: head });
      }
      expect(evaluate(m).verdict, c.id).toBe('PASS');
    }
  });

  it('removing the counted approvals turns every pass into a failure', () => {
    for (const c of allCases.filter((x) => x.expected.verdict === 'PASS')) {
      const v = evaluate(c.chain);
      const m = clone(c.chain);
      for (const pr of v.pullRequests) {
        const target = m.pullRequests.find((p) => p.id === pr.pr)!;
        const counted = new Set(pr.counted.map((x) => x.ref));
        target.reviews = target.reviews.filter((r) => !counted.has(r.by));
      }
      expect(evaluate(m).verdict, c.id).toBe('FAIL');
    }
  });

  it('making the independent approver a principal fails every change that contains agent work', () => {
    for (const c of allCases.filter((x) => x.expected.verdict === 'PASS')) {
      const v = evaluate(c.chain);
      const m = clone(c.chain);
      for (const ref of new Set(v.pullRequests.flatMap((p) => p.counted.map((x) => x.ref)))) {
        m.declarations.push({ at: '2026-01-01T00:00Z', principal: ref });
      }
      const agentWork = v.pullRequests.every((p) => p.agents.length > 0);
      if (agentWork) expect(evaluate(m).verdict, c.id).toBe('FAIL');
      else expect(evaluate(m).verdict, c.id).not.toBe('CANNOT_DETERMINE');
    }
  });

  it('a commit pushed after the approvals makes them stale', () => {
    for (const c of allCases.filter((x) => x.expected.verdict === 'PASS')) {
      const m = clone(c.chain);
      for (const pr of m.pullRequests.filter((p) => p.state !== 'DECLINED')) {
        pr.commits.push({ hash: `${pr.id}-late`, author: pr.author, at: pr.mergedAt ?? pr.createdAt });
      }
      const v = evaluate(m);
      expect(v.verdict, c.id).toBe('FAIL');
      expect(v.rule, c.id).toBe('AL-2');
    }
  });

  it('losing the repository history never yields a pass', () => {
    for (const c of allCases) {
      const m = clone(c.chain);
      m.history.scm = 'missing';
      expect(evaluate(m).verdict, c.id).not.toBe('PASS');
    }
  });

  it('losing the Jira history never turns a failure or an unknown into a pass', () => {
    for (const c of allCases.filter((x) => x.expected.verdict !== 'PASS')) {
      const m = clone(c.chain);
      m.history.jira = 'missing';
      expect(evaluate(m).verdict, c.id).not.toBe('PASS');
    }
  });

  it('is deterministic', () => {
    for (const c of allCases) expect(evaluate(c.chain)).toEqual(evaluate(clone(c.chain)));
  });
});
