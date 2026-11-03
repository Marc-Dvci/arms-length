import { kvs, WhereConditions, Filter, FilterConditions } from '@forge/kvs';
import { DEFAULT_POLICY } from '../core/rules';
import { sha256 } from '../core/evidence';
import type { ChangeChain, Declaration, Deployment, Kind, Policy, PullRequest, Ref } from '../core/types';

/** Key layout of the app's Forge storage. */
export const K = {
  config: 'config',
  secret: 'pairing-secret',
  declarations: (issue: string) => `decl:${issue}`,
  pr: (id: string) => `pr:${id.includes('/') ? sha256(id) : id}`,
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
  repositoryFullName?: string;
  sourceUpdatedAt?: string;
  observedAt?: string;
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

export type Versioned<T> = { version: number; data: T };
export async function readValue<T>(key: string): Promise<T | undefined> {
  const current = await kvs.entity<Versioned<T>>('record').get(key);
  return current ? current.data : await kvs.get<T>(key);
}
/** Migrate legacy values on write; update the discoverable projection in the same transaction. */
export async function updateValue<T>(key: string, change: (value: T | undefined) => T): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const prior = await kvs.entity<Versioned<T>>('record').get(key);
    const current = prior ? prior.data : await kvs.get<T>(key);
    const data = change(current);
    if (data === current) return data;
    const next = { version: (prior?.version ?? 0) + 1, data };
    if (new TextEncoder().encode(JSON.stringify(next)).length > 220000)
      throw new Error('The evidence record is too large. Export it and narrow the managed scope.');
    try {
      await kvs
        .transact()
        .set(key, next, {
          entityName: 'record',
          conditions: new Filter<Versioned<T>>().and('version', prior ? FilterConditions.equalTo(prior.version) : FilterConditions.notExists()),
        })
        .set(key, data)
        .execute();
      return data;
    } catch (error) {
      if (attempt === 7) throw error;
    }
  }
  throw new Error('The evidence changed too often. Retry the operation.');
}

export async function getList<T>(key: string): Promise<T[]> {
  return (await readValue<T[]>(key)) ?? [];
}

export async function appendUnique<T>(key: string, item: T, same: (a: T, b: T) => boolean): Promise<T[]> {
  return updateValue<T[]>(key, (list = []) => [...list.filter((x) => !same(x, item)), item]);
}

export const getDeclarations = (issue: string) => getList<Declaration>(K.declarations(issue));
export const getDeployments = (issue: string) => getList<Deployment>(K.deployments(issue));

export async function getPullRequests(issue: string): Promise<StoredPullRequest[]> {
  const ids = await getList<string>(K.prsOf(issue));
  const prs = await Promise.all(ids.map((id) => readValue<StoredPullRequest>(K.pr(id))));
  return prs.filter((p): p is StoredPullRequest => !!p && p.workItems.includes(issue));
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
