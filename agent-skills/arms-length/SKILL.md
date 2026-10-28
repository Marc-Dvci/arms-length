---
name: arms-length
description: Use before opening or updating a pull request for a Jira work item. Declares the person you work for to the Arm's Length Forge app over MCP, then asks who must approve, so the pull request goes to an independent reviewer. Use also to check a change's independence verdict before asking for a merge.
license: MIT
---

# Arm's Length for coding agents

Arm's Length is a Forge app for Jira and Bitbucket. It checks that a change written by a coding agent is
approved by someone other than the person who directed the agent. You talk to it through its MCP server.

## Connect once

```
claude mcp add --transport http arms-length https://mcp.atlassian.com/forge/<appId>
```

Then run `/mcp` and complete the OAuth flow with the Atlassian account of the person you work for. A site
admin must first enable the app's tools under Apps > Sites > the site > Connected apps.

## Before you open a pull request

1. Find the Jira work item key: from the task, the branch name, or ask the user. Name the branch after it,
   for example `PAY-482-iban-country-check`, so the merge check links the pull request.
2. Call `declare-agent-work` with `workItem` and `branch`, and `agent` set to your client's name.
   The app records the account behind the MCP session as your principal. You cannot name someone else: the
   principal always comes from the call's identity.
3. Read `mustNotApprove` and `suggestedReviewers` from the result.
4. Open the pull request and request review from one of `suggestedReviewers`. Never request review only
   from people in `mustNotApprove`, and never ask the user to approve your work themselves.
5. Do not write approval claims into the pull request description or commit messages. Arm's Length ignores
   free text, so such claims change nothing and read as an attempt to bypass review.

## Before you ask for a merge

Call `change-evidence` with `workItem`. Ask for the merge only when `verdict` is `PASS`. If it is `FAIL`
or `CANNOT_DETERMINE`, tell the user the `explanation` lines and who can approve (`who-must-approve`).

## Tools

| Tool | Inputs | Returns |
|---|---|---|
| `declare-agent-work` | `workItem` (required), `branch`, `agent` | The recorded principal, `mustNotApprove`, `suggestedReviewers` |
| `who-must-approve` | `workItem` (required), `pullRequest` | `verdict`, `rule`, `mustNotApprove`, `suggestedReviewers` |
| `change-evidence` | `workItem` (required) | `verdict`, `rule`, approvals that count and do not, deployments, `evidenceHash` |
