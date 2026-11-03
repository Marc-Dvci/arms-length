import api, { route } from '@forge/api';

export type Context = { accountId?: string; principal?: { accountId?: string }; extension?: { issue?: { key?: string } } };
export class Inaccessible extends Error {}
export function actor(context: Context | undefined): string {
  const id = context?.accountId ?? context?.principal?.accountId;
  if (!id) throw new Error('No signed-in user.');
  return id;
}
export function issueKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]*-\d+$/.test(value)) throw new Error('Give a valid Jira work item key.');
  return value;
}
export function boundKey(payload: { issueKey?: unknown }, context: Context): string {
  actor(context);
  const bound = context.extension?.issue?.key;
  const key = issueKey(payload.issueKey ?? bound);
  if (bound && bound !== key) throw new Inaccessible('Open that work item in its own Jira panel.');
  return key;
}
export async function readable(key: string, context: Context): Promise<void> {
  actor(context);
  boundKey({ issueKey: key }, context);
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${key}?fields=summary`);
  if (res.status === 403 || res.status === 404) throw new Inaccessible('This work item is unavailable or inaccessible.');
  if (!res.ok) throw new Error('Jira access could not be checked. Retry when Jira is available.');
}
export async function permission(name: string, key?: string, project?: string): Promise<void> {
  const query = key
    ? route`/rest/api/3/mypermissions?issueKey=${key}&permissions=${name}`
    : project
      ? route`/rest/api/3/mypermissions?projectKey=${project}&permissions=${name}`
      : route`/rest/api/3/mypermissions?permissions=${name}`;
  const res = await api.asUser().requestJira(query);
  if (!res.ok) throw new Error('Jira permissions could not be checked.');
  const body = (await res.json()) as { permissions?: Record<string, { havePermission?: boolean }> };
  if (body.permissions?.[name]?.havePermission !== true) throw new Error(`Jira ${name} permission is required.`);
}
export async function editable(key: string, context: Context): Promise<void> {
  await readable(key, context);
  await permission('EDIT_ISSUES', key);
}
export async function admin(context: Context): Promise<void> {
  actor(context);
  await permission('ADMINISTER');
}
/** A fresh scope per invocation: cache shared issue checks, never across users. */
export function readScope(context: Context) {
  actor(context);
  const checks = new Map<string, Promise<void>>();
  return (key: string) => {
    if (!checks.has(key)) checks.set(key, readable(key, context));
    return checks.get(key)!;
  };
}
export async function visible<T>(items: T[], keyOf: (item: T) => string, check: (key: string) => Promise<void>): Promise<T[]> {
  const out: T[] = [];
  for (let n = 0; n < items.length; n += 5) {
    const batch = await Promise.allSettled(
      items.slice(n, n + 5).map(async (item) => {
        await check(keyOf(item));
        return item;
      }),
    );
    for (const result of batch) {
      if (result.status === 'fulfilled') out.push(result.value);
      else if (!(result.reason instanceof Inaccessible)) throw result.reason;
    }
  }
  return out;
}
