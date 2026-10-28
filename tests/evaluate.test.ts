import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/evaluate';
import { RULES } from '../src/core/rules';
import { clone, heldout, labelled } from './helpers';

describe.each([
  ['labelled', labelled],
  ['heldout', heldout],
])('%s set', (_name, cases) => {
  it.each(cases.map((c) => [c.id, c.title, c] as const))('%s %s', (_id, _title, c) => {
    const v = evaluate(c.chain);
    expect({ verdict: v.verdict, rule: v.rule, flags: v.flags }).toEqual(c.expected);
  });
});

describe('verdict structure', () => {
  const scene = labelled.find((c) => c.id === 'D03')!;

  it('names the principal and the role of each conflicted person', () => {
    const pr = evaluate(scene.chain).pullRequests[0];
    expect(pr.principals).toEqual({ 'a:coder': ['u:lea'] });
    const lea = pr.conflicted.find((c) => c.ref === 'u:lea')!;
    expect([...lea.roles].sort()).toEqual(['principal', 'requester']);
    expect(lea.directed).toEqual(['a:coder']);
    expect(pr.ignored).toEqual([{ ref: 'u:lea', at: '2026-09-03T18:12Z', reason: 'conflicted' }]);
  });

  it('links each production deployment to the pull request it ran', () => {
    expect(evaluate(scene.chain).deployments).toEqual([
      { id: 'dep-482', env: 'production', at: '2026-09-03T18:30Z', commit: 'm482', pr: 'payments-core#482', verdict: 'FAIL', rule: 'AL-1' },
    ]);
  });

  it('every finding cites a rule of the table with its outcome', () => {
    for (const c of [...labelled, ...heldout]) {
      for (const f of evaluate(c.chain).findings) {
        expect(RULES[f.rule]).toBeDefined();
        expect(f.outcome).toBe(RULES[f.rule].outcome);
      }
    }
  });

  it('every rule carries at least one regulatory reference', () => {
    for (const rule of Object.values(RULES)) expect(rule.references.length).toBeGreaterThan(0);
  });

  it('reports a 64-character evidence hash and the rule version', () => {
    const v = evaluate(scene.chain);
    expect(v.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(v.rulesVersion).toMatch(/^\d{4}\.\d+\.\d+$/);
  });

  it('treats an account it cannot resolve as missing evidence', () => {
    const c = clone(labelled.find((x) => x.id === 'D02')!.chain);
    c.pullRequests[0].reviews[0].by = 'u:ghost';
    const v = evaluate(c);
    expect(v.verdict).toBe('FAIL');
    expect(v.findings.some((f) => f.rule === 'AL-5' && f.people?.includes('u:ghost'))).toBe(true);
  });

  it('honours a custom emergency window', () => {
    const c = labelled.find((x) => x.id === 'D21')!.chain;
    const strict = evaluate(c, { version: 'strict', emergencyWindowHours: 8, productionEnvironments: ['production'] });
    expect(strict.verdict).toBe('FAIL');
    expect(strict.rule).toBe('AL-6');
  });

  it('honours custom production environment names', () => {
    const c = clone(labelled.find((x) => x.id === 'D26')!.chain);
    for (const d of c.deployments) d.env = 'prod-eu';
    expect(evaluate(c).verdict).toBe('PASS');
    expect(evaluate(c, { version: 'eu', emergencyWindowHours: 72, productionEnvironments: ['prod-eu'] }).rule).toBe('AL-7');
  });
});
