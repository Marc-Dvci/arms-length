import { webTrigger } from '@forge/api';
import Resolver from '@forge/resolver';
import { newSecret } from '../core/signature';
import { verdictLabel, panelView } from '../core/viewmodel';
import { RULES } from '../core/rules';
import { assessIssue } from './chain';
import { demoApprove, demoSceneKey, demoShip, loadDemoBank, removeDemoBank, resendDevInfo } from './demo';
import { getUser, listProjects } from './jira';
import { defaultPeriod, listSpaces, populationTest, publishWorkpaper, raiseExceptions, whoMustApprove } from './services';
import { getConfig, getDemoIndex, getList, kvs, K, setConfig, type AppConfig } from './store';

const resolver = new Resolver();

type Ctx = { accountId?: string; extension?: { issue?: { key?: string } } };
const callerOf = (context: Ctx) => {
  if (!context.accountId) throw new Error('No signed-in user.');
  return context.accountId;
};
const issueKeyOf = (payload: { issueKey?: string }, context: Ctx) => {
  const key = payload?.issueKey ?? context.extension?.issue?.key;
  if (!key) throw new Error('No work item in context.');
  return key;
};

async function panel(key: string, caller?: string) {
  const a = await assessIssue(key);
  const view = panelView(a.chain, a.verdict, a.source);
  const scene = a.source === 'demo' ? await demoSceneKey() : null;
  const open = a.chain.pullRequests.find((p) => p.state === 'OPEN');
  const head = open?.commits.at(-1)?.hash;
  const approvedByCaller = !!open && open.reviews.some((r) => r.by === caller && r.action === 'approved' && r.commit === head);
  return { ...view, demo: { isScene: scene === key, canApprove: a.source === 'demo' && !!open && !approvedByCaller, canShip: a.source === 'demo' && !!open } };
}

resolver.define('panel', async ({ payload, context }) => panel(issueKeyOf(payload, context as Ctx), (context as Ctx).accountId));

resolver.define('who', async ({ payload, context }) => whoMustApprove(issueKeyOf(payload, context as Ctx)));

resolver.define('demoApprove', async ({ payload, context }) => {
  const key = issueKeyOf(payload, context as Ctx);
  const caller = callerOf(context as Ctx);
  await demoApprove(key, caller);
  return panel(key, caller);
});

resolver.define('demoShip', async ({ payload, context }) => {
  const key = issueKeyOf(payload, context as Ctx);
  const caller = callerOf(context as Ctx);
  const out = await demoShip(key, caller);
  return { ...(await panel(key, caller)), shipMessage: out.message, shipped: out.shipped };
});

resolver.define('population', async ({ payload }) => {
  const period = payload?.from && payload?.to ? { from: payload.from as string, to: payload.to as string } : await defaultPeriod();
  const r = await populationTest(period.from, period.to);
  const demo = await getDemoIndex();
  return {
    ...r,
    rows: r.rows.map((row) => ({ ...row, verdictLabel: verdictLabel(row.verdict), ruleTitle: row.rule ? RULES[row.rule].title : '' })),
    demo: demo ? { projectKey: demo.projectKey } : null,
    projects: await listProjects().catch(() => []),
  };
});

resolver.define('raiseExceptions', async ({ payload }) => {
  const r = await populationTest(payload.from, payload.to);
  return { links: await raiseExceptions(r, payload.projectKey) };
});

resolver.define('spaces', async () => listSpaces());

resolver.define('publish', async ({ payload, context }) => {
  const r = await populationTest(payload.from, payload.to);
  const me = await getUser(callerOf(context as Ctx));
  const url = await publishWorkpaper(r, payload.spaceId, payload.links ?? {}, me?.displayName ?? 'Arm\'s Length');
  return { url };
});

resolver.define('admin', async () => {
  const [config, demo, gateLog, secret, url, projects] = await Promise.all([
    getConfig(),
    getDemoIndex(),
    getList<Record<string, unknown>>('gate-log'),
    kvs.getSecret<string>(K.secret),
    webTrigger.getUrl('arms-length-evidence').catch(() => null),
    listProjects().catch(() => []),
  ]);
  return { config, demo, gateLog: gateLog.slice(-10).reverse(), paired: !!secret, webTriggerUrl: url, projects };
});

resolver.define('saveConfig', async ({ payload }) => {
  const current = await getConfig();
  const next = payload.config as Partial<AppConfig>;
  const merged: AppConfig = {
    ...current,
    ...next,
    policy: { ...current.policy, ...next.policy, version: next.policy ? `${current.policy.version.split('+')[0]}+custom` : current.policy.version },
    identities: next.identities ?? current.identities,
  };
  if (!(merged.policy.emergencyWindowHours > 0 && merged.policy.emergencyWindowHours <= 720)) throw new Error('The emergency window must be between 1 and 720 hours.');
  if (!merged.policy.productionEnvironments.length) throw new Error('Name at least one production environment.');
  await setConfig(merged);
  return merged;
});

/** Creates a new pairing secret. It is returned once, for the Bitbucket app and the Pipelines variable. */
resolver.define('pair', async () => {
  const secret = newSecret();
  await kvs.setSecret(K.secret, secret);
  return { secret, webTriggerUrl: await webTrigger.getUrl('arms-length-evidence') };
});

resolver.define('loadDemo', async ({ payload, context }) => loadDemoBank(payload.projectKey, callerOf(context as Ctx)));

resolver.define('resendDevInfo', async () => resendDevInfo());

resolver.define('removeDemo', async () => {
  await removeDemoBank();
  return { removed: true };
});

export const handler = resolver.getDefinitions();
