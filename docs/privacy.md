# Privacy policy

Arm's Length and Arm's Length for Bitbucket are Forge apps. They run on Atlassian's platform, and everything
they store stays in the Forge storage of the site or workspace that installed them. The developer has no
server, database or analytics service, and receives none of your data.

## What the apps read

- Jira work items, their history, reporters, assignees and labels, to build each change chain.
- Jira user names, to show who requested, directed, wrote and approved a change.
- Bitbucket pull requests, their commits, activity and approvals (Bitbucket app only).
- Confluence spaces, to let you choose where the workpaper is published.
- Review history from the Teamwork Graph, as the signed-in user, for reviewer suggestions.

## What the apps store, in Forge storage on your site

- The app's settings: policy, registered bot and automation accounts, and the pairing secret (in the Forge
  secret store).
- Declarations made by coding agents over MCP: the work item, the agent, and the Atlassian account ID of the
  person who made the call.
- Pull request snapshots sent by the Bitbucket app: account IDs and display names of authors and approvers,
  commit hashes, timestamps, and the work items linked to each pull request.
- Production deployments allowed by the Pipelines gate, and the release gate log.
- The verdict of each work item, as a Jira issue property, so it can be searched with JQL.
- The demo bank, when you load it: synthetic people and change chains.

## What the apps write to your site

- The verdict issue property on work items.
- Pull requests and deployments of the demo bank, in Jira's development panel.
- Work items for exceptions, and the Confluence workpaper, only when a user clicks the button that creates them,
  and in that user's name.

## Sharing

The Bitbucket app sends pull request snapshots only to the Jira site you pair it with, over a request signed
with your pairing secret. The apps send no data anywhere else.

## Retention and deletion

Data stays in Forge storage until you remove it. **Remove demo data** deletes the demo bank. Uninstalling an app
removes its access, and Atlassian deletes its Forge storage under the Forge platform's data retention rules.

## Contact

Questions and requests: https://github.com/Marc-Dvci/arms-length/issues
