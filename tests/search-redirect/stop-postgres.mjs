import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const config = JSON.parse(await fs.readFile('scratch/redirect-db.json', 'utf8'));
const root = path.resolve('scratch');
const directory = path.resolve(config.directory);
if (!directory.startsWith(root + path.sep) || !path.basename(directory).startsWith('redirect-postgres-')) throw Error('Refusing to stop a non-fixture cluster');
const pidFile = (await fs.readFile(path.join(directory, 'postmaster.pid'), 'utf8')).split(/\r?\n/);
if (path.resolve(pidFile[1]) !== directory || Number(pidFile[3]) !== config.port) throw Error('Fixture cluster identity mismatch');
const result = spawnSync(path.join(config.bin, process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl'), ['-D', directory, '-m', 'fast', '-w', 'stop'], { windowsHide: true, stdio: 'ignore' });
if (result.status !== 0) throw Error('Could not stop fixture PostgreSQL');
console.log('Isolated redirect PostgreSQL stopped.');
