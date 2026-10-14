import { spawnSync } from 'node:child_process';

function run(file) {
  const result = spawnSync(process.execPath, [file], { windowsHide: true, stdio: 'inherit' });
  if (result.status !== 0) throw Error(`Redirect check failed: ${file}`);
}
let started = false;
try {
  run('tests/search-redirect/start-postgres.mjs');
  started = true;
  run('tests/search-redirect/check-postgres.mjs');
  run('tests/search-redirect/run-headless.mjs');
} finally {
  if (started) run('tests/search-redirect/stop-postgres.mjs');
}
