import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate } from '../src/core/evaluate';
import { RULES_VERSION } from '../src/core/rules';
import type { VerdictValue } from '../src/core/types';
import { loadCases, type LabelledCase } from './load';

const here = __dirname;
const CLASSES: VerdictValue[] = ['PASS', 'FAIL', 'CANNOT_DETERMINE'];

export interface SetScore {
  set: string;
  total: number;
  verdictCorrect: number;
  ruleCorrect: number;
  flagsCorrect: number;
  matrix: Record<VerdictValue, Record<VerdictValue, number>>;
  misses: { id: string; title: string; expected: string; got: string }[];
}

export function score(set: string, cases: LabelledCase[]): SetScore {
  const matrix = Object.fromEntries(CLASSES.map((e) => [e, Object.fromEntries(CLASSES.map((g) => [g, 0]))])) as SetScore['matrix'];
  const out: SetScore = { set, total: cases.length, verdictCorrect: 0, ruleCorrect: 0, flagsCorrect: 0, matrix, misses: [] };
  for (const c of cases) {
    const v = evaluate(c.chain);
    matrix[c.expected.verdict][v.verdict] += 1;
    const verdictOk = v.verdict === c.expected.verdict;
    const ruleOk = v.rule === c.expected.rule;
    const flagsOk = [...v.flags].sort().join(',') === [...c.expected.flags].sort().join(',');
    if (verdictOk) out.verdictCorrect += 1;
    if (ruleOk) out.ruleCorrect += 1;
    if (flagsOk) out.flagsCorrect += 1;
    if (!verdictOk || !ruleOk || !flagsOk) {
      out.misses.push({
        id: c.id,
        title: c.title,
        expected: `${c.expected.verdict} ${c.expected.rule ?? '-'} [${c.expected.flags.join(',')}]`,
        got: `${v.verdict} ${v.rule ?? '-'} [${v.flags.join(',')}]`,
      });
    }
  }
  return out;
}

function table(s: SetScore): string {
  const short: Record<VerdictValue, string> = { PASS: 'PASS', FAIL: 'FAIL', CANNOT_DETERMINE: 'CANNOT DETERMINE' };
  const lines = [
    `| Labelled ↓ Returned → | ${CLASSES.map((c) => short[c]).join(' | ')} |`,
    `|---|${CLASSES.map(() => '---:').join('|')}|`,
    ...CLASSES.map((e) => `| ${short[e]} | ${CLASSES.map((g) => s.matrix[e][g]).join(' | ')} |`),
  ];
  return lines.join('\n');
}

export function report(scores: SetScore[]): string {
  const parts = [
    '# Rule engine scores',
    '',
    `Rule table ${RULES_VERSION}, policy independence-v1. Reproduce with \`npm run eval\`.`,
    '',
    '| Set | Cases | Verdict correct | Primary rule correct | Flags correct |',
    '|---|---:|---:|---:|---:|',
    ...scores.map((s) => `| ${s.set} | ${s.total} | ${s.verdictCorrect} | ${s.ruleCorrect} | ${s.flagsCorrect} |`),
  ];
  for (const s of scores) {
    parts.push('', `## ${s.set}`, '', table(s));
    if (s.misses.length) {
      parts.push('', '| Case | Title | Labelled | Returned |', '|---|---|---|---|');
      for (const m of s.misses) parts.push(`| ${m.id} | ${m.title} | ${m.expected} | ${m.got} |`);
    }
  }
  return parts.join('\n') + '\n';
}

if (require.main === module) {
  const scores = ['labelled.json', 'heldout.json'].map((f) => {
    const { set, cases } = loadCases(join(here, 'cases', f));
    return score(set, cases);
  });
  const md = report(scores);
  mkdirSync(join(here, 'reports'), { recursive: true });
  writeFileSync(join(here, 'reports', 'confusion.md'), md);
  process.stdout.write(md);
  if (scores.some((s) => s.misses.length)) process.exitCode = 1;
}
