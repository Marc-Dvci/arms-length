import React from 'react';
import { Box, Label, Stack, xcss } from '@forge/react';

const field = xcss({ width: '260px' });

export function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <Box xcss={field}>
      <Stack space="space.050">
        <Label labelFor={id}>{label}</Label>
        {children}
      </Stack>
    </Box>
  );
}
