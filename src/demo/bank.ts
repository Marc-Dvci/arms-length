import type { ChangeChain, Commit, Deployment, Person, PullRequest, Review } from '../core/types';

/**
 * The demo bank: one quarter of a payments team's work, with synthetic identities. Every chain is
 * fixed, so the population test returns the same rows and the same evidence-set hash on every site.
 */

export const DEMO_QUARTER = { from: '2026-07-01T00:00:00Z', to: '2026-10-01T00:00:00Z' };
export const DEMO_OPEN_ITEM = 'PAY-482';

export const DEMO_PEOPLE: Record<string, Person> = {
  'u:lea': { name: 'Léa Martin', kind: 'human' },
  'u:tom': { name: 'Tom Becker', kind: 'human' },
  'u:sam': { name: 'Sam Okafor', kind: 'human' },
  'u:priya': { name: 'Priya Raman', kind: 'human' },
  'u:marco': { name: 'Marco Bianchi', kind: 'human' },
  'u:aicha': { name: 'Aïcha Diallo', kind: 'human' },
  'u:noor': { name: 'Noor Haddad', kind: 'human' },
  'a:coder': { name: 'Coding agent', kind: 'agent' },
  'a:fixer': { name: 'Fix agent', kind: 'agent' },
  'a:tester': { name: 'Test agent', kind: 'agent' },
  'b:coder-bot': { name: 'coder-bot', kind: 'service', actsAs: 'a:coder' },
  'b:fixer-bot': { name: 'fixer-bot', kind: 'service', actsAs: 'a:fixer' },
  'b:tester-bot': { name: 'tester-bot', kind: 'service', actsAs: 'a:tester' },
  's:review-bot': { name: 'review-bot', kind: 'service' },
  'x:automation': { name: 'Automation for Jira', kind: 'automation' },
};

export const DEMO_ROLES: Record<string, string> = {
  'u:lea': 'Payments team lead',
  'u:tom': 'Senior engineer',
  'u:sam': 'Product owner',
  'u:priya': 'Engineer',
  'u:marco': 'Engineer',
  'u:aicha': 'Engineer',
  'u:noor': 'IT risk officer',
};

const AUTOMATION_RULES = { 'triage-agent': { owner: 'u:sam' }, 'deps-agent': { owner: null } };
const BOT: Record<string, string> = { 'a:coder': 'b:coder-bot', 'a:fixer': 'b:fixer-bot', 'a:tester': 'b:tester-bot' };
const REVIEWERS = ['u:tom', 'u:priya', 'u:marco', 'u:aicha'];
const HUMANS = ['u:priya', 'u:marco', 'u:aicha', 'u:tom'];
const REPOS = ['payments-core', 'payments-web', 'ledger-service'];

const SUMMARIES = [
  'Validate IBAN checksum before SEPA submission',
  'Round FX conversion to the currency minor unit',
  'Retry SWIFT acknowledgements with backoff',
  'Show the cut-off time on the transfer form',
  'Reject duplicate end-to-end IDs',
  'Add instant payment limit per client segment',
  'Log reason codes for returned direct debits',
  'Mask PAN in the dispute export',
  'Move the settlement batch to the new scheduler',
  'Expose mandate status in the client API',
  'Fix the daylight-saving shift in the value date',
  'Paginate the transaction history endpoint',
  'Alert on ledger imbalance above threshold',
  'Cache BIC directory lookups',
  'Upgrade the ISO 20022 schema to 2025 release',
  'Add a confirmation step for beneficiary changes',
  'Split fee lines on the statement',
  'Handle partial refunds on card payments',
  'Record the requester on manual adjustments',
  'Remove the legacy CSV upload',
  'Add idempotency keys to payment initiation',
  'Show pending holds on the balance screen',
  'Reconcile the nostro accounts nightly',
  'Raise the timeout for the sanctions screening call',
  'Add a health check for the clearing gateway',
  'Normalise beneficiary names before screening',
  'Expose the dispute deadline to support agents',
  'Track consent expiry for account information access',
];

const iso = (t: number) => new Date(t).toISOString().replace(':00.000Z', 'Z').replace('.000Z', 'Z');
const at = (day: string, hh: number, mm = 0) => iso(Date.parse(`${day}T00:00:00Z`) + (hh * 60 + mm) * 60_000);
const hoursAfter = (stamp: string, h: number) => iso(Date.parse(stamp) + h * 3_600_000);

interface Spec {
  key: string;
  summary: string;
  day: string;
  repo: string;
  requester: string;
  /** Agent the work item is assigned to, or a person. */
  assignee: string;
  assigner: string;
  automationRule?: keyof typeof AUTOMATION_RULES;
  reviewers: Review[] | ((prStart: string, head: string, merged: string) => Review[]);
  extraCommitAfterApproval?: boolean;
  emergency?: boolean;
  prodCommit?: 'merge' | 'hotfix';
  state?: 'MERGED' | 'OPEN';
  staging?: boolean;
}

function chainFrom(spec: Spec): ChangeChain {
  const isAgent = spec.assignee.startsWith('a:');
  const author = isAgent ? BOT[spec.assignee] : spec.assignee;
  const assignedAt = at(spec.day, 8, 40);
  const firstCommit = hoursAfter(assignedAt, 1);
  const prStart = hoursAfter(firstCommit, 0.25);
  const merged = hoursAfter(prStart, 5);
  const num = spec.key.split('-')[1];
  const commits: Commit[] = [{ hash: `${num}a1c0`, author, at: firstCommit }];
  if (spec.extraCommitAfterApproval) commits.push({ hash: `${num}b2d1`, author, at: hoursAfter(prStart, 3) });
  const head = commits.at(-1)!.hash;
  const reviews = typeof spec.reviewers === 'function' ? spec.reviewers(prStart, head, merged) : spec.reviewers;
  const state = spec.state ?? 'MERGED';
  const pr: PullRequest = {
    id: `${spec.repo}#${num}`,
    repo: spec.repo,
    title: spec.summary,
    author,
    sourceBranch: `${spec.key}-${spec.summary.toLowerCase().split(' ').slice(0, 3).join('-')}`,
    state,
    createdAt: prStart,
    ...(state === 'MERGED' ? { mergedAt: merged, mergedBy: spec.assigner.startsWith('u:') ? spec.assigner : 'u:tom', mergeCommit: `${num}m3e2` } : {}),
    commits,
    reviews,
  };
  const deployments: Deployment[] = [];
  if (spec.staging) deployments.push({ id: `stg-${num}`, env: 'staging', at: hoursAfter(prStart, 1), commit: commits[0].hash, triggeredBy: 'pipeline', pipeline: 'payments-release' });
  if (state === 'MERGED') {
    deployments.push({
      id: `prod-${num}`,
      env: 'production',
      at: hoursAfter(merged, 2),
      commit: spec.prodCommit === 'hotfix' ? `${num}f9h0` : `${num}m3e2`,
      triggeredBy: spec.prodCommit === 'hotfix' ? 'u:marco' : 'pipeline',
      pipeline: 'payments-release',
    });
  }
  return {
    workItem: { key: spec.key, requester: spec.requester, summary: spec.summary },
    people: DEMO_PEOPLE,
    assignments: [
      spec.automationRule
        ? { at: assignedAt, by: 'x:automation', to: spec.assignee, via: { automationRule: spec.automationRule } }
        : { at: assignedAt, by: spec.assigner, to: spec.assignee },
    ],
    declarations: [],
    automationRules: spec.automationRule ? { [spec.automationRule]: AUTOMATION_RULES[spec.automationRule] } : {},
    pullRequests: [pr],
    deployments,
    emergency: spec.emergency ? { declaredAt: hoursAfter(prStart, -0.1), declaredBy: spec.requester } : null,
    history: { jira: 'complete', scm: 'complete' },
  };
}

const approve = (by: string, stamp: string, commit: string): Review => ({ by, action: 'approved', at: stamp, commit });

const SPECIAL = new Set([431, 437, 444, 448, 452, 459, 466, 471, 482]);
const HEALTHY_NUMBERS = (() => {
  const out: number[] = [];
  for (let n = 401; out.length < 26; n += 3) out.push(SPECIAL.has(n) ? n + 1 : n);
  return out;
})();

function healthy(i: number): Spec {
  const days = ['2026-07-02', '2026-07-06', '2026-07-08', '2026-07-13', '2026-07-15', '2026-07-20', '2026-07-22', '2026-07-27', '2026-07-29',
    '2026-08-03', '2026-08-05', '2026-08-10', '2026-08-17', '2026-08-19', '2026-08-24', '2026-08-26', '2026-08-31', '2026-09-02',
    '2026-09-07', '2026-09-09', '2026-09-14', '2026-09-16', '2026-09-21', '2026-09-23', '2026-09-28', '2026-09-29'];
  const agent = i % 3 !== 2;
  const assignee = agent ? (['a:coder', 'a:coder', 'a:tester', 'a:fixer'][i % 4]) : HUMANS[i % HUMANS.length];
  const assigner = agent ? (i % 2 ? 'u:lea' : 'u:tom') : 'u:sam';
  const requester = i % 4 === 0 ? 'u:lea' : 'u:sam';
  const blocked = new Set([assigner, requester, assignee]);
  const reviewer = REVIEWERS.filter((r) => !blocked.has(r))[i % 2] ?? 'u:aicha';
  return {
    key: `PAY-${HEALTHY_NUMBERS[i]}`,
    summary: SUMMARIES[i % SUMMARIES.length],
    day: days[i],
    repo: REPOS[i % 3],
    requester,
    assignee,
    assigner,
    staging: i % 4 === 1,
    reviewers: (prStart, head) => [approve(reviewer, hoursAfter(prStart, 4), head)],
  };
}

export function buildDemoBank(): ChangeChain[] {
  const specs: Spec[] = Array.from({ length: 26 }, (_, i) => healthy(i));
  specs.push(
    {
      key: 'PAY-431', summary: 'Raise the instant payment ceiling for business clients', day: '2026-08-12', repo: 'payments-core',
      requester: 'u:lea', assignee: 'a:coder', assigner: 'u:lea',
      reviewers: (s, head) => [approve('u:lea', hoursAfter(s, 0.2), head)],
    },
    {
      key: 'PAY-437', summary: 'Change the rounding of interest accruals', day: '2026-08-14', repo: 'ledger-service',
      requester: 'u:sam', assignee: 'a:coder', assigner: 'u:lea', extraCommitAfterApproval: true,
      reviewers: (s) => [approve('u:tom', hoursAfter(s, 2), `437a1c0`)],
    },
    {
      key: 'PAY-444', summary: 'Skip the second screening pass for low-risk transfers', day: '2026-08-20', repo: 'payments-core',
      requester: 'u:sam', assignee: 'a:fixer', assigner: 'u:lea',
      reviewers: (s, head) => [approve('s:review-bot', hoursAfter(s, 0.1), head), approve('u:lea', hoursAfter(s, 4), head)],
    },
    {
      key: 'PAY-448', summary: 'Restore the clearing gateway certificate', day: '2026-08-27', repo: 'payments-core',
      requester: 'u:noor', assignee: 'u:marco', assigner: 'u:noor', emergency: true,
      reviewers: (_s, head, merged) => [approve('u:tom', hoursAfter(merged, 20), head)],
    },
    {
      key: 'PAY-452', summary: 'Shorten the dispute window shown to clients', day: '2026-09-01', repo: 'payments-web',
      requester: 'u:sam', assignee: 'a:coder', assigner: 'u:tom',
      reviewers: (_s, head, merged) => [approve('u:priya', hoursAfter(merged, 3), head)],
    },
    {
      key: 'PAY-459', summary: 'Correct the fee table for cross-border transfers', day: '2026-09-08', repo: 'payments-core',
      requester: 'u:sam', assignee: 'u:priya', assigner: 'u:sam', prodCommit: 'hotfix',
      reviewers: (s, head) => [approve('u:tom', hoursAfter(s, 4), head)],
    },
    {
      key: 'PAY-466', summary: 'Bump the HTTP client in the clearing adapter', day: '2026-09-15', repo: 'ledger-service',
      requester: 'u:noor', assignee: 'a:coder', assigner: 'x:automation', automationRule: 'triage-agent',
      reviewers: (s, head) => [approve('u:sam', hoursAfter(s, 3), head)],
    },
    {
      key: 'PAY-471', summary: 'Update the JSON parser in the statement service', day: '2026-09-22', repo: 'ledger-service',
      requester: 'u:noor', assignee: 'a:coder', assigner: 'x:automation', automationRule: 'deps-agent',
      reviewers: (s, head) => [approve('u:tom', hoursAfter(s, 3), head)],
    },
    {
      key: DEMO_OPEN_ITEM, summary: 'Check the IBAN country code against the beneficiary bank', day: '2026-10-27', repo: 'payments-core',
      requester: 'u:lea', assignee: 'a:coder', assigner: 'u:lea', state: 'OPEN',
      reviewers: (s, head) => [approve('u:lea', hoursAfter(s, 0.12), head)],
    },
  );
  return specs.map(chainFrom).sort((a, b) => (a.workItem.key < b.workItem.key ? -1 : 1));
}

/** The violations the demo bank contains, by work item, for tests and the judge guide. */
export const DEMO_EXPECTED: Record<string, { verdict: 'FAIL' | 'CANNOT_DETERMINE' | 'PASS'; rule: string | null; flags?: string[] }> = {
  'PAY-431': { verdict: 'FAIL', rule: 'AL-1' },
  'PAY-437': { verdict: 'FAIL', rule: 'AL-2' },
  'PAY-444': { verdict: 'FAIL', rule: 'AL-3' },
  'PAY-448': { verdict: 'PASS', rule: null, flags: ['RETRO_APPROVAL'] },
  'PAY-452': { verdict: 'FAIL', rule: 'AL-6' },
  'PAY-459': { verdict: 'FAIL', rule: 'AL-7' },
  'PAY-466': { verdict: 'FAIL', rule: 'AL-1' },
  'PAY-471': { verdict: 'CANNOT_DETERMINE', rule: 'AL-4' },
  'PAY-482': { verdict: 'FAIL', rule: 'AL-1' },
};
