import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Button,
  Code,
  CodeBlock,
  DynamicTable,
  Heading,
  Inline,
  Lozenge,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  Textfield,
  User,
  UserPicker,
} from '@forge/react';
import type { AppConfig, DemoIndex, IdentityOverride } from '../forge/store';
import type { Kind } from '../core/types';
import { Field } from './field';
import { call } from './shared';

type Admin = {
  config: AppConfig;
  demo: DemoIndex | null;
  gateLog: { at: string; repo?: string; commit?: string; environment?: string; allow?: boolean; message?: string }[];
  paired: boolean;
  webTriggerUrl: string | null;
  projects: { key: string; name: string }[];
};
type Option = { label: string; value: string };

const KINDS: Option[] = [
  { label: 'Agent', value: 'agent' },
  { label: 'Service account (opens pull requests for an agent)', value: 'service' },
  { label: 'Automation (runs rules owned by a person)', value: 'automation' },
  { label: 'Person', value: 'human' },
];

function App() {
  const [data, setData] = useState<Admin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [project, setProject] = useState<Option | null>(null);
  const [draft, setDraft] = useState<{ account?: string; kind?: Kind; actsAs?: string; owner?: string }>({});
  const [policy, setPolicy] = useState<{ window: string; envs: string; label: string; lookback: string } | null>(null);

  const load = async () => {
    const d = await call<Admin>('admin');
    setData(d);
    setPolicy({
      window: String(d.config.policy.emergencyWindowHours),
      envs: d.config.policy.productionEnvironments.join(', '),
      label: d.config.emergencyLabel,
      lookback: String(d.config.reviewerLookbackDays),
    });
  };

  const act = async (name: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await load();
      if (done) setNotice(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, []);

  if (!data || !policy) return error ? <SectionMessage appearance="error">{<Text>{error}</Text>}</SectionMessage> : <Spinner label="Loading settings" />;

  const saveIdentities = (identities: Record<string, IdentityOverride>) => act('identities', () => call('saveConfig', { config: { identities } }), 'Identities saved.');
  const identityRows = Object.entries(data.config.identities).map(([ref, o]) => ({
    key: ref,
    cells: [
      { key: 'who', content: <User accountId={ref} /> },
      { key: 'kind', content: <Lozenge>{o.kind}</Lozenge> },
      { key: 'actsAs', content: o.actsAs ? <User accountId={o.actsAs} /> : '-' },
      { key: 'owner', content: o.owner ? <User accountId={o.owner} /> : o.kind === 'automation' ? 'Unknown owner' : '-' },
      {
        key: 'remove',
        content: (
          <Button
            appearance="subtle"
            onClick={() => {
              const next = { ...data.config.identities };
              delete next[ref];
              saveIdentities(next);
            }}
          >
            Remove
          </Button>
        ),
      },
    ],
  }));

  return (
    <Stack space="space.300">
      <Text>Independent approval for agent-written code: who may approve, what gates the release, and the demo bank.</Text>
      {notice ? (
        <SectionMessage appearance="success">
          <Text>{notice}</Text>
        </SectionMessage>
      ) : null}
      {error ? (
        <SectionMessage appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      ) : null}

      <Tabs id="settings">
        <TabList>
          <Tab>Get started</Tab>
          <Tab>Identities</Tab>
          <Tab>Policy</Tab>
          <Tab>Release gate</Tab>
        </TabList>

        <TabPanel>
          <Stack space="space.300">
            <Stack space="space.100">
              <Heading size="medium">Demo bank</Heading>
              {data.demo ? (
                <Stack space="space.100">
                  <Text>{`Loaded into ${data.demo.projectKey} on ${data.demo.loadedAt.slice(0, 16).replace('T', ' ')} UTC: ${Object.keys(data.demo.keys).length} work items.`}</Text>
                  <Text>{`The scene: open ${data.demo.keys['PAY-482']} (demo PAY-482). Its only approval comes from the person who requested the change and directed the coding agent.`}</Text>
                  {data.demo.devInfo && data.demo.devInfo !== 'sent' ? <Text color="color.text.subtle">{`Development panel: ${data.demo.devInfo}. Verdicts do not depend on it.`}</Text> : null}
                  <Inline space="space.100">
                    {data.demo.devInfo && data.demo.devInfo !== 'sent' ? (
                      <Button isDisabled={!!busy} onClick={() => act('resend', () => call('resendDevInfo'), 'Development data sent.')}>
                        Send development data again
                      </Button>
                    ) : null}
                    <Button appearance="warning" isDisabled={!!busy} onClick={() => act('remove', () => call('removeDemo'), 'Demo bank removed. The work items stay in the project.')}>
                      Remove demo data
                    </Button>
                  </Inline>
                </Stack>
              ) : (
                <Stack space="space.100">
                  <Text>
                    Creates 35 work items in the project you choose, with one quarter of synthetic change chains: people, three coding agents, pull requests and production deployments, including six known violations.
                  </Text>
                  <Inline space="space.200" alignBlock="end" shouldWrap>
                    <Field id="demo-project" label="Project">
                      <Select inputId="demo-project" options={data.projects.map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }))} value={project ?? undefined} onChange={(o: Option) => setProject(o)} />
                    </Field>
                    <Button appearance="primary" isDisabled={!project || !!busy} onClick={() => act('demo', () => call('loadDemo', { projectKey: project!.value }), 'Demo bank loaded.')}>
                      {busy === 'demo' ? 'Loading the demo bank' : 'Load demo bank'}
                    </Button>
                  </Inline>
                </Stack>
              )}
            </Stack>

            <Stack space="space.100">
              <Heading size="medium">Pair Bitbucket and Pipelines</Heading>
              <Text>The Bitbucket app sends each pull request's approvals here, and the release step asks for the verdict of the commit it deploys. Both sign their requests with the pairing secret.</Text>
              <Inline space="space.100" alignBlock="center">
                <Text>Status</Text>
                <Lozenge appearance={data.paired ? 'success' : 'moved'}>{data.paired ? 'Paired' : 'Not paired'}</Lozenge>
              </Inline>
              {data.webTriggerUrl ? (
                <Stack space="space.050">
                  <Text>Endpoint</Text>
                  <Code>{data.webTriggerUrl}</Code>
                </Stack>
              ) : null}
              <Inline space="space.100">
                <Button
                  isDisabled={!!busy}
                  onClick={() =>
                    act('pair', async () => {
                      const out = await call<{ secret: string }>('pair');
                      setSecret(out.secret);
                    })
                  }
                >
                  {data.paired ? 'Rotate the pairing secret' : 'Create the pairing secret'}
                </Button>
              </Inline>
              {secret ? (
                <SectionMessage appearance="warning" title="Copy the secret now. It is shown once.">
                  <Stack space="space.100">
                    <CodeBlock language="text" text={secret} />
                    <Text>Paste it with the endpoint into the Arm's Length settings of your Bitbucket workspace, and into the secured repository variable ARMS_LENGTH_SECRET.</Text>
                  </Stack>
                </SectionMessage>
              ) : null}
            </Stack>

            <Stack space="space.100">
              <Heading size="medium">Gate the release transition</Heading>
              <Text>In the workflow of a company-managed project, add the validator "Independent approval (Arm's Length)" to the transition into your release status. It lets a work item through only when its verdict is PASS.</Text>
            </Stack>
          </Stack>
        </TabPanel>

        <TabPanel>
          <Stack space="space.200">
            <Text>
              Jira app accounts count as agents. Register the other non-human accounts here: the Bitbucket bot that opens pull requests for an agent, and automation actors with the person who owns their rules.
            </Text>
            {identityRows.length ? (
              <DynamicTable
                head={{ cells: [{ key: 'who', content: 'Account' }, { key: 'kind', content: 'Kind' }, { key: 'actsAs', content: 'Acts for agent' }, { key: 'owner', content: 'Rule owner' }, { key: 'remove', content: '' }] }}
                rows={identityRows}
              />
            ) : (
              <Text color="color.text.subtle">No accounts registered yet.</Text>
            )}
            <Inline space="space.200" alignBlock="end" shouldWrap>
              <UserPicker label="Account" name="account" onChange={(u) => setDraft({ ...draft, account: (u as { id?: string })?.id })} />
              <Field id="kind" label="Kind">
                <Select inputId="kind" options={KINDS} onChange={(o: Option) => setDraft({ ...draft, kind: o.value as Kind })} />
              </Field>
              {draft.kind === 'service' ? <UserPicker label="Acts for agent" name="actsAs" onChange={(u) => setDraft({ ...draft, actsAs: (u as { id?: string })?.id })} /> : null}
              {draft.kind === 'automation' ? <UserPicker label="Rule owner" name="owner" onChange={(u) => setDraft({ ...draft, owner: (u as { id?: string })?.id })} /> : null}
              <Button
                isDisabled={!draft.account || !draft.kind || !!busy}
                onClick={() =>
                  saveIdentities({
                    ...data.config.identities,
                    [draft.account!]: {
                      kind: draft.kind!,
                      ...(draft.actsAs ? { actsAs: draft.actsAs } : {}),
                      ...(draft.kind === 'automation' ? { owner: draft.owner ?? null } : {}),
                    },
                  })
                }
              >
                Add
              </Button>
            </Inline>
          </Stack>
        </TabPanel>

        <TabPanel>
          <Stack space="space.200">
            <Text>{`Policy ${data.config.policy.version}. Changes apply to every verdict from the next evaluation.`}</Text>
            <Inline space="space.200" shouldWrap>
              <Field id="window" label="Emergency approval window (hours)">
                <Textfield id="window" type="number" value={policy.window} onChange={(e) => setPolicy({ ...policy, window: e.target.value })} />
              </Field>
              <Field id="envs" label="Production environments">
                <Textfield id="envs" value={policy.envs} onChange={(e) => setPolicy({ ...policy, envs: e.target.value })} />
              </Field>
              <Field id="label" label="Emergency label">
                <Textfield id="label" value={policy.label} onChange={(e) => setPolicy({ ...policy, label: e.target.value })} />
              </Field>
              <Field id="lookback" label="Reviewer history (days)">
                <Textfield id="lookback" type="number" value={policy.lookback} onChange={(e) => setPolicy({ ...policy, lookback: e.target.value })} />
              </Field>
            </Inline>
            <Inline space="space.100">
              <Button
                appearance="primary"
                isDisabled={!!busy}
                onClick={() =>
                  act(
                    'policy',
                    () =>
                      call('saveConfig', {
                        config: {
                          policy: {
                            emergencyWindowHours: Number(policy.window),
                            productionEnvironments: policy.envs.split(',').map((s) => s.trim()).filter(Boolean),
                          },
                          emergencyLabel: policy.label.trim() || 'emergency-change',
                          reviewerLookbackDays: Math.max(1, Number(policy.lookback) || 90),
                        },
                      }),
                    'Policy saved.',
                  )
                }
              >
                Save policy
              </Button>
            </Inline>
          </Stack>
        </TabPanel>

        <TabPanel>
          <Stack space="space.200">
            <Text>The last release attempts the Pipelines step sent for a verdict.</Text>
            {data.gateLog.length ? (
              <DynamicTable
                head={{ cells: [{ key: 'at', content: 'When (UTC)' }, { key: 'repo', content: 'Repository' }, { key: 'commit', content: 'Commit' }, { key: 'env', content: 'Environment' }, { key: 'allow', content: 'Result' }, { key: 'msg', content: 'Message' }] }}
                rows={data.gateLog.map((g, i) => ({
                  key: `${g.at}-${i}`,
                  cells: [
                    { key: 'at', content: g.at.slice(0, 16).replace('T', ' ') },
                    { key: 'repo', content: g.repo ?? '' },
                    { key: 'commit', content: <Code>{(g.commit ?? '').slice(0, 12)}</Code> },
                    { key: 'env', content: g.environment ?? '' },
                    { key: 'allow', content: <Lozenge appearance={g.allow ? 'success' : 'removed'}>{g.allow ? 'Allowed' : 'Blocked'}</Lozenge> },
                    { key: 'msg', content: g.message ?? '' },
                  ],
                }))}
              />
            ) : (
              <Text color="color.text.subtle">No release attempt yet.</Text>
            )}
          </Stack>
        </TabPanel>
      </Tabs>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
