import { spawnSync, spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SIGNATURE_HEADER, verify } from '../src/core/signature';

const SECRET = 'c'.repeat(64);
const script = join(__dirname, '..', 'pipelines', 'arms-length-gate.sh');
const tools = ['sh', 'curl', 'openssl'].every((t) => spawnSync(t, ['--version'], { stdio: 'ignore' }).error === undefined);

let server: Server;
let url = '';
const seen: { body: Record<string, string>; verified: boolean }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const check = verify(SECRET, raw, req.headers[SIGNATURE_HEADER] as string | undefined);
      const body = JSON.parse(raw);
      seen.push({ body, verified: check.ok });
      const allow = check.ok && body.commit.startsWith('good');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ allow, verdict: allow ? 'PASS' : 'FAIL', message: allow ? "Arm's Length PASS: PAY-7 independently approved; release allowed." : "Arm's Length FAIL: PAY-7 needs an independent approval." }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/`;
});
afterAll(() => server.close());

function run(commit: string, secret = SECRET): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn('sh', [script, 'production'], {
      env: { ...process.env, ARMS_LENGTH_URL: url, ARMS_LENGTH_SECRET: secret, BITBUCKET_COMMIT: commit, BITBUCKET_REPO_SLUG: 'payments-core', BITBUCKET_BUILD_NUMBER: '7' },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}

describe.skipIf(!tools)('Pipelines release gate script', () => {
  it('signs its request so the app accepts it, and exits 0 on PASS', async () => {
    const r = await run('good1234');
    expect(r.code).toBe(0);
    expect(r.out).toContain('release allowed');
    expect(seen.at(-1)).toEqual({ body: { op: 'deploy-gate', repo: 'payments-core', commit: 'good1234', environment: 'production', build: '7', triggeredBy: '' }, verified: true });
  });

  it('exits 1 and prints the reason on FAIL', async () => {
    const r = await run('bad5678');
    expect(r.code).toBe(1);
    expect(r.out).toContain('needs an independent approval');
  });

  it('exits 1 when the secret is wrong', async () => {
    const r = await run('good1234', 'd'.repeat(64));
    expect(r.code).toBe(1);
    expect(seen.at(-1)!.verified).toBe(false);
  });
});
