---
name: independence-policy
description: Explains and applies the Arm's Length independence policy for code changes, including changes written by coding agents. Use it to answer who may approve a work item, why an approval does not count, what a verdict or rule ID means, how to run the quarterly change independence test, and how to draft a management response to an exception.
compatibility: Arm's Length Forge app for Jira
license: MIT
allowed-tools: who-must-approve change-evidence population-test post-management-response
---

# Independence policy

## The rule in one sentence

Each pull request needs an approval from a person who did not request the change, did not write it, and did
not direct the agent that wrote it, given on the final commit and before the merge.

## Who is conflicted

- **Requester**: the reporter of the work item.
- **Implementers**: everyone who authored a commit or the pull request.
- **Principals**: everyone who directed an agent whose work is in the change. A person directs an agent by
  assigning the work item to it, by declaring agent work through the MCP tool `declare-agent-work` (the
  identity comes from the call), or by owning the automation rule that assigned it.

## Rule IDs

| ID | Title | Outcome |
|---|---|---|
| AL-1 | Independent approval | FAIL |
| AL-2 | Approval covers the final commit | FAIL |
| AL-3 | Approvers are people | FAIL |
| AL-4 | Agent work has a known principal | CANNOT DETERMINE |
| AL-5 | Complete history | CANNOT DETERMINE |
| AL-6 | Approval before the merge (emergency exception within the window) | FAIL |
| AL-7 | Production traces to an approved change | FAIL |
| AL-8 | Linked change evidence | CANNOT DETERMINE |

CANNOT DETERMINE blocks a release like FAIL: missing evidence is not approval.

## Which tool to call

- "Who should approve PAY-482?" → `who-must-approve` with `workItem`. Answer with `suggestedReviewers` (name,
  reviews in the repository) and `mustNotApprove` (name, reason).
- "Why did this fail?" or "Explain this to an auditor" → `change-evidence`. Lead with `verdict` and `rule`,
  then `explanation`, then the rule's `references`. Give `evidenceHash` when an auditor asks for evidence.
- "How did we do last quarter?" → `population-test` with `from` and `to` as ISO dates, or none for the last
  full quarter. Report `summary`, the `exceptions` with rule IDs, and `evidenceSetHash`.
- "Draft a management response" → `change-evidence` first, then draft. Use only names, numbers and dates that
  appear in the evidence. After the user confirms, call `post-management-response`. If it returns
  `posted: false`, fix exactly the `problems` it lists.

## Reading results

- `ignoredApprovals[].reason`: `conflicted` (the approver is in the chain), `stale` (an earlier commit),
  `after_merge` (approved after the merge without a valid emergency), `non_human` (a bot or agent).
- `flags` may contain `RETRO_APPROVAL`: an emergency change approved after the merge, inside the window.
- `source: demo` means the work item belongs to the demo bank, whose people are synthetic.

## Errors

- `error: Give a Jira work item key such as PAY-482.` Ask the user for the key.
- Any other `error`: report it as it is and suggest refreshing the Arm's Length panel on the work item.
