import { RULES } from './rules';
import type { ChangeChain, ConflictedPerson, PrAssessment, Ref, Verdict } from './types';

export interface Explanation {
  headline: string;
  lines: string[];
}

export const nameOf = (chain: ChangeChain, ref: Ref) => chain.people[ref]?.name ?? ref;

export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

export function describeRoles(chain: ChangeChain, person: ConflictedPerson): string {
  const parts: string[] = [];
  if (person.roles.includes('requester')) parts.push('requested the change');
  if (person.roles.includes('implementer')) parts.push('wrote part of it');
  if (person.roles.includes('principal')) parts.push(`directed ${listNames(person.directed.map((a) => nameOf(chain, a)))}`);
  return listNames(parts);
}

/** One sentence per pull request, written for the person about to approve or merge it. */
export function explainPullRequest(chain: ChangeChain, pr: PrAssessment): string {
  const conflicted = pr.conflicted.map((c) => `${nameOf(chain, c.ref)} (${describeRoles(chain, c)})`);
  if (pr.verdict === 'PASS') {
    const who = listNames(pr.counted.map((c) => nameOf(chain, c.ref)));
    const retro = pr.flags.includes('RETRO_APPROVAL') ? ' after the emergency merge, inside the window' : '';
    return `${pr.pr}: independent approval by ${who}${retro}.`;
  }
  const finding = pr.findings.find((f) => f.rule === pr.rule) ?? pr.findings[0];
  switch (pr.rule) {
    case 'AL-1':
      return `${pr.pr} needs an approval from someone other than ${listNames(conflicted)}.`;
    case 'AL-2': {
      const stale = listNames(pr.ignored.filter((i) => i.reason === 'stale').map((i) => nameOf(chain, i.ref)));
      return `${pr.pr}: ${stale} approved an earlier commit. The final commit ${pr.head} needs a new approval.`;
    }
    case 'AL-3': {
      const bots = listNames(pr.ignored.filter((i) => i.reason === 'non_human').map((i) => nameOf(chain, i.ref)));
      return `${pr.pr}: the approval by ${bots} does not count. It needs a person other than ${listNames(conflicted)}.`;
    }
    case 'AL-6': {
      const merged = chain.pullRequests.find((p) => p.id === pr.pr)?.mergedAt;
      const late = pr.ignored
        .filter((i) => i.reason === 'after_merge')
        .map((i) => {
          const hours = merged ? Math.round((Date.parse(i.at) - Date.parse(merged)) / 3_600_000) : null;
          return hours === null ? nameOf(chain, i.ref) : `${nameOf(chain, i.ref)} (${hours} h after the merge)`;
        });
      const tail = chain.emergency ? 'outside the emergency window' : 'and no emergency was declared';
      return `${pr.pr}: the only independent approval came after the merge, ${tail}: ${listNames(late)}.`;
    }
    case 'AL-4': {
      const parts = pr.findings
        .filter((f) => f.rule === 'AL-4')
        .map((f) => {
          const agents = listNames((f.people ?? []).map((r) => nameOf(chain, r)));
          return f.message.startsWith('An automation rule')
            ? `an automation rule assigned ${agents} and the rule has no known owner`
            : `nobody is on record as having directed ${agents}`;
        });
      return `${pr.pr}: ${listNames(parts)}, so independence cannot be confirmed.`;
    }
    default:
      return `${pr.pr}: ${finding?.message ?? RULES[pr.rule ?? 'AL-5'].statement}`;
  }
}

export function explain(chain: ChangeChain, v: Verdict): Explanation {
  const lines = v.pullRequests.map((pr) => explainPullRequest(chain, pr));
  for (const d of v.deployments) {
    if (d.rule === 'AL-7') lines.push(`Production deployment ${d.id} ran commit ${d.commit}, which no merged pull request of ${v.workItem} contains.`);
  }
  for (const f of v.findings) if (!f.pr && !f.deployment) lines.push(f.message);
  const rule = v.rule ? RULES[v.rule] : null;
  const headline =
    v.verdict === 'PASS'
      ? `${v.workItem} has independent approval on every pull request.`
      : v.verdict === 'FAIL'
        ? `${v.workItem} fails ${v.rule}: ${rule!.title.toLowerCase()}.`
        : `${v.workItem} cannot be decided (${v.rule}: ${rule!.title.toLowerCase()}).`;
  return { headline, lines };
}

/** Short text for the Bitbucket merge check and the Pipelines gate. */
export function gateMessage(chain: ChangeChain, v: Verdict, prId?: string): string {
  const pr = prId ? v.pullRequests.find((p) => p.pr === prId) : undefined;
  const text = pr ? explainPullRequest(chain, pr) : explain(chain, v).lines[0] ?? explain(chain, v).headline;
  const verdict = pr?.verdict ?? v.verdict;
  const label = verdict === 'CANNOT_DETERMINE' ? 'CANNOT DETERMINE' : verdict;
  return `Arm's Length ${label}: ${text}`.slice(0, 480);
}
