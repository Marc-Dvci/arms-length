// Validates both Forge manifests offline with the same validator the Forge CLI uses.
const { validate } = require('@forge/manifest');
const path = require('node:path');

(async () => {
  let failed = false;
  for (const dir of ['.', 'bitbucket']) {
    const root = path.resolve(__dirname, '..', dir);
    process.chdir(root);
    const r = await validate(false, path.join(root, 'manifest.yml'));
    const problems = (r.errors ?? []).filter((e) => e.level !== 'warning');
    console.log(`${dir === '.' ? 'manifest.yml' : 'bitbucket/manifest.yml'}: ${r.success ? 'valid' : 'invalid'}`);
    for (const e of r.errors ?? []) console.log(`  ${e.level ?? 'error'}: ${e.message}${e.line ? ` (line ${e.line})` : ''}`);
    if (!r.success || problems.length) failed = true;
  }
  process.exit(failed ? 1 : 0);
})();
