import { existsSync } from 'node:fs';
import { semanticProvider, semanticEmbedderSettings } from '../app/utils/semanticSearch.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const checkOnly = process.argv.includes('--check');
try {
  const provider = semanticProvider();
  // Validate credentials before creating a client or touching the shared index.
  const settings = checkOnly ? null : semanticEmbedderSettings();
  const { default: client } = await import('../app/services/meiliClient.server.js');
  const index = client.index('products');
  if (checkOnly) {
    const embedders = (await index.getSettings()).embedders || {};
    const config = embedders[provider];
    console.log(JSON.stringify({provider, configured:!!config, source:config?.source,
      model:config?.model, dimensions:config?.dimensions, legacyDefaultPresent:!!embedders.default,
      inactiveProviderPresent:!!embedders[provider === 'openai' ? 'gemini' : 'openai']}, null, 2));
  } else {
    const task = await index.updateSettings({embedders: settings});
    console.log(`Semantic setup: ${provider}; indexing task ${task.taskUid}. Existing products will be embedded with this provider.`);
    const completed = await client.tasks.waitForTask(task.taskUid, {timeout:6000000});
    if (completed.status !== 'succeeded') throw new Error('Semantic indexing did not succeed');
    console.log(`Semantic setup complete: ${provider}. Verify live search after the provider-readiness cache refreshes.`);
  }
} catch {
  console.error('Semantic setup failed. Check the selected provider API key, Meilisearch connectivity, and indexing task status.');
  process.exitCode = 1;
}
