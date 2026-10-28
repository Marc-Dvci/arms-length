import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, Lozenge, SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';

type Result = { verdict: 'PASS' | 'FAIL' | 'CANNOT_DETERMINE'; message: string; checkedAt: string } | null;

const appearance = { PASS: 'success', FAIL: 'removed', CANNOT_DETERMINE: 'moved' } as const;

function App() {
  const [result, setResult] = useState<Result | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (invoke('card') as Promise<unknown>).then((r) => setResult(r as Result)).catch((e) => setError((e as Error).message));
  }, []);

  if (result === undefined && !error) return <Spinner label="Loading" />;

  return (
    <Stack space="space.100">
      {result ? (
        <>
          <Lozenge appearance={appearance[result.verdict]} isBold>
            {result.verdict === 'CANNOT_DETERMINE' ? 'CANNOT DETERMINE' : result.verdict}
          </Lozenge>
          <Text>{result.message.replace(/^Arm's Length [A-Z ]+: /, '')}</Text>
          <Text size="small" color="color.text.subtle">{`Checked ${result.checkedAt.slice(0, 16).replace('T', ' ')} UTC`}</Text>
        </>
      ) : (
        <Text>Not checked yet.</Text>
      )}
      {error ? (
        <SectionMessage appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      ) : null}
      <Button
        isDisabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setResult((await invoke('recheck')) as unknown as Result);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Checking' : 'Check again'}
      </Button>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
