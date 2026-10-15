// Explicit commands; check --write and daily have documented external effects.
import { loadEnvFile } from 'node:process';
import { loadHostConfig, createHost } from './host.js';
import { createFileState } from './file-state.js';
import { writeProbe } from './write-probe.js';
import { SafeError, safeErrorMessage } from '../src/lib/security.js';
import { cleanDiagnostic } from '../src/lib/diagnostics.js';
const usage = 'Usage: node examples/run.mjs init|audit|prepare|check|pending|daily|pair-list|pair-approve|pair-reject|pair-revoke private/host.json [--env private/host.env] [--provider feishu|google] [--write (check only)] [--pair-id ID --fingerprint HEX]';
try {
  const [command, file, ...options] = process.argv.slice(2);
  if (!['init', 'audit', 'pair-list', 'pair-approve', 'pair-reject', 'pair-revoke', 'prepare', 'check', 'pending', 'daily'].includes(command) || !file) throw new SafeError(usage);
  let envFile, provider, pairId, fingerprint, write = false;
  for (let i = 0; i < options.length; i++) {
    if (options[i] === '--env' && options[i + 1] && !envFile) envFile = options[++i];
    else if (options[i] === '--provider' && ['feishu', 'google'].includes(options[i + 1]) && !provider) provider = options[++i];
    else if (options[i] === '--pair-id' && options[i + 1] && !pairId) pairId = options[++i];
    else if (options[i] === '--fingerprint' && options[i + 1] && !fingerprint) fingerprint = options[++i];
    else if (options[i] === '--write' && command === 'check' && !write) write = true;
    else throw new SafeError(usage);
  }
  if (envFile) {
    try { loadEnvFile(envFile); } catch { throw new SafeError('Cannot load the selected environment file. Check its path and permissions.'); }
  }
  const config = await loadHostConfig(file);
  if (command === 'init' || command === 'audit') {
    try {
      const persistence = await createFileState({ ...config, authentication: 'paired' });
      if (command === 'init') await persistence.initialize();
      console.log(JSON.stringify(await persistence.exclusive(() => persistence.audit())));
      if (command === 'init') {
        const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
        console.log('Next, verify create/read/delete permissions: node examples/run.mjs check ' + quote(file) + (envFile ? ' --env ' + quote(envFile) : '') + ' --write');
        console.log('Provide provider credentials through the environment or --env. Browser connections use fingerprint approval; no access key needs to be copied.');
      }
    } catch { throw new SafeError('State setup/audit failed. Check stateDir ownership, 0700 directory, 0600 regular files, nlink=1, valid JSON/key, free disk space and state.lock. Existing files were not reset.'); }
  } else {
    const host = await createHost(config);
    const selected = provider ? host.hosts[provider] : { connector: host.connector, adapter: host.adapter, config: config.connector };
    if (!selected) throw new SafeError('Configure the selected provider on the host first.');
    if (command === 'prepare' && typeof selected.adapter.prepare !== 'function') throw new SafeError('prepare is available only for Google Sheets.');
    const result = command.startsWith('pair-') ? await host.pairing.manage(command.slice(5) === 'list' ? 'list' : command.slice(5), pairId, fingerprint) : command === 'prepare' ? await host.exclusive(() => selected.adapter.prepare()) : command === 'daily' ? await selected.connector.daily() : await selected.connector.dispatch(command === 'check' ? 'health' : 'pending');
    if (write) console.log(JSON.stringify(await writeProbe({ ...host, adapter: selected.adapter, config: selected.config })));
    else console.log(JSON.stringify(command === 'check' ? { ok: result.ok, schema: result.schema, capabilities: result.capabilities } : command === 'pending' ? { ok: result.ok, pending: !!result.pending } : result));
  }
} catch (error) {
  const diagnostic = cleanDiagnostic(error?.diagnostic);
  if (diagnostic) console.error(JSON.stringify(diagnostic));
  console.error(safeErrorMessage(error)); process.exitCode = 1;
}
