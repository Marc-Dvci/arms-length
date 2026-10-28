import { gateMessage } from '../core/explain';
import { assessIssue } from './chain';

interface ValidatorArgs {
  issue: { key: string; id?: string };
  transition?: { from?: { id: string }; to?: { id: string } };
}

/**
 * Jira workflow validator for the release transition. Only PASS lets the work item through;
 * CANNOT DETERMINE blocks too, because missing evidence is not approval.
 */
export async function validate(args: ValidatorArgs): Promise<{ result: boolean; errorMessage?: string }> {
  try {
    const a = await assessIssue(args.issue.key);
    if (a.verdict.verdict === 'PASS') return { result: true };
    return { result: false, errorMessage: gateMessage(a.chain, a.verdict).slice(0, 300) };
  } catch (e) {
    return { result: false, errorMessage: `Arm's Length could not evaluate ${args.issue.key}: ${(e as Error).message}`.slice(0, 300) };
  }
}
