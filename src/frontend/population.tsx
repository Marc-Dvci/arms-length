import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Code,
  DynamicTable,
  EmptyState,
  Heading,
  Inline,
  Link,
  Lozenge,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
  xcss,
} from '@forge/react';
import type { PopulationResult, PopulationRow } from '../core/population';
import { Field } from './field';
import { call, recentQuarters, verdictAppearance } from './shared';

type Row = PopulationRow & { verdictLabel: string; ruleTitle: string };
type Data = Omit<PopulationResult, 'rows'> & { rows: Row[]; demo: { projectKey: string } | null; projects: { key: string; name: string }[] };
type Option = { label: string; value: string };

const figure = xcss({ paddingInlineEnd: 'space.400' });
function Figure({ value, label }: { value: number; label: string }) {
  return (
    <Box xcss={figure}>
      <Stack space="space.0">
        <Heading size="large">{String(value)}</Heading>
        <Text color="color.text.subtle">{label}</Text>
      </Stack>
    </Box>
  );
}

function App() {
  const quarters = [{ label: 'Demo quarter (Q3 2026)', from: '2026-07-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' }, ...recentQuarters()];
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [project, setProject] = useState<Option | null>(null);
  const [spaces, setSpaces] = useState<Option[] | null>(null);
  const [space, setSpace] = useState<Option | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [page, setPage] = useState<string | null>(null);

  const load = async (p: { from: string; to: string } | null) => {
    setBusy('load');
    setError(null);
    try {
      const d = await call<Data>('population', p ?? undefined);
      setData(d);
      setPeriod(d.period);
      if (!project && d.demo) setProject({ label: d.demo.projectKey, value: d.demo.projectKey });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    load(null);
    call<{ id: string; key: string; name: string; personal: boolean }[]>('spaces')
      .then((s) => setSpaces(s.map((x) => ({ label: x.personal ? `${x.name} (personal space)` : `${x.name} (${x.key})`, value: x.id }))))
      .catch(() => setSpaces([]));
  }, []);

  const act = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!data) return error ? <SectionMessage appearance="error" title="The population test could not run">{<Text>{error}</Text>}</SectionMessage> : <Spinner label="Running the population test" />;

  const s = data.summary;
  const head = {
    cells: [
      { key: 'at', content: 'Deployed (UTC)', isSortable: true },
      { key: 'item', content: 'Work item', isSortable: true },
      { key: 'pr', content: 'Pull request' },
      { key: 'verdict', content: 'Verdict', isSortable: true },
      { key: 'rule', content: 'Rule' },
      { key: 'approver', content: 'Independent approval' },
      { key: 'hash', content: 'Evidence' },
    ],
  };
  const rows = data.rows.map((r) => ({
    key: `${r.deployment}-${r.workItem}`,
    cells: [
      { key: r.at, content: r.at.slice(0, 16).replace('T', ' ') },
      { key: r.workItem, content: <Link href={`/browse/${r.workItem}`}>{r.workItem}</Link> },
      { key: 'pr', content: r.pr ?? '-' },
      { key: r.verdict, content: <Lozenge appearance={verdictAppearance[r.verdict]}>{r.verdictLabel}</Lozenge> },
      { key: 'rule', content: r.rule ? `${r.rule} ${r.ruleTitle}` : '' },
      { key: 'approver', content: r.approvers.join(', ') || '-' },
      { key: 'hash', content: <Code>{r.evidenceHash.slice(0, 12)}</Code> },
    ],
  }));
  const quarterOptions = quarters.map((q) => ({ label: q.label, value: `${q.from}|${q.to}` }));
  const current = quarterOptions.find((o) => period && o.value.startsWith(new Date(period.from).toISOString()));

  return (
    <Stack space="space.300">
      <Text>
        Every production deployment in the period, with the verdict of the change it shipped. Each change needs an approval from someone who did not request it, write it, or direct the agent that wrote it.
      </Text>

      <Inline space="space.200" alignBlock="end" shouldWrap>
        <Field id="period" label="Period">
          <Select
            inputId="period"
            options={quarterOptions}
            value={current}
            onChange={(o: Option) => {
              const [from, to] = o.value.split('|');
              setLinks({});
              setPage(null);
              load({ from, to });
            }}
          />
        </Field>
        {busy === 'load' ? <Spinner size="small" label="Loading" /> : null}
      </Inline>

      <Inline space="space.200" shouldWrap>
        <Figure value={s.deployments} label="production deployments" />
        <Figure value={s.pass} label="PASS" />
        <Figure value={s.fail} label="FAIL" />
        <Figure value={s.cannotDetermine} label="CANNOT DETERMINE" />
      </Inline>

      {data.rows.length ? (
        <DynamicTable caption="Population" head={head} rows={rows} rowsPerPage={15} defaultSortKey="at" defaultSortOrder="ASC" />
      ) : (
        <EmptyState
          header="No production deployments in this period"
          description={data.demo ? 'Choose the demo quarter to see the demo bank.' : "Load the demo bank from the app's settings page, or pair Bitbucket to record real releases."}
        />
      )}

      <Text size="small">
        Evidence-set SHA-256 <Code>{data.evidenceSetHash}</Code> · rules {data.rulesVersion} · policy {data.policy.version}
      </Text>

      {data.exceptions.length ? (
        <Stack space="space.150">
          <Heading size="medium">{`Exceptions (${data.exceptions.length})`}</Heading>
          <Inline space="space.200" alignBlock="end" shouldWrap>
            <Field id="project" label="Project for the action items">
              <Select
                inputId="project"
                options={data.projects.map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }))}
                value={project ?? undefined}
                onChange={(o: Option) => setProject(o)}
              />
            </Field>
            <Button
              isDisabled={!project || !!busy}
              onClick={() =>
                act('raise', async () => {
                  const out = await call<{ links: Record<string, string> }>('raiseExceptions', { ...period, projectKey: project!.value });
                  setLinks(out.links);
                })
              }
            >
              {busy === 'raise' ? 'Raising' : 'Raise exceptions as work items'}
            </Button>
          </Inline>
          {Object.keys(links).length ? (
            <Inline space="space.100" shouldWrap>
              {Object.entries(links).map(([k, url]) => (
                <Link key={k} href={url}>
                  {url.split('/').at(-1)!}
                </Link>
              ))}
            </Inline>
          ) : null}
        </Stack>
      ) : null}

      <Stack space="space.150">
        <Heading size="medium">Workpaper</Heading>
        <Text>Publishes objective, population, method, results, exceptions and the evidence-set hash as a Confluence page in your name.</Text>
        <Inline space="space.200" alignBlock="end" shouldWrap>
          <Field id="space" label="Confluence space">
            <Select inputId="space" options={spaces ?? []} isLoading={spaces === null} value={space ?? undefined} onChange={(o: Option) => setSpace(o)} />
          </Field>
          <Button
            appearance="primary"
            isDisabled={!space || !!busy}
            onClick={() =>
              act('publish', async () => {
                const out = await call<{ url: string }>('publish', { ...period, spaceId: space!.value, links });
                setPage(out.url);
              })
            }
          >
            {busy === 'publish' ? 'Publishing' : 'Publish workpaper'}
          </Button>
        </Inline>
        {page ? (
          <SectionMessage appearance="success" title="Workpaper published">
            <Link href={page} openNewTab>
              Open the Confluence page
            </Link>
          </SectionMessage>
        ) : null}
        {spaces && !spaces.length ? <Text color="color.text.subtle">No Confluence space is available to you on this site.</Text> : null}
      </Stack>

      {error ? (
        <SectionMessage appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      ) : null}
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
