import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const candidates =
  process.platform === 'win32'
    ? [
        join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe'),
        join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/usr/bin/dash.exe'),
      ].filter(existsSync)
    : ['sh', 'bash', 'dash'];
let checked = 0;
for (const shell of candidates) {
  const result = spawnSync(shell, ['-n', 'pipelines/arms-length-gate.sh'], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') continue;
  if (result.error || result.status !== 0) throw new Error(`${shell}: ${result.error?.message ?? result.stderr}`);
  checked++;
}
if (!checked) throw new Error('Install a POSIX shell (Git for Windows includes Bash) to validate the release gate.');
console.log(`Release gate syntax valid in ${checked} shell(s).`);
