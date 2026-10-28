/**
 * Deterministic demo with no credentials: the PAY-482 scene and the quarter-end population test,
 * run on the demo bank by the same rule engine the Forge app uses.
 *
 *   npm run demo            print the walkthrough
 *   npm run demo -- --write also write docs/demo-workpaper.md
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate } from '../src/core/evaluate';
import { explain, gateMessage } from '../src/core/explain';
import { runPopulationTest } from '../src/core/population';
import { suggestReviewers } from '../src/core/reviewers';
import { buildWorkpaper } from '../src/core/workpaper';
import { buildDemoBank, DEMO_OPEN_ITEM, DEMO_PEOPLE, DEMO_QUARTER, DEMO_ROLES } from '../src/demo/bank';

const bank = buildDemoBank();
const say = (s = '') => process.stdout.write(`${s}\n`);
const rule = () => say('-'.repeat(72));

// 1. The scene.
const scene = structuredClone(bank.find((c) => c.workItem.key === DEMO_OPEN_ITEM)!);
const pr = scene.pullRequests[0];
say(`${DEMO_OPEN_ITEM}: ${scene.workItem.summary}`);
say(`Léa Martin requested it and assigned it to the Coding agent. coder-bot opened ${pr.id}. Léa approved it.`);
rule();
let v = evaluate(scene);
say(gateMessage(scene, v, pr.id));

// 2. Who can approve.
const history = bank.flatMap((c) => c.pullRequests.flatMap((p) => p.reviews.filter((r) => r.action === 'approved').map((r) => ({ reviewer: r.by, repo: p.repo, pr: p.id, at: r.at }))));
const suggestions = suggestReviewers({
  history,
  repo: pr.repo,
  exclude: v.pullRequests[0].conflicted.map((c) => c.ref),
  kindOf: (r) => scene.people[r]?.kind,
  now: '2026-10-28T09:00:00Z',
});
say(`Independent reviewers for ${pr.repo}: ${suggestions.map((s) => `${scene.people[s.ref].name} (${s.reviews} reviews in 90 days)`).join(', ')}`);

// 3. Tom approves the head commit.
pr.reviews.push({ by: suggestions[0].ref, action: 'approved', at: '2026-10-28T09:30:00Z', commit: pr.commits.at(-1)!.hash });
v = evaluate(scene);
say(gateMessage(scene, v, pr.id));
rule();

// 4. The quarter-end population test.
const result = runPopulationTest(bank, DEMO_QUARTER.from, DEMO_QUARTER.to);
const s = result.summary;
say(`Population test ${DEMO_QUARTER.from.slice(0, 10)} to ${DEMO_QUARTER.to.slice(0, 10)}: ${s.deployments} production deployments, ${s.pass} PASS, ${s.fail} FAIL, ${s.cannotDetermine} CANNOT DETERMINE`);
for (const e of result.exceptions) {
  const chain = bank.find((c) => c.workItem.key === e.workItem)!;
  say(`  ${e.workItem} ${e.rule}  ${explain(chain, evaluate(chain)).lines.at(-1)}`);
}
say(`Evidence-set SHA-256 ${result.evidenceSetHash}`);

if (process.argv.includes('--write')) {
  const wp = buildWorkpaper(result, { site: 'demo bank', preparedBy: 'Noor Haddad', preparedAt: '2026-10-05T09:00:00Z' });
  const out = join(__dirname, '..', 'docs', 'demo-workpaper.md');
  writeFileSync(out, wp.markdown);
  writeFileSync(join(__dirname, '..', 'docs', 'demo-bank.md'), demoBankDoc());
  say('Workpaper written to docs/demo-workpaper.md, reference to docs/demo-bank.md');
}

/** The page the demo pull requests and deployments link to from Jira's development panel. */
function demoBankDoc(): string {
  const name = (r: string) => DEMO_PEOPLE[r]?.name ?? r;
  const lines = [
    '# Demo bank',
    '',
    "Synthetic data loaded by Arm's Length's \"Load demo bank\" button. Every person, agent, repository, pull request and",
    'deployment below is fictional. The rule engine evaluates these chains exactly as it evaluates live ones.',
    '',
    '## People',
    '',
    '| Name | Role |',
    '|---|---|',
    ...Object.entries(DEMO_ROLES).map(([r, role]) => `| ${name(r)} | ${role} |`),
    '',
    'Agents: Coding agent (opens pull requests as coder-bot), Fix agent (fixer-bot), Test agent (tester-bot). review-bot is a',
    'service account that approves automatically. Automation for Jira runs two rules: `triage-agent`, owned by Sam Okafor, and',
    '`deps-agent`, with no recorded owner.',
    '',
    '## Pipelines',
    '',
    'Production deployments run the `payments-release` pipeline. Marco Bianchi triggered prod-459 by hand, with a hotfix commit that no pull request contains.',
  ];
  const repos = [...new Set(bank.flatMap((c) => c.pullRequests.map((p) => p.repo)))].sort();
  for (const repo of repos) {
    lines.push('', `## ${repo}`, '');
    for (const c of bank) {
      for (const p of c.pullRequests.filter((x) => x.repo === repo)) {
        const v = evaluate(c).pullRequests.find((x) => x.pr === p.id)!;
        lines.push(`### ${repo} ${p.id.split('#')[1]}`, '');
        lines.push(`${c.workItem.key}: ${c.workItem.summary}. Opened by ${name(p.author)} from \`${p.sourceBranch}\`, ${p.state.toLowerCase()}.`);
        lines.push(`Reviews: ${p.reviews.map((r) => `${name(r.by)} ${r.action.replace('_', ' ')} ${r.at.slice(0, 16).replace('T', ' ')}`).join('; ') || 'none'}. Verdict ${v.verdict.replace('_', ' ')}${v.rule ? ` (${v.rule})` : ''}.`, '');
      }
    }
  }
  lines.push('## Deployments', '');
  for (const c of bank) {
    for (const d of c.deployments) lines.push(`### ${d.id}`, '', `${c.workItem.key}, ${d.env}, ${d.at.slice(0, 16).replace('T', ' ')} UTC, commit \`${d.commit}\`.`, '');
  }
  return lines.join('\n');
}
