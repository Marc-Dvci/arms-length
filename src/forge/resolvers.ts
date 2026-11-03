import { webTrigger } from '@forge/api';
import Resolver from '@forge/resolver';
import { newSecret } from '../core/signature';
import { verdictLabel, panelView } from '../core/viewmodel';
import { RULES } from '../core/rules';
import { assessIssue } from './chain';
import { demoApprove, demoSceneKey, demoShip, loadDemoBank, removeDemoBank, resendDevInfo, resetDemoScene } from './demo';
import { getUser, listProjects } from './jira';
import { defaultPeriod, listSpaces, populationTest, publishWorkpaper, raiseExceptions, whoMustApprove } from './services';
import { getConfig, getDemoIndex, getList, kvs, K, setConfig, type AppConfig } from './store';
import { actor as callerOf, admin, boundKey as issueKeyOf, editable, permission, readable, readScope, type Context as Ctx } from './access';

const resolver = new Resolver();

async function panel(key: string, caller?: string) {
  const a = await assessIssue(key);
  const view = panelView(a.chain, a.verdict, a.source);
  const scene = a.source === 'demo' ? await demoSceneKey() : null;
  const open = a.chain.pullRequests.find((p) => p.state === 'OPEN');
  const head = open?.commits.at(-1)?.hash;
  const approvedByCaller = !!open && open.reviews.some((r) => r.by === caller && r.action === 'approved' && r.commit === head);
  return { ...view, demo: { isScene: scene === key, canApprove: a.source === 'demo' && !!open && !approvedByCaller, canShip: a.source === 'demo' && !!open } };
}

resolver.define('panel', async ({ payload, context }) => {
  const key = issueKeyOf(payload, context as Ctx);
  await readable(key, context as Ctx);
  return panel(key, callerOf(context as Ctx));
});

resolver.define('who', async ({ payload, context }) => {
  const key = issueKeyOf(payload, context as Ctx);
  await readable(key, context as Ctx);
  return whoMustApprove(key);
});

resolver.define('demoApprove', async ({ payload, context }) => {
  const key = issueKeyOf(payload, context as Ctx);
  const caller = callerOf(context as Ctx);
  await editable(key, context as Ctx);
  await demoApprove(key, caller);
  return panel(key, caller);
});

resolver.define('demoShip', async ({ payload, context }) => {
  const key = issueKeyOf(payload, context as Ctx);
  const caller = callerOf(context as Ctx);
  await editable(key, context as Ctx);
  const out = await demoShip(key, caller);
  return { ...(await panel(key, caller)), shipMessage: out.message, shipped: out.shipped };
});

resolver.define('population', async ({ payload, context }) => {
  const period = payload?.from && payload?.to ? { from: payload.from as string, to: payload.to as string } : await defaultPeriod();
  const r = await populationTest(period.from, period.to, readScope(context as Ctx));
  const demo = await getDemoIndex();
  return {
    ...r,
    rows: r.rows.map((row) => ({ ...row, verdictLabel: verdictLabel(row.verdict), ruleTitle: row.rule ? RULES[row.rule].title : '' })),
    demo: demo ? { projectKey: demo.projectKey } : null,
    projects: await listProjects().catch(() => []),
  };
});

resolver.define('raiseExceptions', async ({ payload, context }) => {
  const check = readScope(context as Ctx);
  if (typeof payload.projectKey !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(payload.projectKey)) throw new Error('Choose a valid project.');
  await permission('CREATE_ISSUES', undefined, payload.projectKey);
  const r = await populationTest(payload.from, payload.to, check);
  return { links: await raiseExceptions(r, payload.projectKey) };
});

resolver.define('spaces', async ({ context }) => {
  callerOf(context as Ctx);
  return listSpaces();
});

resolver.define('publish', async ({ payload, context }) => {
  const r = await populationTest(payload.from, payload.to, readScope(context as Ctx));
  const me = await getUser(callerOf(context as Ctx));
  const url = await publishWorkpaper(r, payload.spaceId, payload.links ?? {}, me?.displayName ?? "Arm's Length");
  return { url };
});

resolver.define('admin', async ({ context }) => {
  await admin(context as Ctx);
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

resolver.define('saveConfig', async ({ payload, context }) => {
  await admin(context as Ctx);
  const current = await getConfig();
  const next = payload.config as Partial<AppConfig>;
  if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Error('Give valid app settings.');
  const merged: AppConfig = {
    ...current,
    ...next,
    policy: { ...current.policy, ...next.policy, version: next.policy ? `${current.policy.version.split('+')[0]}+custom` : current.policy.version },
    identities: next.identities ?? current.identities,
  };
  if (!(merged.policy.emergencyWindowHours > 0 && merged.policy.emergencyWindowHours <= 720))
    throw new Error('The emergency window must be between 1 and 720 hours.');
  if (
    !Array.isArray(merged.policy.productionEnvironments) ||
    !merged.policy.productionEnvironments.length ||
    merged.policy.productionEnvironments.length > 20 ||
    merged.policy.productionEnvironments.some((v) => typeof v !== 'string' || !v.trim() || v.length > 100)
  )
    throw new Error('Give valid production environment names.');
  if (typeof merged.emergencyLabel !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(merged.emergencyLabel)) throw new Error('Give a valid emergency label.');
  if (!Number.isInteger(merged.reviewerLookbackDays) || merged.reviewerLookbackDays < 1 || merged.reviewerLookbackDays > 366)
    throw new Error('The review window must be between 1 and 366 days.');
  if (!merged.identities || typeof merged.identities !== 'object' || Array.isArray(merged.identities) || Object.keys(merged.identities).length > 500)
    throw new Error('Give a valid identity registry.');
  for (const value of Object.values(merged.identities)) {
    if (
      !value ||
      !['human', 'agent', 'service', 'automation'].includes(value.kind) ||
      (value.actsAs !== undefined && typeof value.actsAs !== 'string') ||
      (value.owner != null && typeof value.owner !== 'string')
    )
      throw new Error('Give valid identity kinds and account references.');
  }
  await setConfig(merged);
  return merged;
});

/** Creates a new pairing secret. It is returned once, for the Bitbucket app and the Pipelines variable. */
resolver.define('pair', async ({ context }) => {
  await admin(context as Ctx);
  const secret = newSecret();
  await kvs.setSecret(K.secret, secret);
  return { secret, webTriggerUrl: await webTrigger.getUrl('arms-length-evidence') };
});

resolver.define('loadDemo', async ({ payload, context }) => {
  await admin(context as Ctx);
  if (typeof payload.projectKey !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(payload.projectKey)) throw new Error('Choose a valid project.');
  await permission('CREATE_ISSUES', undefined, payload.projectKey);
  return loadDemoBank(payload.projectKey, callerOf(context as Ctx));
});

resolver.define('resendDevInfo', async ({ context }) => {
  await admin(context as Ctx);
  return resendDevInfo();
});

resolver.define('resetScene', async ({ context }) => {
  await admin(context as Ctx);
  return { key: await resetDemoScene() };
});

resolver.define('removeDemo', async ({ context }) => {
  await admin(context as Ctx);
  await removeDemoBank();
  return { removed: true };
});

const definitions = resolver.getDefinitions();
/** Resolver injects the authenticated runtime principal as accountId; discard a caller-supplied principal field. */
export const handler: typeof definitions = (request, runtime) => definitions({ ...request, context: { ...request.context, principal: undefined } }, runtime);
