// Explicit local commands, no listener. The 'daily' command may send messages.
import { loadHostConfig, createHost } from './host.js';
import { createFileState } from './file-state.js';
import { safeErrorMessage } from '../src/lib/security.js';
const [command, file] = process.argv.slice(2);
try {
  if (!['init', 'check', 'pending', 'daily'].includes(command) || !file) throw new Error('usage');
  const config = await loadHostConfig(file);
  if (command === 'init') {
    await (await createFileState(config)).initialize();
    console.log('Private state and access.key initialized; existing data retained.');
  } else {
    const { connector } = await createHost(config);
    const result = command === 'daily' ? await connector.daily() : await connector.dispatch(command === 'check' ? 'health' : 'pending');
    console.log(JSON.stringify(command === 'check' ? { ok: result.ok, schema: result.schema, capabilities: result.capabilities } : command === 'pending' ? { ok: result.ok, pending: !!result.pending } : result));
  }
} catch (error) { console.error(safeErrorMessage(error)); console.error('Usage: node examples/run.mjs init|check|pending|daily private/host.json'); process.exitCode = 1; }
