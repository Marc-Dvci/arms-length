import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeKvs, fakeRequestJira, fakeRoute, memory, resetSite, site } from './fakes';

vi.mock('@forge/kvs', () => ({ kvs: fakeKvs, default: fakeKvs, WhereConditions: { beginsWith: (prefix: string) => ({ prefix }) } }));
vi.mock('@forge/api', () => {
  const asApp = () => ({ requestJira: (p: string, init?: RequestInit) => fakeRequestJira(p, init) });
  const asUser = () => ({ requestJira: asApp().requestJira, requestTeamworkGraph: async () => ({ ok: false, status: 403, json: async () => ({}) }) });
  return { default: { asApp, asUser }, route: fakeRoute, webTrigger: { getUrl: async () => 'https://abc.hello.atlassian-dev.net/x1/t' } };
});

import { assessIssue } from '../src/forge/chain';
import { demoApprove, demoSceneKey, demoShip, loadDemoBank, removeDemoBank, resendDevInfo } from '../src/forge/demo';
import { populationTest, whoMustApprove } from '../src/forge/services';
import { getDemoIndex } from '../src/forge/store';

const JUDGE = '5b10ac8d82e05b22cc7d4ef5';

beforeEach(() => {
  resetSite();
  site.users[JUDGE] = { accountId: JUDGE, displayName: 'A Judge', accountType: 'atlassian' };
});

describe('demo bank on a site', () => {
  it('resends the development data when the first send failed', async () => {
    const index = await loadDemoBank('PAY', JUDGE);
    expect(index.devInfo).toBe('sent');
    const sent = site.devops.length;
    expect(sent).toBeGreaterThan(1);
    expect((await resendDevInfo())?.devInfo).toBe('sent');
    expect(site.devops.length).toBe(sent * 2);
    expect((await getDemoIndex())?.devInfo).toBe('sent');
  });

  it('loads 35 work items, then the judge approves and ships the scene', async () => {
    const index = await loadDemoBank('PAY', JUDGE);
    expect(Object.keys(index.keys)).toHaveLength(35);
    expect(site.created).toHaveLength(35);
    expect(index.devInfo).toBe('sent');

    const scene = (await demoSceneKey())!;
    expect((await assessIssue(scene)).verdict.verdict).toBe('FAIL');

    const refused = await demoShip(scene, JUDGE);
    expect(refused.shipped).toBe(false);
    expect(refused.message).toContain('Léa Martin');

    const who = await whoMustApprove(scene);
    expect(who.suggestions[0]).toMatchObject({ name: 'Tom Becker', reviews: 5, repo: 'payments-core' });
    expect(who.mustNotApprove.map((m) => m.name)).toEqual(['Léa Martin']);

    await demoApprove(scene, JUDGE);
    const approved = await assessIssue(scene);
    expect(approved.verdict.verdict).toBe('PASS');
    expect(approved.explanation.lines[0]).toContain('independent approval by A Judge');

    const shipped = await demoShip(scene, JUDGE);
    expect(shipped.shipped).toBe(true);
    expect((await assessIssue(scene)).verdict.deployments).toHaveLength(1);
  });

  it('gives the demo quarter its six failures and one undecidable change', async () => {
    await loadDemoBank('PAY', JUDGE);
    const r = await populationTest('2026-07-01T00:00:00Z', '2026-10-01T00:00:00Z');
    expect(r.summary).toEqual({ deployments: 34, workItems: 34, pass: 27, fail: 6, cannotDetermine: 1 });
  });

  it('falls back to minimal fields when the project rejects labels', async () => {
    site.rejectLabels = true;
    const index = await loadDemoBank('PAY', JUDGE);
    expect(Object.values(index.keys).every((k) => /^OPS-\d+$/.test(k))).toBe(true);
  });

  it('loads once and removes its data', async () => {
    const first = await loadDemoBank('PAY', JUDGE);
    expect(await loadDemoBank('PAY', JUDGE)).toEqual(first);
    await removeDemoBank();
    expect(await getDemoIndex()).toBeNull();
    expect([...memory.store.keys()].some((k) => k.startsWith('demo:'))).toBe(false);
  });
});
