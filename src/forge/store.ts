import { kvs, WhereConditions } from '@forge/kvs';
import { DEFAULT_POLICY } from '../core/rules';
import type { ChangeChain, Declaration, Deployment, Kind, Policy, PullRequest, Ref } from '../core/types';

/** Key layout of the app's Forge storage. */
export const K = {
  config: 'config',
  secret: 'pairing-secret',
  declarations: (issue: string) => `decl:${issue}`,
  pr: (id: string) => `pr:${id}`,
  prsOf: (issue: string) => `prs:${issue}`,
  commit: (hash: string) => `commit:${hash}`,
  deployments: (issue: string) => `deploys:${issue}`,
  reviews: (repo: string) => `reviews:${repo}`,
  demoChain: (issue: string) => `demo:${issue}`,
  demoIndex: 'demo-index',
  person: (ref: string) => `person:${ref}`,
};

export interface IdentityOverride {
  kind: Kind;
  actsAs?: Ref;
  /** For automation accounts: the person who owns the rules that run as this account. */
  owner?: Ref | null;
  note?: string;
}

export interface AppConfig {
  policy: Policy;
  identities: Record<Ref, IdentityOverride>;
  emergencyLabel: string;
  reviewerLookbackDays: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  policy: DEFAULT_POLICY,
  identities: {},
  emergencyLabel: 'emergency-change',
  reviewerLookbackDays: 90,
};

export interface StoredPullRequest extends PullRequest {
  workItems: string[];
  workspace?: string;
  receivedAt: string;
  /** False when the repository history behind the snapshot was incomplete. */
  complete: boolean;
  people: Record<Ref, { name: string; type?: string }>;
}

export interface DemoIndex {
  projectKey: string;
  loadedAt: string;
  loadedBy: Ref;
  /** Demo key (PAY-431) to the work item key created on this site. */
  keys: Record<string, string>;
  /** Whether the pull requests and deployments reached Jira's development panel. */
  devInfo?: string;
}

export async function getConfig(): Promise<AppConfig> {
  const stored = (await kvs.get<AppConfig>(K.config)) ?? undefined;
  return { ...DEFAULT_CONFIG, ...stored, policy: { ...DEFAULT_POLICY, ...stored?.policy } };
}

export const setConfig = (c: AppConfig) => kvs.set(K.config, c);

export async function getList<T>(key: string): Promise<T[]> {
  return ((await kvs.get<T[]>(key)) as T[] | undefined) ?? [];
}

export async function appendUnique<T>(key: string, item: T, same: (a: T, b: T) => boolean): Promise<T[]> {
  const list = await getList<T>(key);
  const next = [...list.filter((x) => !same(x, item)), item];
  await kvs.set(key, next);
  return next;
}

export const getDeclarations = (issue: string) => getList<Declaration>(K.declarations(issue));
export const getDeployments = (issue: string) => getList<Deployment>(K.deployments(issue));

export async function getPullRequests(issue: string): Promise<StoredPullRequest[]> {
  const ids = await getList<string>(K.prsOf(issue));
  const prs = await Promise.all(ids.map((id) => kvs.get<StoredPullRequest>(K.pr(id))));
  return prs.filter((p): p is StoredPullRequest => !!p);
}

export const getDemoChain = async (issue: string) => ((await kvs.get<ChangeChain>(K.demoChain(issue))) as ChangeChain | undefined) ?? null;
export const getDemoIndex = async () => ((await kvs.get<DemoIndex>(K.demoIndex)) as DemoIndex | undefined) ?? null;

/** Every stored key with a prefix, following cursors. */
export async function listByPrefix<T>(prefix: string): Promise<{ key: string; value: T }[]> {
  const out: { key: string; value: T }[] = [];
  let cursor: string | undefined;
  do {
    let q = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);
    if (cursor) q = q.cursor(cursor);
    const page = await q.getMany<T>();
    out.push(...page.results.map((r) => ({ key: r.key, value: r.value as T })));
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

export { kvs };
