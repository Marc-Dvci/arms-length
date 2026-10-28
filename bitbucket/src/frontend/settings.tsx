import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, Heading, Inline, Label, Lozenge, SectionMessage, Spinner, Stack, Text, Textfield } from '@forge/react';
import { invoke } from '@forge/bridge';

function App() {
  const [state, setState] = useState<{ endpoint: string; paired: boolean } | null>(null);
  const [endpoint, setEndpoint] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const s = (await invoke('settings')) as unknown as { endpoint: string; paired: boolean };
    setState(s);
    setEndpoint(s.endpoint);
  };
  useEffect(() => {
    load();
  }, []);

  if (!state) return <Spinner label="Loading" />;

  return (
    <Stack space="space.200">
      <Heading size="medium">Arm's Length</Heading>
      <Text>
        The merge check sends each pull request's authors, approvals and pushes to your Jira site, which returns the independence verdict. Copy the endpoint and the pairing secret from the Arm's Length settings page in Jira.
      </Text>
      <Inline space="space.100" alignBlock="center">
        <Text>Status</Text>
        <Lozenge appearance={state.paired ? 'success' : 'moved'}>{state.paired ? 'Paired' : 'Not paired'}</Lozenge>
      </Inline>
      <Stack space="space.050">
        <Label labelFor="endpoint">Endpoint</Label>
        <Textfield id="endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
      </Stack>
      <Stack space="space.050">
        <Label labelFor="secret">Pairing secret</Label>
        <Textfield id="secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
      </Stack>
      <Inline space="space.100">
        <Button
          appearance="primary"
          isDisabled={busy || !endpoint || !secret}
          onClick={async () => {
            setBusy(true);
            setMessage(null);
            try {
              await invoke('pair', { endpoint, secret });
              setSecret('');
              await load();
              setMessage({ ok: true, text: 'Paired. Enable the merge check under Workspace settings > Custom merge checks.' });
            } catch (e) {
              setMessage({ ok: false, text: (e as Error).message });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Pairing' : 'Pair with Jira'}
        </Button>
      </Inline>
      {message ? (
        <SectionMessage appearance={message.ok ? 'success' : 'error'}>
          <Text>{message.text}</Text>
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
