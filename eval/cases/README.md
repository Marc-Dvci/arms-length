# Change-chain case sets

Two labelled sets of change chains. Both were written and labelled before the rule engine existed, and the
held-out set is never used to tune the rules.

| File | Cases | Use |
|---|---|---|
| `labelled.json` | development set | Scored on every change to the rules |
| `heldout.json` | held-out set | Scored once per release, never tuned on |

`npm run eval` scores both sets and writes `eval/reports/confusion.md`.

## Labelling policy (independence policy v1)

A change passes when every pull request in it carries at least one **current, independent approval**, and
every production deployment of it traces to such a pull request.

**Conflicted people** for a pull request:

- the **requester**: the reporter of the work item;
- the **implementers**: every person who authored a commit or the pull request;
- the **principals**: every person who directed a non-human author of the change. A person directs an agent
  when they assign the work item to that agent, when they declare agent work on the work item through the MCP
  tool `declare_agent_work` (the identity comes from the call, not from its inputs), or when they own the
  automation rule that assigned the agent.
- A principal is conflicted only for changes that contain work by the agent they directed. A declaration names
  a branch and applies to pull requests from that branch, or to every pull request of the work item when it
  names none. A declaration has no agent of its own, so it makes its declarer a principal of every non-human
  author on those pull requests.

**An approval counts** when all of these hold:

- it comes from a person (agents, service accounts and automation never count);
- the approver is not conflicted;
- it covers the final commit of the pull request (later commits make it stale);
- it was not withdrawn;
- it was given before the merge, or after the merge of a declared emergency change within the policy window
  (72 hours by default), which passes with the flag `RETRO_APPROVAL`.

**Verdicts.** `FAIL` when a rule is broken on the evidence available. `CANNOT_DETERMINE` when the evidence
needed to decide is missing: Jira or repository history unavailable, agent work with no known principal, or a
work item with no linked change. `PASS` otherwise. `FAIL` takes precedence over `CANNOT_DETERMINE`.
Release gates treat `CANNOT_DETERMINE` as not passing.

**Rule IDs used in labels.** When several rules apply, the label names the most specific one, in this order:
AL-7, AL-6, AL-2, AL-3, AL-1 for failures, then AL-5, AL-4, AL-8 for missing evidence.

| ID | Outcome when broken | Meaning |
|---|---|---|
| AL-1 | FAIL | No approval from a person outside the conflicted set |
| AL-2 | FAIL | The only independent approval predates later commits |
| AL-3 | FAIL | The only approvals from outside the conflicted set come from non-human accounts |
| AL-4 | CANNOT_DETERMINE | A non-human author's work has no known principal |
| AL-5 | CANNOT_DETERMINE | Jira or repository history is unavailable |
| AL-6 | FAIL | The independent approval came after the merge, without an emergency or outside its window |
| AL-7 | FAIL | A production deployment does not trace to a merged pull request of the work item |
| AL-8 | CANNOT_DETERMINE | The work item has no linked pull request |

**Untrusted text.** Pull request titles and descriptions, comments and commit messages never change a verdict.

**Identity.** People are matched by account reference, never by display name.

## Case format

```json
{
  "id": "D01",
  "title": "Human author, independent reviewer",
  "expected": { "verdict": "PASS", "rule": null, "flags": [] },
  "chain": {
    "workItem": { "key": "PAY-101", "requester": "u:sam" },
    "people": { "u:extra": { "name": "Extra Person", "kind": "human" } },
    "assignments": [{ "at": "2026-09-01T09:00:00Z", "by": "u:lea", "to": "a:coder" }],
    "declarations": [{ "at": "2026-09-01T09:01:00Z", "principal": "u:lea", "branch": "PAY-101-fix" }],
    "automationRules": { "rule-7": { "owner": "u:sam" } },
    "pullRequests": [{
      "id": "payments-core#12", "repo": "payments-core", "title": "Fix rounding", "description": "",
      "author": "b:coder-bot", "sourceBranch": "PAY-101-fix", "state": "MERGED",
      "createdAt": "...", "mergedAt": "...", "mergedBy": "u:lea", "mergeCommit": "m1",
      "commits": [{ "hash": "c1", "author": "b:coder-bot", "at": "..." }],
      "reviews": [{ "by": "u:tom", "action": "approved", "at": "...", "commit": "c1" }],
      "comments": []
    }],
    "deployments": [{ "id": "dep-1", "env": "production", "at": "...", "commit": "m1", "triggeredBy": "pipeline" }],
    "emergency": { "declaredAt": "...", "declaredBy": "u:sam" },
    "history": { "jira": "complete", "scm": "complete" }
  }
}
```

- `people` is merged over the file's shared `cast`. `kind` is `human`, `agent`, `service` or `automation`.
  A `service` account may carry `actsAs` (the agent it opens pull requests for).
- `assignments[].via.automationRule` marks an assignment made by an automation rule; its principal is the
  rule's `owner` in `automationRules` (null when unknown).
- `reviews[].commit` is the pull request's head commit at the moment of the review.
- `reviews[].action` is `approved`, `unapproved` (approval withdrawn) or `changes_requested`.
- `history` defaults to `complete` for both sources when absent.
- `expected.rule` is the primary rule the verdict rests on, using the IDs of the rule table (`AL-1` to `AL-8`).
