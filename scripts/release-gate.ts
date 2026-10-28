/**
 * Creates a release workflow whose transition into "Ready for release" runs the Arm's Length validator,
 * puts it in a workflow scheme, and assigns the scheme to a company-managed project that has no work items yet.
 *
 *   JIRA_SITE=your-site.atlassian.net JIRA_EMAIL=you@example.com JIRA_API_TOKEN=... npm run release-gate -- PAY
 *
 * The validator is found through the project's workflow capabilities, so the script works for any installation
 * of the app (development, staging or production).
 */

const site = process.env.JIRA_SITE;
const email = process.env.JIRA_EMAIL;
const token = process.env.JIRA_API_TOKEN;
const projectKey = process.argv[2];
if (!site || !email || !token || !projectKey) {
  console.error('Usage: JIRA_SITE=... JIRA_EMAIL=... JIRA_API_TOKEN=... npm run release-gate -- <PROJECT_KEY>');
  process.exit(2);
}

const VALIDATOR = "Independent approval (Arm's Length)";
const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

async function jira<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://${site}${path}`, {
    method,
    headers: { Authorization: auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

type Category = 'TODO' | 'IN_PROGRESS' | 'DONE';
const STATUSES: [string, Category][] = [
  ['Backlog', 'TODO'],
  ['In Progress', 'IN_PROGRESS'],
  ['In Review', 'IN_PROGRESS'],
  ['Ready for release', 'IN_PROGRESS'],
  ['Done', 'DONE'],
];

async function statusId(name: string, category: Category): Promise<string> {
  const found = await jira<{ values: { id: string; name: string }[] }>('GET', `/rest/api/3/statuses/search?searchString=${encodeURIComponent(name)}&maxResults=50`);
  const hit = found.values.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (hit) return hit.id;
  const [made] = await jira<{ id: string }[]>('POST', '/rest/api/3/statuses', { scope: { type: 'GLOBAL' }, statuses: [{ name, statusCategory: category, description: '' }] });
  console.log(`Created status ${name}`);
  return made.id;
}

async function main() {
  const project = await jira<{ id: string; key: string; style?: string; issueTypes: { id: string; subtask?: boolean }[] }>('GET', `/rest/api/3/project/${projectKey}`);
  if (project.style && project.style !== 'classic') throw new Error(`${project.key} is team-managed. Workflow validators need a company-managed project.`);

  const issueType = project.issueTypes.find((t) => !t.subtask) ?? project.issueTypes[0];
  const caps = await jira<{ forgeRules: { ruleKey: string; name: string; id: string }[] }>(
    'GET',
    `/rest/api/3/workflows/capabilities?projectId=${project.id}&issueTypeId=${issueType.id}`,
  );
  const rule = caps.forgeRules.find((r) => r.name === VALIDATOR);
  if (!rule) throw new Error(`The validator "${VALIDATOR}" is not available in ${project.key}. Is Arm's Length installed on ${site}?`);

  const ids = Object.fromEntries(await Promise.all(STATUSES.map(async ([name, cat]) => [name, await statusId(name, cat)] as const)));
  const resolutions = await jira<{ id: string; name: string }[]>('GET', '/rest/api/3/resolution');
  const done = resolutions.find((r) => r.name === 'Done')?.id ?? resolutions[0]?.id;
  const setResolution = (value: string) => [{ ruleKey: 'system:update-field', parameters: { field: 'resolution', value, mode: '' } }];

  const name = `${project.key} release workflow`;
  const transitions = [
    { id: '1', type: 'INITIAL', toStatusReference: ids['Backlog'], links: [], name: 'Create', actions: [], validators: [], triggers: [], properties: {} },
    ...STATUSES.map(([to], i) => ({
      id: String(11 + 10 * i),
      type: 'GLOBAL',
      toStatusReference: ids[to],
      links: [],
      name: to,
      actions: setResolution(to === 'Done' && done ? done : ''),
      validators: to === 'Ready for release' ? [{ ruleKey: rule.ruleKey, parameters: { key: rule.id, config: '' } }] : [],
      triggers: [],
      properties: {},
    })),
  ];
  await jira('POST', '/rest/api/3/workflows/create', {
    scope: { type: 'GLOBAL' },
    statuses: STATUSES.map(([n, c]) => ({ id: ids[n], statusReference: ids[n], name: n, statusCategory: c })),
    workflows: [
      {
        name,
        description: 'Release gate: the move to Ready for release needs independent approval of every pull request.',
        startPointLayout: { x: -200, y: 0 },
        statuses: STATUSES.map(([n], k) => ({ statusReference: ids[n], layout: { x: 200 * k, y: 0 }, properties: {} })),
        transitions,
      },
    ],
  });
  console.log(`Created workflow "${name}" with the validator on "Ready for release"`);

  const scheme = await jira<{ id: number }>('POST', '/rest/api/3/workflowscheme', {
    name: `${project.key} release scheme`,
    description: "Every work type uses the release workflow gated by Arm's Length.",
    defaultWorkflow: name,
  });
  console.log(`Created workflow scheme ${scheme.id}`);

  const count = await jira<{ issues: unknown[] }>('POST', '/rest/api/3/search/jql', { jql: `project = ${project.key}`, maxResults: 1, fields: ['id'] });
  if (count.issues.length) {
    console.log(`${project.key} already has work items. Assign "${project.key} release scheme" in Project settings > Workflows, mapping each status.`);
    return;
  }
  await jira('PUT', '/rest/api/3/workflowscheme/project', { workflowSchemeId: String(scheme.id), projectId: project.id });
  console.log(`Assigned the scheme to ${project.key}. Load the demo bank into it, then move a work item to Ready for release.`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
