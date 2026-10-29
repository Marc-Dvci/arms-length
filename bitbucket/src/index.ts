// Forge entry points of the Bitbucket app. Handlers are referenced from bitbucket/manifest.yml.
import { kvs } from '@forge/kvs';
import Resolver from '@forge/resolver';
import { checkPullRequest, ping, type CheckResult, type Pairing } from './pullrequest';
import { verdictKey } from '../../src/adapters/bitbucket';
import { isWebTriggerUrl } from '../../src/core/signature';

interface MergeCheckEvent {
  workspace: { uuid: string };
  repository: { uuid: string };
  pullrequest: { id: number };
  trigger?: { type?: string };
}

/** Bitbucket merge check. Only PASS succeeds; on a Free workspace the check is informational. */
export async function check(event: MergeCheckEvent): Promise<{ success: boolean; message: string }> {
  try {
    const r = await checkPullRequest(event.workspace.uuid, event.repository.uuid, event.pullrequest.id);
    return { success: r.verdict === 'PASS', message: r.message.slice(0, 480) };
  } catch (e) {
    return { success: false, message: `Arm's Length CANNOT DETERMINE: ${(e as Error).message}`.slice(0, 480) };
  }
}

const definitions = new Resolver();

type Ctx = { workspaceId?: string; extension?: { repository?: { uuid?: string }; pullRequest?: { id?: number | string } } };

definitions.define('settings', async () => {
  const pairing = (await kvs.get<Pairing>('pairing')) as Pairing | undefined;
  const secret = await kvs.getSecret<string>('pairing-secret');
  return { endpoint: pairing?.endpoint ?? '', paired: !!pairing && !!secret };
});

definitions.define('pair', async ({ payload }) => {
  const endpoint = String(payload.endpoint ?? '').trim();
  const secret = String(payload.secret ?? '').trim();
  if (!isWebTriggerUrl(endpoint)) throw new Error('Paste the endpoint shown in the Arm\'s Length settings of your Jira site.');
  if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error('The pairing secret is 64 hexadecimal characters.');
  const test = await ping(endpoint, secret);
  if (!test.ok) throw new Error(`The Jira site refused the pairing (${test.status}). Check the endpoint and the secret.`);
  await kvs.set('pairing', { endpoint });
  await kvs.setSecret('pairing-secret', secret);
  return { paired: true };
});

definitions.define('card', async ({ context }) => {
  const ctx = context as Ctx;
  const repo = ctx.extension?.repository?.uuid;
  const id = ctx.extension?.pullRequest?.id;
  if (!repo || id === undefined) throw new Error('No pull request in context.');
  return ((await kvs.get<CheckResult>(verdictKey(repo, id))) as CheckResult | undefined) ?? null;
});

definitions.define('recheck', async ({ context }) => {
  const ctx = context as Ctx;
  const repo = ctx.extension?.repository?.uuid;
  const id = ctx.extension?.pullRequest?.id;
  if (!repo || id === undefined || !ctx.workspaceId) throw new Error('No pull request in context.');
  return checkPullRequest(ctx.workspaceId, repo, id);
});

export const resolver = definitions.getDefinitions();
