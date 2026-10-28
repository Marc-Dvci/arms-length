import { assessIssue } from './chain';

interface IssueEvent {
  issue?: { key?: string };
  changelog?: { items?: { field?: string; fieldId?: string }[] };
}

const WATCHED = new Set(['assignee', 'labels', 'reporter']);

/** Refreshes the indexed verdict when a field the chain depends on changes. */
export async function onIssueUpdated(event: IssueEvent): Promise<void> {
  const key = event.issue?.key;
  if (!key) return;
  const items = event.changelog?.items ?? [];
  if (items.length && !items.some((i) => WATCHED.has(i.fieldId ?? i.field ?? ''))) return;
  await assessIssue(key).catch(() => undefined);
}
