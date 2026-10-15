import fs from 'node:fs/promises';
import { createCustomizationServer } from './server.mjs';
const fixture = await createCustomizationServer();
await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + fixture.server.address().port;
await fs.writeFile('scratch/customization-fixture.json', JSON.stringify({ origin, pid: process.pid }));
console.log(origin);
const timer = setInterval(async () => { if (await fs.access('scratch/customization-fixture-stop-' + process.pid).then(() => true, () => false)) { clearInterval(timer); await fixture.dispose(); } }, 500);
