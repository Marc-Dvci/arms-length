import { RULES } from './rules';
import type { ChangeChain, Verdict } from './types';

export interface Allowed {
  names: string[];
  numbers: Set<string>;
  dates: Set<string>;
  times: Set<string>;
  keys: Set<string>;
  vocabulary: Set<string>;
}

export interface GuardProblem {
  kind: 'person' | 'number' | 'date' | 'time' | 'work_item';
  value: string;
}

export interface GuardResult {
  ok: boolean;
  problems: GuardProblem[];
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Capitalised words that open sentences or name products and roles, never people. */
const GLOSSARY = `The A An This That These Those It Its We I Our My Your You He She They Their There Here When Where What Why How Who
If Once After Before Until Since From To For In On At By With Without Within And Or But Not No Yes All Each Every Some Any
Please Thanks Thank Regards Dear Hello Hi Team Management Response Action Plan Owner Control Controls Finding Findings Exception
Independent Independence Approval Approvals Approver Reviewer Review Change Changes Emergency Production Deployment Deployments
Pull Request Requests Work Item Items Agent Agents Coding Service Account Accounts Automation Rule Rules Policy Article Requirement
Regulation Delegated Commission Directive Arm's Arm Length Jira Bitbucket Confluence Rovo Atlassian Forge MCP DORA PCI DSS EU ICT RTS CISO CTO CIO
Quarter Monday Tuesday Wednesday Thursday Friday Saturday Sunday Next Going Forward Root Cause Remediation Due Date Status`
  .split(/\s+/)
  .filter(Boolean);

const isoDay = (iso: string) => iso.slice(0, 10);
const hhmm = (iso: string) => iso.slice(11, 16);

/** Everything a draft about this verdict may mention. */
export function allowedFromEvidence(
  chain: ChangeChain,
  verdict: Verdict,
  extra: { names?: string[]; numbers?: (string | number)[]; dates?: string[] } = {},
): Allowed {
  const names = [...Object.values(chain.people).map((p) => p.name), ...(extra.names ?? [])];
  const stamps = [
    ...chain.assignments.map((a) => a.at),
    ...chain.declarations.map((d) => d.at),
    ...chain.deployments.map((d) => d.at),
    ...chain.pullRequests.flatMap((pr) => [pr.createdAt, pr.mergedAt, ...pr.commits.map((c) => c.at), ...pr.reviews.map((r) => r.at)]),
    chain.emergency?.declaredAt,
    ...(extra.dates ?? []),
  ].filter((s): s is string => !!s);
  const numbers = new Set<string>();
  const addNumbers = (s: string) => {
    for (const m of s.match(/\d+(?:\.\d+)*/g) ?? []) numbers.add(m);
  };
  for (const pr of chain.pullRequests) addNumbers(pr.id);
  for (const d of chain.deployments) addNumbers(d.id);
  addNumbers(chain.workItem.key);
  for (const rule of Object.values(RULES)) {
    addNumbers(rule.id);
    for (const ref of rule.references) addNumbers(`${ref.source} ${ref.clause}`);
  }
  for (const n of extra.numbers ?? []) numbers.add(String(n));
  for (const n of [verdict.pullRequests.length, verdict.deployments.length]) numbers.add(String(n));
  for (const s of stamps) {
    addNumbers(isoDay(s));
    numbers.add(String(Number(s.slice(8, 10))));
    numbers.add(String(Number(s.slice(0, 4))));
  }
  const vocabulary = new Set<string>([...GLOSSARY, ...names.flatMap((n) => n.split(/\s+/)), ...chain.pullRequests.map((p) => p.repo)]);
  return {
    names,
    numbers,
    dates: new Set(stamps.map(isoDay)),
    times: new Set(stamps.map(hhmm)),
    keys: new Set([chain.workItem.key, ...Object.keys(RULES)]),
    vocabulary,
  };
}

function toIsoDay(day: number, month: number, year: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Checks a drafted text against the evidence. Every person, number, date, time and work item
 * key it mentions must appear in the evidence, otherwise the draft is rejected.
 */
export function checkDraft(text: string, allowed: Allowed): GuardResult {
  const problems: GuardProblem[] = [];
  let rest = text;

  // Work item keys.
  for (const m of text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? []) if (!allowed.keys.has(m)) problems.push({ kind: 'work_item', value: m });
  rest = rest.replace(/\b[A-Z][A-Z0-9]+-\d+\b/g, ' ');

  // Dates: ISO, "3 September 2026", "September 3, 2026".
  const monthRe = MONTHS.join('|');
  const dateForms: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/\b(\d{4})-(\d{2})-(\d{2})(?:[T ][0-9:.]+Z?)?\b/g, (m) => `${m[1]}-${m[2]}-${m[3]}`],
    [new RegExp(`\\b(\\d{1,2})\\s+(${monthRe})\\s+(\\d{4})\\b`, 'gi'), (m) => toIsoDay(+m[1], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[3])],
    [new RegExp(`\\b(${monthRe})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'gi'), (m) => toIsoDay(+m[2], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[3])],
  ];
  for (const [re, norm] of dateForms) {
    for (const m of rest.matchAll(re)) if (!allowed.dates.has(norm(m))) problems.push({ kind: 'date', value: m[0] });
    rest = rest.replace(re, ' ');
  }

  // Clock times.
  for (const m of rest.match(/\b\d{1,2}:\d{2}\b/g) ?? []) {
    const t = m.padStart(5, '0');
    if (!allowed.times.has(t)) problems.push({ kind: 'time', value: m });
  }
  rest = rest.replace(/\b\d{1,2}:\d{2}\b/g, ' ');

  // Remaining numbers.
  for (const m of rest.match(/\d+(?:[.,]\d+)*/g) ?? []) {
    const n = m.replace(/,(?=\d{3}\b)/g, '').replace(/\.$/, '');
    if (!allowed.numbers.has(n)) problems.push({ kind: 'number', value: m });
  }

  // People: runs of two or more capitalised words that are neither glossary words nor known names.
  const known = allowed.names.map((n) => n.toLowerCase());
  for (const m of text.matchAll(/\p{Lu}[\p{Ll}'’-]+(?:\s+\p{Lu}[\p{Ll}'’-]+)+/gu)) {
    const words = m[0].split(/\s+/);
    while (words.length && allowed.vocabulary.has(words[0]) && !known.some((k) => k.startsWith(words.join(' ').toLowerCase()))) words.shift();
    if (words.length < 2) continue;
    const phrase = words.join(' ');
    if (known.includes(phrase.toLowerCase())) continue;
    if (words.every((w) => allowed.vocabulary.has(w))) continue;
    problems.push({ kind: 'person', value: phrase });
  }

  return { ok: problems.length === 0, problems };
}
