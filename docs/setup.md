# Setup

Every configuration step, from installation to a blocked release. The demo path (steps 1 to 3) needs only a
Jira site.

## 1. Install the Jira app

With the installation link: open it, choose your site, and approve the scopes. The app asks for Jira work items
and users, its own storage, Jira's development and deployment information, Confluence spaces and pages (for the
workpaper), and three read-only Teamwork Graph scopes (pull requests, users, work items).

From source:

```
npm install -g @forge/cli
forge login
npm ci
forge register
forge deploy
forge install --product jira --site <your-site>.atlassian.net
```

Confluence is optional. Without it, everything works except **Publish workpaper**.

## 2. Load the demo bank

**Settings (gear) > Marketplace apps**, then **Arm's Length** under **Apps** in the left navigation (also
reachable from **Open the settings** on the empty population page). Tab **Get started**: choose a project and
click **Load demo bank**. It creates 35 work items labelled
`arms-length-demo`, stores their synthetic change chains, and sends their pull requests and deployments to
Jira's development panel. **Remove demo data** deletes the chains and the development data; the work items stay.

## 3. Run the population test

**Apps > Change independence test**, period **Demo quarter (Q3 2026)**. To raise exceptions, choose a project
and click **Raise exceptions as work items**. To publish the workpaper, choose a Confluence space and click
**Publish workpaper**.

## 4. Register non-human accounts

Tab **Identities**. Jira app accounts count as agents by default. Register:

- the Bitbucket account your coding agent opens pull requests with, as **Service account**, acting for the agent;
- each automation actor that assigns work to agents, as **Automation**, with the person who owns its rules.

## 5. Gate the release transition in Jira

For a new company-managed project, one command creates the statuses Backlog, In Progress, In Review,
Ready for release and Done, a workflow whose transition into **Ready for release** runs the validator, and a
workflow scheme, then assigns the scheme to the project:

```
JIRA_SITE=<site>.atlassian.net JIRA_EMAIL=<email> JIRA_API_TOKEN=<token> npm run release-gate -- PAY
```

Run it before loading the demo bank, while the project has no work items. For an existing project:
**Project settings > Workflows**, edit the workflow, select the transition into your release status, add the
validator **Independent approval (Arm's Length)**, and publish.

The transition then succeeds only for work items whose verdict is PASS. A refused transition shows the reason,
for example "Arm's Length FAIL: payments-core#482 needs an approval from someone other than Léa Martin
(requested the change and directed Coding agent).

## 6. Pair Bitbucket

1. In Jira, tab **Get started**, click **Create the pairing secret**. Copy the endpoint and the secret.
2. Deploy and install the Bitbucket app: `cd bitbucket && forge register && forge deploy && forge install --product bitbucket`,
   choosing your workspace.
3. In Bitbucket: **Workspace settings > Arm's Length**, paste the endpoint and the secret, click **Pair with Jira**.
4. **Workspace settings > Custom merge checks**: enable custom merge checks, then enable
   **Independent approval (Arm's Length)** for the repository.

Name branches after their work item (`PAY-482-iban-country-check`), or put the key in the pull request title,
so each pull request links to its work item. On Bitbucket Free the check shows its result on the pull request
without blocking the merge; steps 5 and 7 block the release.

## 7. Gate the deployment in Pipelines

1. Copy [`pipelines/arms-length-gate.sh`](../pipelines/arms-length-gate.sh) into the repository.
2. **Repository settings > Repository variables**: add `ARMS_LENGTH_URL` (the endpoint) and `ARMS_LENGTH_SECRET`
   (the secret, marked **Secured**).
3. Call the script in the deployment step before the deploy command, as in
   [`pipelines/bitbucket-pipelines.example.yml`](../pipelines/bitbucket-pipelines.example.yml).

The step exits 1, and the deployment stops, unless every work item the commit ships is PASS. Allowed production
deployments are recorded and appear in the population test. Each attempt appears in the **Release gate** tab.

## 8. Connect a coding agent over MCP

1. A site admin enables the app's tools: **admin.atlassian.com > Apps > Sites > your site > Connected apps >
   Arm's Length > Tools**.
2. The app ID is the UUID at the end of `app.id` in `manifest.yml`.
3. In the agent's MCP client, add the remote server `https://mcp.atlassian.com/forge/<appId>` over HTTP and sign
   in with the developer's Atlassian account. For Claude Code:
   `claude mcp add --transport http arms-length https://mcp.atlassian.com/forge/<appId>`, then `/mcp` to sign in.
   An installation from a non-production environment names its tools with the environment as a suffix, for
   example `who-must-approve_development`.
4. Give the agent [`agent-skills/arms-length/SKILL.md`](../agent-skills/arms-length/SKILL.md).

## 9. Teamwork Graph

Reviewer suggestions read review history from the Teamwork Graph, and add the pull request snapshots the
Bitbucket app sends. The app runs one persisted Cypher query, owned by its app ID and executed as the signed-in
user with `customQuery`, so each user sees only reviews they may see:

```
MATCH (u:AtlassianUser)-[:atlassian_user_reviewed_pull_requests]->(pr:ExternalPullRequest) RETURN u, pr
```

Its key is `REVIEWS_QUERY_KEY` in [`src/forge/graph.ts`](../src/forge/graph.ts). A fork registered under another
app ID registers the same Cypher once (`POST /gateway/api/twg/cypher-queries` with its `appId`, from a signed-in
browser session, or through TWG Labs) and replaces the key.
