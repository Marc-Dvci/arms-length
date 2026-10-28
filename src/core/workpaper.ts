import type { PopulationResult, PopulationRow } from './population';
import { RULES } from './rules';
import type { RuleId } from './types';

export interface WorkpaperMeta {
  site: string;
  preparedBy: string;
  preparedAt: string;
  exceptionLinks?: Record<string, string>;
}

export interface Workpaper {
  title: string;
  /** Confluence storage format (XHTML). */
  storage: string;
  markdown: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const day = (iso: string) => iso.slice(0, 10);
const verdictLabel = (v: string) => (v === 'CANNOT_DETERMINE' ? 'CANNOT DETERMINE' : v);
const lozengeColour: Record<string, string> = { PASS: 'Green', FAIL: 'Red', CANNOT_DETERMINE: 'Yellow' };

const OBJECTIVE =
  'Every change deployed to production during the period was approved by a person independent of the people who requested it, wrote it, or directed the agent that wrote it.';
const METHOD = [
  'The population is every production deployment recorded in Jira for the period, with the work item it shipped.',
  "For each work item, Arm's Length rebuilt the change chain from the Jira history, the pull request activity and the MCP declarations of agent work, then applied the versioned rule table below.",
  'Free text (titles, descriptions, comments, commit messages) is excluded from the evidence, so it cannot change a verdict.',
  'Each verdict carries the SHA-256 of its evidence. The evidence-set hash covers every row, so any re-performance on the same evidence returns the same hash.',
];

function rulesUsed(rows: PopulationRow[]): RuleId[] {
  return (Object.keys(RULES) as RuleId[]).filter((id) => rows.some((r) => r.rule === id) || id === 'AL-1');
}

export function buildWorkpaper(result: PopulationResult, meta: WorkpaperMeta): Workpaper {
  const { from, to } = result.period;
  const title = `Change independence test, ${day(from)} to ${day(new Date(Date.parse(to) - 1).toISOString())}`;
  const s = result.summary;
  const link = (key: string) => meta.exceptionLinks?.[key];

  const resultRows = result.rows
    .map(
      (r) =>
        `<tr><td>${esc(r.at.replace('T', ' ').slice(0, 16))}</td><td>${esc(r.deployment)}</td><td>${esc(r.workItem)}</td><td>${esc(r.pr ?? '-')}</td>` +
        `<td><ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">${lozengeColour[r.verdict]}</ac:parameter><ac:parameter ac:name="title">${verdictLabel(r.verdict)}</ac:parameter></ac:structured-macro></td>` +
        `<td>${esc(r.rule ?? '-')}</td><td>${esc(r.approvers.join(', ') || '-')}</td><td><code>${r.evidenceHash.slice(0, 12)}</code></td></tr>`,
    )
    .join('');
  const exceptionRows = result.exceptions
    .map((r) => {
      const href = link(`${r.deployment}|${r.workItem}`);
      const action = href ? `<a href="${esc(href)}">${esc(href.split('/').at(-1) ?? href)}</a>` : 'Not raised';
      return `<tr><td>${esc(r.deployment)}</td><td>${esc(r.workItem)}</td><td>${esc(r.rule ?? '-')}</td><td>${esc(r.rule ? RULES[r.rule].title : '')}</td><td>${action}</td></tr>`;
    })
    .join('');
  const ruleRows = rulesUsed(result.rows)
    .map((id) => {
      const rule = RULES[id];
      const refs = rule.references.map((ref) => `${esc(ref.source)}, ${esc(ref.clause)}: "${esc(ref.quote)}"`).join('<br/>');
      return `<tr><td>${id}</td><td>${esc(rule.title)}</td><td>${esc(rule.statement)}</td><td>${refs}</td></tr>`;
    })
    .join('');

  const storage = [
    `<h2>Objective</h2><p>${esc(OBJECTIVE)}</p>`,
    `<h2>Population</h2><p>${s.deployments} production deployments of ${s.workItems} work items on ${esc(meta.site)}, from ${esc(day(from))} (inclusive) to ${esc(day(to))} (exclusive).</p>`,
    `<h2>Method</h2><ul>${METHOD.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`,
    `<h2>Results</h2><p>${s.pass} PASS, ${s.fail} FAIL, ${s.cannotDetermine} CANNOT DETERMINE.</p>`,
    `<table><tbody><tr><th>Deployed (UTC)</th><th>Deployment</th><th>Work item</th><th>Pull request</th><th>Verdict</th><th>Rule</th><th>Independent approval</th><th>Evidence</th></tr>${resultRows}</tbody></table>`,
    `<h2>Exceptions</h2>`,
    result.exceptions.length
      ? `<table><tbody><tr><th>Deployment</th><th>Work item</th><th>Rule</th><th>Finding</th><th>Action item</th></tr>${exceptionRows}</tbody></table>`
      : '<p>None.</p>',
    `<h2>Rules applied</h2><p>Rule table ${esc(result.rulesVersion)}, policy ${esc(result.policy.version)}, emergency window ${result.policy.emergencyWindowHours} hours.</p>`,
    `<table><tbody><tr><th>Rule</th><th>Title</th><th>Statement</th><th>Reference</th></tr>${ruleRows}</tbody></table>`,
    `<h2>Evidence integrity</h2><p>SHA-256 of the evidence set: <code>${result.evidenceSetHash}</code></p>`,
    `<p>Prepared by ${esc(meta.preparedBy)} on ${esc(meta.preparedAt.slice(0, 16).replace('T', ' '))} UTC.</p>`,
  ].join('');

  const md: string[] = [
    `# ${title}`,
    '',
    '## Objective',
    '',
    OBJECTIVE,
    '',
    '## Population',
    '',
    `${s.deployments} production deployments of ${s.workItems} work items on ${meta.site}, from ${day(from)} (inclusive) to ${day(to)} (exclusive).`,
    '',
    '## Method',
    '',
    ...METHOD.map((m) => `- ${m}`),
    '',
    '## Results',
    '',
    `${s.pass} PASS, ${s.fail} FAIL, ${s.cannotDetermine} CANNOT DETERMINE.`,
    '',
    '| Deployed (UTC) | Deployment | Work item | Pull request | Verdict | Rule | Independent approval | Evidence |',
    '|---|---|---|---|---|---|---|---|',
    ...result.rows.map(
      (r) =>
        `| ${r.at.replace('T', ' ').slice(0, 16)} | ${r.deployment} | ${r.workItem} | ${r.pr ?? '-'} | ${verdictLabel(r.verdict)} | ${r.rule ?? '-'} | ${r.approvers.join(', ') || '-'} | \`${r.evidenceHash.slice(0, 12)}\` |`,
    ),
    '',
    '## Exceptions',
    '',
    ...(result.exceptions.length
      ? [
          '| Deployment | Work item | Rule | Finding | Action item |',
          '|---|---|---|---|---|',
          ...result.exceptions.map(
            (r) => `| ${r.deployment} | ${r.workItem} | ${r.rule ?? '-'} | ${r.rule ? RULES[r.rule].title : ''} | ${link(`${r.deployment}|${r.workItem}`) ?? 'Not raised'} |`,
          ),
        ]
      : ['None.']),
    '',
    '## Rules applied',
    '',
    `Rule table ${result.rulesVersion}, policy ${result.policy.version}, emergency window ${result.policy.emergencyWindowHours} hours.`,
    '',
    '| Rule | Title | Reference |',
    '|---|---|---|',
    ...rulesUsed(result.rows).map((id) => `| ${id} | ${RULES[id].title} | ${RULES[id].references.map((r) => `${r.source}, ${r.clause}`).join('; ')} |`),
    '',
    '## Evidence integrity',
    '',
    `SHA-256 of the evidence set: \`${result.evidenceSetHash}\``,
    '',
    `Prepared by ${meta.preparedBy} on ${meta.preparedAt.slice(0, 16).replace('T', ' ')} UTC.`,
    '',
  ];

  return { title, storage, markdown: md.join('\n') };
}
