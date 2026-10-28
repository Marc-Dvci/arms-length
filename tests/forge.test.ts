import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeKvs, fakeRequestJira, fakeRoute, memory, resetSite, site } from './fakes';

vi.mock('@forge/kvs', () => ({
  kvs: fakeKvs,
  default: fakeKvs,
  WhereConditions: { beginsWith: (prefix: string) => ({ prefix }) },
}));
vi.mock('@forge/api', () => {
  const asApp = () => ({ requestJira: (p: string, init?: RequestInit) => fakeRequestJira(p, init) });
  const asUser = () => ({
    requestJira: (p: string, init?: RequestInit) => fakeRequestJira(p, init),
    requestTeamworkGraph: async () => ({ ok: false, status: 403, json: async () => ({ errors: [{ message: 'not allowlisted' }] }) }),
  });
  return { default: { asApp, asUser }, route: fakeRoute, webTrigger: { getUrl: async () => 'https://abc.hello.atlassian-dev.net/x1/trigger' } };
});

import { snapshotFromBitbucket, type BbActivity, type BbCommit, type BbPullRequest } from '../src/adapters/bitbucket';
import { SIGNATURE_HEADER, sign } from '../src/core/signature';
import { declareAgentWorkAction, managementResponseAction, whoMustApproveAction } from '../src/forge/actions';
import { assessIssue } from '../src/forge/chain';
import { K } from '../src/forge/store';
import { validate } from '../src/forge/validator';
import { handler } from '../src/forge/webtrigger';

const SECRET = 'a'.repeat(64);
const LEA = '712020:lea';
const TOM = '712020:tom';
const AGENT = '712020:agent-app';
const BOT = '712020:bitbucket-bot';

function seedSite() {
  site.users[LEA] = { accountId: LEA, displayName: 'Léa Martin', accountType: 'atlassian' };
  site.users[TOM] = { accountId: TOM, displayName: 'Tom Becker', accountType: 'atlassian' };
  site.users[AGENT] = { accountId: AGENT, displayName: 'Coding agent', accountType: 'app' };
  site.users[BOT] = { accountId: BOT, displayName: 'payments-bot', accountType: 'atlassian' };
  site.issues['PAY-7'] = {
    id: '10007',
    key: 'PAY-7',
    fields: { summary: 'Check the IBAN country code', created: '2026-10-27T17:30:00.000+0000', reporter: { accountId: LEA }, creator: { accountId: LEA }, assignee: { accountId: AGENT } },
  };
  site.changelogs['PAY-7'] = [
    { id: '1', author: { accountId: LEA }, created: '2026-10-27T17:40:00.000+0000', items: [{ field: 'assignee', fieldId: 'assignee', from: null, fromString: null, to: AGENT, toString: 'Coding agent' }] },
  ];
  memory.secrets.set(K.secret, SECRET);
  memory.store.set(K.config, { identities: { [BOT]: { kind: 'service', actsAs: AGENT } } });
}

function bitbucketPr(approvers: string[], extraCommit = false) {
  const pr: BbPullRequest = {
    id: 12,
    title: 'PAY-7 Check the IBAN country code',
    state: 'OPEN',
    author: { account_id: BOT, display_name: 'payments-bot', type: 'user' },
    created_on: '2026-10-27T18:05:00+00:00',
    source: { branch: { name: 'PAY-7-iban-country' }, commit: { hash: extraCommit ? 'bbb222222222' : 'aaa111111111' } },
    participants: approvers.map((a) => ({ user: { account_id: a, display_name: site.users[a].displayName }, approved: true, participated_on: '2026-10-27T18:12:00+00:00' })),
  };
  const activity: BbActivity[] = [
    { update: { date: '2026-10-27T18:05:00+00:00', state: 'OPEN', source: { commit: { hash: 'aaa111111111' } } } },
    ...approvers.map((a) => ({ approval: { date: '2026-10-27T18:12:00+00:00', user: { account_id: a } } })),
    ...(extraCommit ? [{ update: { date: '2026-10-27T18:30:00+00:00', state: 'OPEN', source: { commit: { hash: 'bbb222222222' } } } }] : []),
  ];
  const commits: BbCommit[] = [
    ...(extraCommit ? [{ hash: 'bbb2222222222222222222222222222222222222', date: '2026-10-27T18:29:00+00:00', author: { user: { account_id: BOT } } }] : []),
    { hash: 'aaa1111111111111111111111111111111111111', date: '2026-10-27T18:04:00+00:00', author: { user: { account_id: BOT } } },
  ];
  return snapshotFromBitbucket({ repoSlug: 'payments-core', pr, activity, commits });
}

const post = (body: unknown, opts: { secret?: string; at?: number } = {}) => {
  const text = JSON.stringify(body);
  return handler({
    method: 'POST',
    body: text,
    path: '/',
    queryParameters: {},
    headers: { [SIGNATURE_HEADER]: [sign(opts.secret ?? SECRET, text, opts.at)] },
  });
};

beforeEach(() => {
  resetSite();
  seedSite();
});

describe('web trigger', () => {
  it('rejects unsigned, forged and replayed requests', async () => {
    const body = JSON.stringify({ op: 'ping' });
    expect((await handler({ method: 'POST', body, path: '/', queryParameters: {}, headers: {} })).statusCode).toBe(401);
    expect((await post({ op: 'ping' }, { secret: 'b'.repeat(64) })).statusCode).toBe(401);
    expect((await post({ op: 'ping' }, { at: Math.floor(Date.now() / 1000) - 3600 })).statusCode).toBe(401);
    expect((await post({ op: 'ping' })).statusCode).toBe(200);
  });

  it('refuses to answer before pairing', async () => {
    memory.secrets.clear();
    expect((await post({ op: 'ping' })).statusCode).toBe(503);
  });

  it('fails the agent pull request the requester approved, then passes it when Tom approves', async () => {
    const first = JSON.parse((await post({ op: 'pr-snapshot', workspace: '{ws}', snapshot: bitbucketPr([LEA]) })).body!);
    expect(first.verdict).toBe('FAIL');
    expect(first.message).toContain('needs an approval from someone other than Léa Martin');
    expect(first.message).toContain('directed Coding agent');

    const second = JSON.parse((await post({ op: 'pr-snapshot', workspace: '{ws}', snapshot: bitbucketPr([LEA, TOM]) })).body!);
    expect(second.verdict).toBe('PASS');
    expect(second.message).toContain('independent approval by Tom Becker');
    expect((site.properties['PAY-7/arms-length'] as { verdict: string }).verdict).toBe('PASS');
  });

  it('treats an approval given before a later push as stale', async () => {
    const out = JSON.parse((await post({ op: 'pr-snapshot', workspace: '{ws}', snapshot: bitbucketPr([TOM], true) })).body!);
    expect(out.verdict).toBe('FAIL');
    expect(out.message).toContain('approved an earlier commit');
  });

  it('blocks the release of an unapproved commit and allows it after independent approval', async () => {
    await post({ op: 'pr-snapshot', workspace: '{ws}', snapshot: bitbucketPr([LEA]) });
    const gate = { op: 'deploy-gate', repo: 'payments-core', commit: 'aaa1111111111111111111111111111111111111', environment: 'production', build: '41' };
    const blocked = JSON.parse((await post(gate)).body!);
    expect(blocked.allow).toBe(false);
    expect(memory.store.get(K.deployments('PAY-7'))).toBeUndefined();

    await post({ op: 'pr-snapshot', workspace: '{ws}', snapshot: bitbucketPr([LEA, TOM]) });
    const allowed = JSON.parse((await post({ ...gate, build: '42' })).body!);
    expect(allowed.allow).toBe(true);
    expect((memory.store.get(K.deployments('PAY-7')) as unknown[]).length).toBe(1);
  });

  it('blocks a commit it has never seen in a pull request', async () => {
    const out = JSON.parse((await post({ op: 'deploy-gate', repo: 'payments-core', commit: 'f'.repeat(40), environment: 'production' })).body!);
    expect(out.allow).toBe(false);
    expect(out.message).toContain('AL-7');
  });

  it('answers CANNOT DETERMINE when the Jira history cannot be read', async () => {
    site.failChangelog.add('PAY-7');
    const out = JSON.parse((await post({ op: 'pr-snapshot', workspace: '{ws}', snapshot: bitbucketPr([TOM]) })).body!);
    expect(out.verdict).toBe('CANNOT_DETERMINE');
  });
});

describe('workflow validator', () => {
  it('blocks the release transition until the verdict is PASS', async () => {
    await post({ op: 'pr-snapshot', workspace: '{ws}', snapshot: bitbucketPr([LEA]) });
    const blocked = await validate({ issue: { key: 'PAY-7' } });
    expect(blocked.result).toBe(false);
    expect(blocked.errorMessage).toContain('Léa Martin');
    await post({ op: 'pr-snapshot', workspace: '{ws}', snapshot: bitbucketPr([LEA, TOM]) });
    expect(await validate({ issue: { key: 'PAY-7' } })).toEqual({ result: true });
  });

  it('blocks when the work item cannot be read', async () => {
    const out = await validate({ issue: { key: 'NOPE-1' } });
    expect(out.result).toBe(false);
  });
});

describe('MCP tools', () => {
  it('records the caller as principal, whatever the inputs say', async () => {
    site.issues['PAY-8'] = { ...site.issues['PAY-7'], key: 'PAY-8', id: '10008', fields: { ...site.issues['PAY-7'].fields, reporter: { accountId: TOM }, assignee: null } };
    site.changelogs['PAY-8'] = [];
    const out = (await declareAgentWorkAction({ workItem: 'pay-8', branch: 'PAY-8-x', principal: TOM, accountId: TOM } as never, { principal: { accountId: LEA } })) as {
      recorded: { principalAccountId: string };
    };
    expect(out.recorded.principalAccountId).toBe(LEA);
    expect(memory.store.get(K.declarations('PAY-8'))).toEqual([expect.objectContaining({ principal: LEA, branch: 'PAY-8-x' })]);
  });

  it('refuses a call without identity', async () => {
    const out = (await declareAgentWorkAction({ workItem: 'PAY-7' }, undefined)) as { error?: string };
    expect(out.error).toContain('no user identity');
  });

  it('names who must not approve and why', async () => {
    await post({ op: 'pr-snapshot', workspace: '{ws}', snapshot: bitbucketPr([LEA]) });
    const out = (await whoMustApproveAction({ workItem: 'PAY-7' })) as { mustNotApprove: { name: string; why: string }[]; verdict: string };
    expect(out.verdict).toBe('FAIL');
    expect(out.mustNotApprove).toEqual([{ ref: LEA, name: 'Léa Martin', why: 'requested the change and directed Coding agent' }]);
  });

  it('rejects malformed work item keys', async () => {
    expect(await whoMustApproveAction({ workItem: 'DROP TABLE' })).toEqual({ error: 'Give a Jira work item key such as PAY-482.' });
  });
});

describe('management responses', () => {
  it('posts a response that only cites the evidence and rejects one that invents a person', async () => {
    memory.store.set(K.reviews('payments-core'), [{ reviewer: TOM, repo: 'payments-core', pr: 'payments-core#9', at: new Date(Date.now() - 86_400_000).toISOString() }]);
    await post({ op: 'pr-snapshot', workspace: '{ws}', snapshot: bitbucketPr([LEA]) });
    const bad = (await managementResponseAction({ workItem: 'PAY-7', response: 'Jane Smith reviewed this change and approved it for release.' })) as { posted: boolean };
    expect(bad.posted).toBe(false);
    expect(site.comments['PAY-7']).toBeUndefined();
    const good = (await managementResponseAction({
      workItem: 'PAY-7',
      response: 'Tom Becker will review payments-core#12 before release. Léa Martin directed the Coding agent, so her approval does not count under AL-1.',
    })) as { posted: boolean };
    expect(good.posted).toBe(true);
    expect(site.comments['PAY-7']).toHaveLength(1);
  });
});

describe('live chain', () => {
  it('attributes the assignment made at creation to the creator', async () => {
    site.changelogs['PAY-7'] = [];
    await post({ op: 'pr-snapshot', workspace: '{ws}', snapshot: bitbucketPr([LEA]) });
    const a = await assessIssue('PAY-7', { writeProperty: false });
    expect(a.chain.assignments).toEqual([{ at: '2026-10-27T17:30:00.000Z', by: LEA, to: AGENT }]);
    expect(a.verdict.verdict).toBe('FAIL');
  });
});
