import { beforeEach, expect, it, vi } from 'vitest';
import { fakeKvs, fakeRequestJira, FakeFilter, fakeConditions, fakeRoute, memory, resetSite, site } from './fakes';
vi.mock('@forge/kvs', () => ({
  kvs: fakeKvs,
  Filter: FakeFilter,
  FilterConditions: fakeConditions,
  WhereConditions: { beginsWith: (prefix: string) => ({ prefix }) },
}));
vi.mock('@forge/api', () => ({ default: { asApp: () => ({ requestJira: fakeRequestJira }) }, route: fakeRoute }));
import { handler, storeSnapshot, type SnapshotMessage } from '../src/forge/webtrigger';
import { K, getPullRequests } from '../src/forge/store';
import { assessIssue } from '../src/forge/chain';
import { sign, SIGNATURE_HEADER } from '../src/core/signature';
const HASH = 'a'.repeat(40);
const SECRET = 'b'.repeat(64);
const snapshot = (state: 'OPEN' | 'MERGED' | 'DECLINED' = 'MERGED', repo = 'workspace/payments-core'): SnapshotMessage => ({
  op: 'pr-snapshot',
  workspace: 'workspace-id',
  snapshot: {
    repositoryFullName: repo,
    sourceUpdatedAt: '2026-10-29T10:00:00Z',
    observedAt: '2026-10-29T10:01:00Z',
    complete: true,
    people: {},
    workItems: ['PAY-1'],
    pullRequest: {
      id: 'payments-core#1',
      repo: 'payments-core',
      author: 'author',
      state,
      createdAt: '2026-10-29T08:00:00Z',
      sourceBranch: 'PAY-1-change',
      ...(state === 'MERGED' ? { mergedAt: '2026-10-29T09:00:00Z' } : {}),
      commits: [{ hash: HASH, author: 'author', at: '2026-10-29T08:50:00Z' }],
      reviews: [{ by: 'reviewer', at: '2026-10-29T08:55:00Z', action: 'approved', commit: HASH }],
    },
  },
});
const gate = async (repo = 'workspace/payments-core', commit = HASH) => {
  const body = JSON.stringify({ op: 'deploy-gate', repo, commit, environment: 'production', build: 'test' });
  const r = await handler({ method: 'POST', body, path: '/', queryParameters: {}, headers: { [SIGNATURE_HEADER]: [sign(SECRET, body)] } });
  return JSON.parse(r.body!);
};
beforeEach(() => {
  resetSite();
  memory.secrets.set(K.secret, SECRET);
  site.issues['PAY-1'] = { id: '101', key: 'PAY-1', fields: { created: '2026-10-29T08:00:00Z', reporter: { accountId: 'requester' } } };
  site.changelogs['PAY-1'] = [];
  for (const id of ['requester', 'author', 'reviewer']) site.users[id] = { accountId: id, displayName: id, accountType: 'atlassian' };
});
it.each(['OPEN', 'DECLINED'] as const)('rejects an approved %s PR', async (state) => {
  await storeSnapshot(snapshot(state));
  expect((await gate()).allow).toBe(false);
  expect(memory.store.has(K.deployments('PAY-1'))).toBe(false);
});
it('binds release to the full repository and hash', async () => {
  await storeSnapshot(snapshot());
  expect((await gate('different/payments-core')).allow).toBe(false);
  expect((await gate('workspace/payments-core', HASH.slice(0, 12))).allow).toBe(false);
  expect((await gate('payments-core')).allow).toBe(false);
  expect((await gate()).allow).toBe(true);
  expect((await assessIssue('PAY-1', { writeProperty: false })).verdict.verdict).toBe('PASS');
});
it('rejects an earlier commit even when the final commit is independently approved', async () => {
  const msg = snapshot();
  msg.snapshot.pullRequest.commits.unshift({ hash: 'c'.repeat(40), author: 'author', at: '2026-10-29T08:40:00Z' });
  await storeSnapshot(msg);
  expect((await gate('workspace/payments-core', 'c'.repeat(40))).allow).toBe(false);
});
it('retains a newer push when an older snapshot arrives later', async () => {
  const newer = snapshot('OPEN');
  newer.snapshot.sourceUpdatedAt = '2026-10-29T11:00:00Z';
  newer.snapshot.observedAt = '2026-10-29T11:01:00Z';
  newer.snapshot.pullRequest.commits.push({ hash: 'd'.repeat(40), author: 'author', at: '2026-10-29T10:50:00Z' });
  await storeSnapshot(newer);
  await storeSnapshot(snapshot('OPEN'));
  expect((await getPullRequests('PAY-1'))[0].commits.at(-1)?.hash).toBe('d'.repeat(40));
  expect((await gate()).allow).toBe(false);
});
it('keeps the same repository slug in different workspaces distinct', async () => {
  await storeSnapshot(snapshot('OPEN', 'other/payments-core'));
  await storeSnapshot(snapshot());
  expect(await getPullRequests('PAY-1')).toHaveLength(2);
  expect((await gate('other/payments-core')).allow).toBe(false);
});
it('migrates a paired legacy PR index without leaving a stale duplicate in the change chain', async () => {
  const legacy = snapshot('OPEN');
  memory.store.set(K.pr('payments-core#1'), {
    ...legacy.snapshot.pullRequest,
    workspace: legacy.workspace,
    workItems: ['PAY-1'],
    complete: true,
    people: {},
    receivedAt: '2026-10-29T08:00:00Z',
  });
  memory.store.set(K.prsOf('PAY-1'), ['payments-core#1']);
  await storeSnapshot(snapshot());
  expect(await getPullRequests('PAY-1')).toHaveLength(1);
  expect((await gate()).allow).toBe(true);
});
it('fails closed when different evidence claims the exact same source and observation revision', async () => {
  await storeSnapshot(snapshot());
  const conflict = snapshot();
  conflict.snapshot.pullRequest.reviews = [];
  await storeSnapshot(conflict);
  expect((await gate()).allow).toBe(false);
  expect((await getPullRequests('PAY-1'))[0].complete).toBe(false);
});
it('drops old work-item associations when a newer snapshot changes its linked keys', async () => {
  await storeSnapshot(snapshot('OPEN'));
  const moved = snapshot('OPEN');
  moved.snapshot.sourceUpdatedAt = '2026-10-29T11:00:00Z';
  moved.snapshot.observedAt = '2026-10-29T11:01:00Z';
  moved.snapshot.workItems = ['OTHER-2'];
  await storeSnapshot(moved);
  expect(await getPullRequests('PAY-1')).toHaveLength(0);
  expect(await getPullRequests('OTHER-2')).toHaveLength(1);
});
