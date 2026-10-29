import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeKvs, fakeRequestConfluence, fakeRequestJira, fakeRoute, memory, resetSite, site } from './fakes';

vi.mock('@forge/kvs', () => ({ kvs: fakeKvs, default: fakeKvs, WhereConditions: { beginsWith: (prefix: string) => ({ prefix }) } }));
vi.mock('@forge/api', () => {
  const asApp = () => ({ requestJira: (p: string, init?: RequestInit) => fakeRequestJira(p, init) });
  const asUser = () => ({ requestJira: asApp().requestJira, requestConfluence: (p: string, init?: RequestInit) => fakeRequestConfluence(p, init), requestTeamworkGraph: async () => ({ ok: false, status: 403, json: async () => ({}) }) });
  return { default: { asApp, asUser }, route: fakeRoute, webTrigger: { getUrl: async () => 'https://abc.hello.atlassian-dev.net/x1/t' } };
});

import { assessIssue } from '../src/forge/chain';
import { demoApprove, demoSceneKey, demoShip, loadDemoBank, removeDemoBank, resendDevInfo, resetDemoScene } from '../src/forge/demo';
import { listSpaces, populationTest, publishWorkpaper, whoMustApprove } from '../src/forge/services';
import { getDemoIndex } from '../src/forge/store';
import { handler } from '../src/forge/resolvers';

/** Calls a resolver the way Forge does, with the signed-in user in the runtime payload. */
const callResolver = (functionKey: string, payload: Record<string, unknown>, accountId: string) =>
  (handler as (event: unknown, runtime: unknown) => Promise<{ demo: { canApprove: boolean; canShip: boolean } }>)({ call: { functionKey, payload }, context: {} }, { principal: { accountId } });

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

  it('resets the scene after it shipped, so it can be played again', async () => {
    await loadDemoBank('PAY', JUDGE);
    const scene = (await demoSceneKey())!;
    await demoApprove(scene, JUDGE);
    expect((await demoShip(scene, JUDGE)).shipped).toBe(true);

    expect(await resetDemoScene()).toBe(scene);
    const again = await assessIssue(scene);
    expect(again.verdict.verdict).toBe('FAIL');
    expect(again.verdict.deployments).toHaveLength(0);
    expect(again.chain.pullRequests[0]).toMatchObject({ state: 'OPEN' });
    expect(again.chain.pullRequests[0].reviews.map((r) => again.chain.people[r.by].name)).toEqual(['Léa Martin']);
    expect(site.devops.some((d) => (d as { p: string }).p.match(/^\/rest\/deployments\/0\.1\/pipelines\/payments-release\/environments\/production\/deployments\/\d+$/))).toBe(true);
    expect((await demoShip(scene, JUDGE)).shipped).toBe(false);
  });

  it('stops offering "Approve as me" once the caller approved the head commit', async () => {
    await loadDemoBank('PAY', JUDGE);
    const scene = (await demoSceneKey())!;
    expect((await callResolver('panel', { issueKey: scene }, JUDGE)).demo).toMatchObject({ canApprove: true, canShip: true });
    const after = await callResolver('demoApprove', { issueKey: scene }, JUDGE);
    expect(after.demo).toMatchObject({ canApprove: false, canShip: true });
  });

  it('lists team spaces before personal ones and publishes the workpaper at full width', async () => {
    expect(await listSpaces()).toEqual([
      { id: '7', key: 'SD', name: 'Software development', personal: false },
      { id: '9', key: '~7120200a', name: 'Marc Donovici', personal: true },
    ]);
    await loadDemoBank('PAY', JUDGE);
    const r = await populationTest('2026-07-01T00:00:00Z', '2026-10-01T00:00:00Z');
    const url = await publishWorkpaper(r, '7', {}, 'A Judge');
    expect(url).toBe('https://site.atlassian.net/wiki/spaces/SD/pages/622595');
    const [page, ...props] = site.confluence.filter((c) => c.method === 'POST');
    expect(page.body).toMatchObject({ spaceId: '7', title: 'Change independence test, 2026-07-01 to 2026-09-30' });
    expect(props.map((p) => [p.path, p.body?.key, p.body?.value])).toEqual([
      ['/wiki/api/v2/pages/622595/properties', 'content-appearance-published', 'full-width'],
      ['/wiki/api/v2/pages/622595/properties', 'content-appearance-draft', 'full-width'],
    ]);

    await publishWorkpaper(r, '7', {}, 'A Judge');
    await publishWorkpaper(r, '7', {}, 'A Judge');
    const titles = site.confluence.filter((c) => c.path === '/wiki/api/v2/pages').map((c) => c.body?.title ?? '');
    expect(new Set(titles).size).toBe(3);
    expect(titles.at(-1)).toMatch(/^Change independence test, 2026-07-01 to 2026-09-30 \([0-9a-f]{8}, \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC\)$/);
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
