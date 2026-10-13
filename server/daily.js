import { loadServerConfig } from './config.js';
import { createServerRuntime } from './runtime.js';
import { safeErrorMessage } from '../src/lib/security.js';
try {
  const result = await createServerRuntime({ config: await loadServerConfig() }).daily();
  process.stdout.write(result.skipped ? 'Before reminder time; skipped.\n' : `Daily check completed; ${result.deliveries} messages confirmed.\n`);
} catch (error) { process.stderr.write(safeErrorMessage(error) + '\n'); process.exitCode = 1; }
