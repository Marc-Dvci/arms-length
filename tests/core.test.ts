import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/core/evaluate';
import { explain, gateMessage } from '../src/core/explain';
import { allowedFromEvidence, checkDraft } from '../src/core/guard';
import { runPopulationTest } from '../src/core/population';
import { suggestReviewers, type ReviewRecord } from '../src/core/reviewers';
import { isWebTriggerUrl } from '../src/core/signature';
import { buildWorkpaper } from '../src/core/workpaper';
import { buildDemoBank, DEMO_EXPECTED, DEMO_OPEN_ITEM, DEMO_PEOPLE, DEMO_QUARTER } from '../src/demo/bank';
import { labelled } from './helpers';

const bank = buildDemoBank();
const scene = bank.find((c) => c.workItem.key === DEMO_OPEN_ITEM)!;

describe('demo bank', () => {
  it('has unique work item keys and every chain evaluates as labelled', () => {
    expect(new Set(bank.map((c) => c.workItem.key)).size).toBe(bank.length);
    for (const c of bank) {
      const v = evaluate(c);
      const expected = DEMO_EXPECTED[c.workItem.key] ?? { verdict: 'PASS', rule: null };
      expect({ verdict: v.verdict, rule: v.rule }, c.workItem.key).toEqual({ verdict: expected.verdict, rule: expected.rule });
      expect(v.flags, c.workItem.key).toEqual(expected.flags ?? []);
    }
  });

  it('is identical on every build', () => {
    expect(runPopulationTest(buildDemoBank(), DEMO_QUARTER.from, DEMO_QUARTER.to).evidenceSetHash).toBe(
      runPopulationTest(bank, DEMO_QUARTER.from, DEMO_QUARTER.to).evidenceSetHash,
    );
  });
});

describe('population test', () => {
  const result = runPopulationTest(bank, DEMO_QUARTER.from, DEMO_QUARTER.to);

  it('covers every production deployment in the quarter and only those', () => {
    const expected = bank.flatMap((c) =>
      c.deployments.filter((d) => d.env === 'production' && d.at >= DEMO_QUARTER.from && d.at < DEMO_QUARTER.to).map((d) => d.id),
    );
    expect(result.rows.map((r) => r.deployment).sort()).toEqual(expected.sort());
    expect(result.rows.every((r) => r.env === 'production')).toBe(true);
    expect(result.rows.some((r) => r.workItem === DEMO_OPEN_ITEM)).toBe(false);
  });

  it('finds the six violations and the one undecidable change', () => {
    expect(result.summary).toEqual({ deployments: 34, workItems: 34, pass: 27, fail: 6, cannotDetermine: 1 });
    expect(result.exceptions.map((e) => `${e.workItem} ${e.rule}`)).toEqual([
      'PAY-431 AL-1',
      'PAY-437 AL-2',
      'PAY-444 AL-3',
      'PAY-452 AL-6',
      'PAY-459 AL-7',
      'PAY-466 AL-1',
      'PAY-471 AL-4',
    ]);
  });

  it('changes its evidence-set hash when one verdict changes', () => {
    const fixed = bank.map((c) => structuredClone(c));
    const item = fixed.find((c) => c.workItem.key === 'PAY-431')!;
    const pr = item.pullRequests[0];
    pr.reviews.push({ by: 'u:tom', action: 'approved', at: pr.mergedAt!.replace('Z', ''), commit: pr.commits.at(-1)!.hash });
    pr.reviews.at(-1)!.at = new Date(Date.parse(pr.mergedAt!) - 60_000).toISOString();
    const again = runPopulationTest(fixed, DEMO_QUARTER.from, DEMO_QUARTER.to);
    expect(again.summary.fail).toBe(5);
    expect(again.evidenceSetHash).not.toBe(result.evidenceSetHash);
  });

  it('writes a workpaper with objective, population, method, results, exceptions and the hash', () => {
    const wp = buildWorkpaper(result, { site: 'demo.atlassian.net', preparedBy: 'Noor Haddad', preparedAt: '2026-10-05T09:00:00Z' });
    expect(wp.title).toBe('Change independence test, 2026-07-01 to 2026-09-30');
    for (const h of ['Objective', 'Population', 'Method', 'Results', 'Exceptions', 'Rules applied', 'Evidence integrity']) {
      expect(wp.storage).toContain(`<h2>${h}</h2>`);
      expect(wp.markdown).toContain(`## ${h}`);
    }
    expect(wp.storage).toContain(result.evidenceSetHash);
    expect(wp.markdown).toContain('34 production deployments of 34 work items');
    expect(wp.storage).not.toMatch(/<script/i);
  });

  it('escapes markup in the workpaper', () => {
    const hostile = structuredClone(bank);
    hostile[0].people = { ...hostile[0].people, 'u:tom': { name: '<script>alert(1)</script>', kind: 'human' } };
    const wp = buildWorkpaper(runPopulationTest(hostile, DEMO_QUARTER.from, DEMO_QUARTER.to), {
      site: 'x',
      preparedBy: '<b>me</b>',
      preparedAt: '2026-10-05T09:00:00Z',
    });
    expect(wp.storage).not.toContain('<script>');
    expect(wp.storage).not.toContain('<b>me</b>');
  });
});

describe('explanations', () => {
  it('names who must not approve the scene pull request', () => {
    const v = evaluate(scene);
    expect(explain(scene, v).headline).toBe('PAY-482 fails AL-1: independent approval.');
    expect(gateMessage(scene, v, 'payments-core#482')).toBe(
      "Arm's Length FAIL: payments-core#482 needs an approval from someone other than Léa Martin (requested the change and directed Coding agent).",
    );
  });

  it('names the approver when it passes', () => {
    const c = labelled.find((x) => x.id === 'D02')!.chain;
    expect(gateMessage(c, evaluate(c), 'payments-core#102')).toBe("Arm's Length PASS: payments-core#102: independent approval by Tom Becker.");
  });

  it('explains every case without throwing and within the gate length', () => {
    for (const c of [...bank, ...labelled.map((x) => x.chain)]) {
      const v = evaluate(c);
      expect(explain(c, v).lines.length).toBeGreaterThan(0);
      expect(gateMessage(c, v).length).toBeLessThanOrEqual(480);
    }
  });
});

describe('reviewer suggestions', () => {
  const history: ReviewRecord[] = bank.flatMap((c) =>
    c.pullRequests.flatMap((pr) => pr.reviews.map((r) => ({ reviewer: r.by, repo: pr.repo, pr: pr.id, at: r.at }))),
  );
  const kindOf = (ref: string) => DEMO_PEOPLE[ref]?.kind;

  it('proposes people outside the chain who reviewed the same repository, most active first', () => {
    const v = evaluate(scene);
    const exclude = v.pullRequests[0].conflicted.map((c) => c.ref);
    const out = suggestReviewers({ history, repo: 'payments-core', exclude, kindOf, now: '2026-10-28T09:00:00Z' });
    expect(out.length).toBeGreaterThan(0);
    expect(out.map((s) => s.ref)).not.toContain('u:lea');
    expect(out.every((s) => kindOf(s.ref) === 'human')).toBe(true);
    for (let i = 1; i < out.length; i++) expect(out[i - 1].reviews).toBeGreaterThanOrEqual(out[i].reviews);
  });

  it('never proposes bots and respects the lookback window', () => {
    const out = suggestReviewers({ history, repo: 'payments-core', exclude: [], kindOf, now: '2026-12-31T09:00:00Z', lookbackDays: 1 });
    expect(out.map((s) => s.ref)).toEqual([]);
    const all = suggestReviewers({ history, repo: 'payments-core', exclude: [], kindOf, now: '2026-10-28T09:00:00Z', lookbackDays: 365, limit: 10 });
    expect(all.map((s) => s.ref)).not.toContain('s:review-bot');
  });
});

describe('draft guard', () => {
  const v = evaluate(scene);
  const allowed = allowedFromEvidence(scene, v);

  it('accepts a draft that only uses facts from the evidence', () => {
    const draft =
      'Management response: payments-core#482 for PAY-482 was approved only by Léa Martin, who requested the change and directed the Coding agent. ' +
      'Tom Becker will review it before release, as AL-1 requires under Article 17.';
    expect(checkDraft(draft, allowed)).toEqual({ ok: true, problems: [] });
  });

  it('rejects an invented person, number, date, time and work item', () => {
    const draft = 'Jane Smith approved PAY-999 on 14 March 2026 at 23:59, covering 12 changes.';
    const out = checkDraft(draft, allowed);
    expect(out.ok).toBe(false);
    expect(out.problems).toEqual(
      expect.arrayContaining([
        { kind: 'person', value: 'Jane Smith' },
        { kind: 'work_item', value: 'PAY-999' },
        { kind: 'date', value: '14 March 2026' },
        { kind: 'time', value: '23:59' },
        { kind: 'number', value: '12' },
      ]),
    );
  });

  it('accepts dates and times that are in the evidence', () => {
    const pr = scene.pullRequests[0];
    const day = pr.createdAt.slice(0, 10);
    const [y, m, d] = day.split('-').map(Number);
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const draft = `The pull request opened on ${d} ${months[m - 1]} ${y} at ${pr.createdAt.slice(11, 16)}.`;
    expect(checkDraft(draft, allowed).ok).toBe(true);
  });
});

describe('pairing endpoint', () => {
  it('accepts the web trigger hosts Forge serves', () => {
    expect(isWebTriggerUrl('https://0b6a1c2e-5d4f-4e21-9a7c-3f2b8d1e6a90.webtrigger.atlassian.app/public/-Xy12AbCdEfGh')).toBe(true);
    expect(isWebTriggerUrl('https://abc.hello.atlassian-dev.net/x1/trigger')).toBe(true);
  });

  it('refuses any other host, scheme or credential', () => {
    for (const url of [
      'http://f3720f68.webtrigger.atlassian.app/public/x',
      'https://evil.example.com/webtrigger.atlassian.app/x',
      'https://webtrigger.atlassian.app.evil.example.com/x',
      'https://user@f3720f68.webtrigger.atlassian.app/x',
      'https://f3720f68.webtrigger.atlassian.app:8443/x',
      'https://site.atlassian.net/rest/api/3/myself',
      'not a url',
    ]) expect(isWebTriggerUrl(url), url).toBe(false);
  });
});
