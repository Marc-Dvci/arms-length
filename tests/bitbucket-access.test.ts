import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ request: vi.fn(), ping: vi.fn(), check: vi.fn(), set: vi.fn(), setSecret: vi.fn() }));
vi.mock('@forge/api', () => ({
  default: { asUser: () => ({ requestBitbucket: mock.request }) },
  route: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((a, b, i) => a + b + (v[i] ?? ''), ''),
}));
vi.mock('@forge/kvs', () => ({ kvs: { get: async () => undefined, getSecret: async () => undefined, set: mock.set, setSecret: mock.setSecret } }));
vi.mock('../bitbucket/src/pullrequest', () => ({ ping: mock.ping, checkPullRequest: mock.check }));
import { resolver, onPullRequestChanged } from '../bitbucket/src/index';
const call = (name: string, payload = {}, context = {}) =>
  (resolver as any)({ call: { functionKey: name, payload }, context: { workspaceId: '{workspace-id}', ...context } }, { principal: { accountId: 'reader' } });
beforeEach(() => {
  vi.resetAllMocks();
  mock.ping.mockResolvedValue({ ok: true, status: 200 });
});
it('denies pairing from the PR card for an ordinary workspace member', async () => {
  mock.request.mockResolvedValue({ ok: true, json: async () => ({ values: [{ administrator: false, workspace: { uuid: '{workspace-id}' } }] }) });
  await expect(call('pair', { endpoint: 'https://abc.hello.atlassian-dev.net/trigger', secret: 'a'.repeat(64) })).rejects.toThrow('administrator');
  expect(mock.ping).not.toHaveBeenCalled();
  expect(mock.setSecret).not.toHaveBeenCalled();
});
it('permits pairing only after the current user is verified as this workspace administrator', async () => {
  mock.request.mockResolvedValue({ ok: true, json: async () => ({ values: [{ administrator: true, workspace: { uuid: '{workspace-id}' } }] }) });
  expect(await call('pair', { endpoint: 'https://abc.hello.atlassian-dev.net/trigger', secret: 'a'.repeat(64) })).toEqual({ paired: true });
  expect(mock.setSecret).toHaveBeenCalledTimes(1);
});
it('checks PR visibility before reading its saved result or rechecking as the app', async () => {
  mock.request.mockResolvedValue({ ok: false, status: 403 });
  const ctx = { extension: { repository: { uuid: '{repo}' }, pullRequest: { id: 1 } } };
  await expect(call('card', {}, ctx)).rejects.toThrow('inaccessible');
  await expect(call('recheck', {}, ctx)).rejects.toThrow('inaccessible');
  expect(mock.check).not.toHaveBeenCalled();
});
it('fetches the canonical state after a merge event', async () => {
  mock.check.mockResolvedValue({ verdict: 'PASS' });
  await onPullRequestChanged({ workspace: { uuid: 'w' }, repository: { uuid: 'r' }, pullrequest: { id: 1 } });
  expect(mock.check).toHaveBeenCalledWith('w', 'r', 1);
});
