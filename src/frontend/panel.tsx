import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  ButtonGroup,
  Code,
  Heading,
  Inline,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  User,
  xcss,
} from '@forge/react';
import { rovo } from '@forge/bridge';
import type { PanelView, PersonView } from '../core/viewmodel';
import { AGENT, approvalAppearance, approvalLabel, call, verdictAppearance, verdictMessage } from './shared';

type View = PanelView & { demo: { isScene: boolean; canApprove: boolean; canShip: boolean }; shipMessage?: string; shipped?: boolean };

const stepStyle = xcss({ paddingBlock: 'space.050' });
const muted = xcss({ color: 'color.text.subtlest' });

function Who({ p }: { p: PersonView }) {
  if (p.account && !p.agent) return <User accountId={p.ref} />;
  return p.agent ? <Lozenge appearance="new">{p.name}</Lozenge> : <Text>{p.name}</Text>;
}

function Chain({ view }: { view: View }) {
  return (
    <Stack space="space.050">
      {view.chain.map((s) => (
        <Box key={s.step} xcss={stepStyle}>
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Text weight="bold">{s.step}</Text>
            {s.people.map((p) => (
              <Who key={p.ref} p={p} />
            ))}
            {s.note ? <Text color="color.text.subtle">{s.note}</Text> : null}
          </Inline>
        </Box>
      ))}
    </Stack>
  );
}

function App() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (name: string, fn: string) => {
    setBusy(name);
    setError(null);
    try {
      setView(await call<View>(fn));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    run('load', 'panel');
  }, []);

  if (!view) return error ? <SectionMessage appearance="error" title="Arm's Length could not load">{<Text>{error}</Text>}</SectionMessage> : <Spinner label="Rebuilding the change chain" />;

  const askRovo = () =>
    rovo.open({ type: 'forge', agentKey: AGENT.key, agentName: AGENT.name, prompt: `Who should approve ${view.workItem}, and why can the others not?` });

  return (
    <Stack space="space.200">
      <SectionMessage appearance={verdictMessage[view.verdict]} title={view.headline}>
        <Stack space="space.050">
          {view.lines.map((l) => (
            <Text key={l}>{l}</Text>
          ))}
          {view.flags.includes('RETRO_APPROVAL') ? <Text>Emergency change: the independent approval came after the merge, inside the policy window.</Text> : null}
        </Stack>
      </SectionMessage>

      <Inline space="space.100" alignBlock="center" shouldWrap>
        <Lozenge appearance={verdictAppearance[view.verdict]} isBold>
          {view.verdictLabel}
        </Lozenge>
        {view.rule ? <Text>{`${view.rule} ${view.ruleTitle}`}</Text> : <Text>All rules pass</Text>}
        {view.source === 'demo' ? <Lozenge>Demo bank</Lozenge> : null}
      </Inline>

      <Stack space="space.100">
        <Heading size="small">Change chain</Heading>
        <Chain view={view} />
      </Stack>

      {view.pullRequests.map((pr) => (
        <Stack key={pr.id} space="space.100">
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Heading size="xsmall">{pr.id}</Heading>
            <Lozenge>{pr.state}</Lozenge>
            <Lozenge appearance={verdictAppearance[pr.verdict]}>{pr.verdict === 'CANNOT_DETERMINE' ? 'CANNOT DETERMINE' : pr.verdict}</Lozenge>
          </Inline>
          {pr.approvals.length ? (
            pr.approvals.map((a) => (
              <Inline key={`${a.person.ref}${a.at}`} space="space.100" alignBlock="center" shouldWrap>
                <Who p={a.person} />
                <Lozenge appearance={approvalAppearance[a.status]}>{approvalLabel(a.status, a.retro)}</Lozenge>
              </Inline>
            ))
          ) : (
            <Text>No approval yet.</Text>
          )}
          {pr.verdict !== 'PASS' && pr.mustNotApprove.length ? (
            <Stack space="space.050">
              <Text weight="medium">Approvals that cannot count</Text>
              {pr.mustNotApprove.map((m) => (
                <Inline key={m.person.ref} space="space.100" alignBlock="center" shouldWrap>
                  <Who p={m.person} />
                  <Text color="color.text.subtle">{m.why}</Text>
                </Inline>
              ))}
            </Stack>
          ) : null}
        </Stack>
      ))}

      {view.deployments.length ? (
        <Stack space="space.050">
          <Heading size="xsmall">Production deployments</Heading>
          {view.deployments.map((d) => (
            <Inline key={d.id} space="space.100" alignBlock="center" shouldWrap>
              <Text>{`${d.id} on ${d.at.slice(0, 16).replace('T', ' ')} UTC`}</Text>
              <Lozenge appearance={verdictAppearance[d.verdict]}>{d.verdict === 'CANNOT_DETERMINE' ? 'CANNOT DETERMINE' : d.verdict}</Lozenge>
            </Inline>
          ))}
        </Stack>
      ) : null}

      {view.shipMessage ? (
        <SectionMessage appearance={view.shipped ? 'success' : 'error'} title={view.shipped ? 'Merged and deployed' : 'Release pipeline stopped'}>
          <Text>{view.shipMessage}</Text>
        </SectionMessage>
      ) : null}
      {error ? (
        <SectionMessage appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      ) : null}

      <ButtonGroup label="Actions">
        {view.verdict !== 'PASS' ? (
          <Button appearance="primary" onClick={askRovo}>
            Ask Rovo who should approve
          </Button>
        ) : null}
        {view.demo.canApprove ? (
          <Button isDisabled={!!busy} onClick={() => run('approve', 'demoApprove')}>
            {busy === 'approve' ? 'Approving' : 'Approve as me'}
          </Button>
        ) : null}
        {view.demo.canShip ? (
          <Button isDisabled={!!busy} onClick={() => run('ship', 'demoShip')}>
            {busy === 'ship' ? 'Running the release pipeline' : 'Merge and deploy'}
          </Button>
        ) : null}
        <Button appearance="subtle" isDisabled={!!busy} onClick={() => run('load', 'panel')}>
          Refresh
        </Button>
      </ButtonGroup>

      <Box xcss={muted}>
        <Text size="small">
          Evidence SHA-256 <Code>{view.evidenceHash.slice(0, 16)}</Code> · rules {view.rulesVersion} · policy {view.policyVersion}
        </Text>
      </Box>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
