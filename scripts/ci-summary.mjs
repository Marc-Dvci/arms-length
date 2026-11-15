// Writes the test, coverage and evaluation figures as Markdown for the CI run page.
// Usage: node scripts/ci-summary.mjs >> "$GITHUB_STEP_SUMMARY"
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const pct = (m) => `${m.pct.toFixed(1)} %`;

const tests = read('coverage/tests.json');
const coverage = read('coverage/coverage-summary.json');
const scores = readFileSync('eval/reports/confusion.md', 'utf8')
  .split('\n')
  .filter((line) => line.startsWith('|'))
  .slice(0, 4);

const lines = [
  "## Arm's Length verification",
  '',
  '| Check | Result |',
  '|---|---|',
  `| Unit and integration tests, random order | ${tests.numPassedTests} of ${tests.numTotalTests} passed |`,
  `| Rule engine coverage, lines | ${pct(coverage.total.lines)} |`,
  `| Rule engine coverage, branches | ${pct(coverage.total.branches)} |`,
  '',
  '### Labelled and held-out change chains',
  '',
  ...scores,
  '',
  '### Coverage of `src/core`',
  '',
  '| Module | Lines | Branches | Functions |',
  '|---|---:|---:|---:|',
  ...Object.entries(coverage)
    .filter(([file]) => file !== 'total')
    .map(([file, m]) => `| ${basename(file)} | ${pct(m.lines)} | ${pct(m.branches)} | ${pct(m.functions)} |`),
];
console.log(lines.join('\n'));
