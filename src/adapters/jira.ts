import type { Assignment, Kind, Ref } from '../core/types';

/** Subset of Jira Cloud REST v3 shapes the adapter reads. */
export interface JiraUserRef {
  accountId: string;
  displayName?: string;
  accountType?: 'atlassian' | 'app' | 'customer' | 'unknown';
}

export interface JiraChangelogEntry {
  id: string;
  author?: JiraUserRef;
  created: string;
  items: { field: string; fieldId?: string; from: string | null; fromString: string | null; to: string | null; toString: string | null }[];
}

export interface JiraIssue {
  key: string;
  fields: {
    summary?: string;
    created: string;
    reporter?: JiraUserRef | null;
    creator?: JiraUserRef | null;
    assignee?: JiraUserRef | null;
    labels?: string[];
  };
}

/** Jira writes offsets as +0000; ISO 8601 parsers expect +00:00. */
export function isoTime(jira: string): string {
  const fixed = jira.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  return new Date(fixed).toISOString();
}

/**
 * Every assignment of the work item, oldest first. The assignment made at creation has no
 * changelog entry, so it is attributed to the creator at the creation time.
 */
export function assignmentsFromHistory(issue: JiraIssue, changelog: JiraChangelogEntry[], automationActors: Set<Ref>): Assignment[] {
  const changes = changelog
    .flatMap((e) => e.items.filter((i) => i.field === 'assignee' || i.fieldId === 'assignee').map((i) => ({ e, i })))
    .sort((a, b) => (isoTime(a.e.created) < isoTime(b.e.created) ? -1 : 1));
  const out: Assignment[] = [];
  const initial = changes.length ? changes[0].i.from : (issue.fields.assignee?.accountId ?? null);
  const creator = issue.fields.creator?.accountId ?? issue.fields.reporter?.accountId;
  if (initial && creator) out.push(withVia({ at: isoTime(issue.fields.created), by: creator, to: initial }, automationActors));
  for (const { e, i } of changes) {
    if (!i.to) continue;
    out.push(withVia({ at: isoTime(e.created), by: e.author?.accountId ?? 'unknown', to: i.to }, automationActors));
  }
  return out;
}

function withVia(a: Assignment, automationActors: Set<Ref>): Assignment {
  return automationActors.has(a.by) ? { ...a, via: { automationRule: a.by } } : a;
}

/** The moment the emergency label was first added, and by whom. */
export function emergencyFromHistory(issue: JiraIssue, changelog: JiraChangelogEntry[], label: string): { declaredAt: string; declaredBy: Ref } | null {
  const has = (s: string | null) => (s ?? '').split(/\s+/).includes(label);
  const added = changelog
    .flatMap((e) => e.items.filter((i) => i.field === 'labels' && has(i.toString) && !has(i.fromString)).map(() => e))
    .sort((a, b) => (isoTime(a.created) < isoTime(b.created) ? -1 : 1))[0];
  if (added) return { declaredAt: isoTime(added.created), declaredBy: added.author?.accountId ?? 'unknown' };
  const firstLabelChange = changelog.find((e) => e.items.some((i) => i.field === 'labels'));
  const createdWithLabel = firstLabelChange
    ? has(firstLabelChange.items.find((i) => i.field === 'labels')!.fromString)
    : (issue.fields.labels ?? []).includes(label);
  if (createdWithLabel && issue.fields.creator?.accountId) {
    return { declaredAt: isoTime(issue.fields.created), declaredBy: issue.fields.creator.accountId };
  }
  return null;
}

/** Default kind of a Jira account: app accounts are agents, unless the admin registered them otherwise. */
export function kindFromAccountType(accountType: JiraUserRef['accountType']): Kind {
  return accountType === 'app' ? 'agent' : 'human';
}

/** Work item keys named in a branch name or a title. */
export function workItemKeys(...texts: (string | undefined)[]): string[] {
  const keys = new Set<string>();
  for (const t of texts) for (const m of (t ?? '').match(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g) ?? []) keys.add(m);
  return [...keys];
}
