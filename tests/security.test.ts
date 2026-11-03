import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeKvs, fakeRequestJira, fakeRequestAsUser, FakeFilter, fakeConditions, fakeRoute, memory, resetSite, site } from './fakes';
vi.mock('@forge/kvs', () => ({
  kvs: fakeKvs,
  Filter: FakeFilter,
  FilterConditions: fakeConditions,
  WhereConditions: { beginsWith: (prefix: string) => ({ prefix }) },
}));
vi.mock('@forge/api', () => ({
  default: {
    asApp: () => ({ requestJira: fakeRequestJira }),
    asUser: () => ({ requestJira: fakeRequestAsUser, requestTeamworkGraph: async () => ({ ok: false, status: 403, json: async () => ({}) }) }),
  },
  route: fakeRoute,
  webTrigger: { getUrl: async () => 'https://audit.hello.atlassian-dev.net/trigger' },
}));
import { handler } from '../src/forge/resolvers';
import { changeEvidenceAction, declareAgentWorkAction, managementResponseAction, populationTestAction } from '../src/forge/actions';
import { appendUnique, getList, K } from '../src/forge/store';
import { raiseExceptions } from '../src/forge/services';
import { runPopulationTest } from '../src/core/population';
import { buildDemoBank } from '../src/demo/bank';
const call = (name: string, payload = {}, bound?: string) =>
  (handler as any)(
    { call: { functionKey: name, payload }, context: bound ? { extension: { issue: { key: bound } } } : {} },
    { principal: { accountId: 'reader' } },
  );
beforeEach(() => {
  resetSite();
  site.issues['PAY-1'] = { id: '101', key: 'PAY-1', fields: { created: '2026-10-29T08:00:00Z', summary: 'Private change', reporter: { accountId: 'reader' } } };
  site.users.reader = { accountId: 'reader', accountType: 'atlassian', displayName: 'Reader' };
});
describe('server authorization', () => {
  it('cannot replace a missing runtime identity with a principal inside the resolver request', async () => {
    await expect((handler as any)({ call: { functionKey: 'pair' }, context: { principal: { accountId: 'forged-admin' } } }, {})).rejects.toThrow(
      'No signed-in user',
    );
    expect(memory.secrets.size).toBe(0);
  });
  it.each(['admin', 'saveConfig', 'pair', 'loadDemo', 'resendDevInfo', 'resetScene', 'removeDemo'])(
    'denies %s from the shared issue-panel resolver for a non-admin',
    async (name) => {
      site.permissions.ADMINISTER = false;
      await expect(call(name, { config: {}, projectKey: 'PAY' }, 'PAY-1')).rejects.toThrow('ADMINISTER');
      expect(memory.store.size).toBe(0);
      expect(memory.secrets.size).toBe(0);
    },
  );
  it('refuses a payload key different from the panel context', async () => {
    await expect(call('panel', { issueKey: 'PAY-1' }, 'PUBLIC-9')).rejects.toThrow('own Jira panel');
  });
  it('cannot read app-visible private data through the panel or MCP', async () => {
    site.denied.add('PAY-1');
    await expect(call('panel', { issueKey: 'PAY-1' })).rejects.toThrow('inaccessible');
    expect(await changeEvidenceAction({ workItem: 'PAY-1' }, { accountId: 'reader' })).toHaveProperty('error');
    expect(site.properties).toEqual({});
  });
  it('requires Edit Issues for declarations and ignores identity inside the payload context', async () => {
    site.permissions.EDIT_ISSUES = false;
    expect(await declareAgentWorkAction({ workItem: 'PAY-1' }, { accountId: 'reader' })).toHaveProperty('error');
    expect(await declareAgentWorkAction({ workItem: 'PAY-1', context: { accountId: 'forged' } }, undefined)).toHaveProperty('error');
    expect(memory.store.has(K.declarations('PAY-1'))).toBe(false);
  });
  it('requires Add Comments before management responses', async () => {
    site.permissions.ADD_COMMENTS = false;
    expect(
      await managementResponseAction({ workItem: 'PAY-1', response: 'A sufficiently long proposed management response.' }, { accountId: 'reader' }),
    ).toHaveProperty('error');
    expect(site.comments).toEqual({});
  });
  it('requires an authenticated actor for a population action', async () => {
    expect(await populationTestAction({})).toHaveProperty('error');
  });
  it('omits private work items from population rows and totals', async () => {
    const examples = buildDemoBank()
      .filter((c) => c.deployments.length)
      .slice(0, 2);
    for (const chain of examples) {
      memory.store.set(K.demoChain(chain.workItem.key), chain);
      site.issues[chain.workItem.key] = { id: chain.workItem.key, key: chain.workItem.key, fields: { created: '2026-10-29T08:00:00Z' } };
    }
    site.denied.add(examples[1].workItem.key);
    const result = await call('population', { from: '2026-07-01T00:00:00Z', to: '2026-10-01T00:00:00Z' });
    expect(result.rows).toHaveLength(examples[0].deployments.length);
    expect(result.rows.every((row: { workItem: string }) => row.workItem !== examples[1].workItem.key)).toBe(true);
  });
});
describe('conditional evidence writes', () => {
  it('preserves concurrent principal declarations while migrating the old array', async () => {
    memory.store.set('decl:PAY-1', [{ principal: 'legacy' }]);
    await Promise.all(Array.from({ length: 6 }, (_, n) => appendUnique('decl:PAY-1', { principal: `person-${n}` }, (a, b) => a.principal === b.principal)));
    expect(new Set((await getList<{ principal: string }>('decl:PAY-1')).map((x) => x.principal)).size).toBe(7);
    expect(memory.store.get('decl:PAY-1') as unknown[]).toHaveLength(7);
  });
  it('claims each exception before creating it so concurrent attempts cannot create duplicate Jira items', async () => {
    const result = runPopulationTest(buildDemoBank(), '2026-07-01T00:00:00Z', '2026-10-01T00:00:00Z');
    result.exceptions = result.exceptions.slice(0, 1);
    const outcomes = await Promise.allSettled([raiseExceptions(result, 'PAY'), raiseExceptions(result, 'PAY')]);
    expect(outcomes.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(site.created).toHaveLength(1);
    await raiseExceptions(result, 'PAY');
    expect(site.created).toHaveLength(1);
  });
  it('keeps exception creation separate for different destination projects', async () => {
    const result = runPopulationTest(buildDemoBank(), '2026-07-01T00:00:00Z', '2026-10-01T00:00:00Z');
    result.exceptions = result.exceptions.slice(0, 1);
    await raiseExceptions(result, 'PAY');
    await raiseExceptions(result, 'OTHER');
    await raiseExceptions(result, 'OTHER');
    expect(site.created).toHaveLength(2);
  });
  it('permits a safe retry after Jira explicitly rejects exception creation', async () => {
    const result = runPopulationTest(buildDemoBank(), '2026-07-01T00:00:00Z', '2026-10-01T00:00:00Z');
    result.exceptions = result.exceptions.slice(0, 1);
    site.createStatus = 400;
    await expect(raiseExceptions(result, 'PAY')).rejects.toThrow('400');
    site.createStatus = undefined;
    await raiseExceptions(result, 'PAY');
    expect(site.created).toHaveLength(1);
  });
  it('retains the recovery claim after an ambiguous Jira server error', async () => {
    const result = runPopulationTest(buildDemoBank(), '2026-07-01T00:00:00Z', '2026-10-01T00:00:00Z');
    result.exceptions = result.exceptions.slice(0, 1);
    site.createStatus = 500;
    await expect(raiseExceptions(result, 'PAY')).rejects.toThrow('500');
    site.createStatus = undefined;
    await expect(raiseExceptions(result, 'PAY')).rejects.toThrow('awaiting recovery');
    expect(site.created).toHaveLength(0);
  });
});
