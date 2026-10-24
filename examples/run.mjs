// Explicit commands; export, ingest and daily may have external effects.
import { loadEnvFile } from 'node:process';
import { loadHostConfig, createHost } from './host.js';
import { createFileState } from './file-state.js';
import { openLibrary } from './database.js';
import { SafeError, safeErrorMessage } from '../src/lib/security.js';
import { cleanDiagnostic } from '../src/lib/diagnostics.js';
const usage = 'Usage: node examples/run.mjs init|audit|export|inbox-pending|inbox-resolve|ingest|check|pending|daily|pair-list|pair-approve|pair-reject|pair-revoke private/host.json [--env private/host.env] [--pair-id ID --fingerprint HEX] [--receipt-id ID --outcome sent|not-sent]';
try {
  const [command, file, ...options] = process.argv.slice(2);
  if (!['init', 'audit', 'export', 'inbox-pending', 'inbox-resolve', 'pair-list', 'pair-approve', 'pair-reject', 'pair-revoke', 'ingest', 'check', 'pending', 'daily'].includes(command) || !file) throw new SafeError(usage);
  let envFile, pairId, fingerprint, receiptId, outcome;
  for (let i = 0; i < options.length; i++) {
    if (options[i] === '--env' && options[i + 1] && !envFile) envFile = options[++i];
    else if (options[i] === '--pair-id' && options[i + 1] && !pairId) pairId = options[++i];
    else if (options[i] === '--fingerprint' && options[i + 1] && !fingerprint) fingerprint = options[++i];
    else if (options[i] === '--receipt-id') receiptId = options[++i];
    else if (options[i] === '--outcome') outcome = options[++i];
    else throw new SafeError(usage);
  }
  if (command === 'inbox-resolve' && (!receiptId || !['sent', 'not-sent'].includes(outcome))) throw new SafeError(usage);
  if (envFile) {
    try { loadEnvFile(envFile); } catch { throw new SafeError('Cannot load the selected environment file. Check its path and permissions.'); }
  }
  const config = await loadHostConfig(file);
  if (command === 'init' || command === 'audit') {
    try {
      const persistence = await createFileState({ ...config, authentication: 'paired' });
      if (command === 'init') await persistence.initialize();
      const library = await persistence.exclusive(() => openLibrary(config.stateDir, { initialize: command === 'init' }));
      library.close();
      console.log(JSON.stringify(await persistence.exclusive(() => persistence.audit())));
      if (command === 'init') {
        const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
        console.log('Next, check the database connection: node examples/run.mjs check ' + quote(file) + (envFile ? ' --env ' + quote(envFile) : ''));
        console.log('Feishu credentials are optional until enabling messages or manual table export. Browser connections use fingerprint approval; no access key needs to be copied.');
      }
    } catch { throw new SafeError('State setup/audit failed. Check stateDir ownership, 0700 directory, 0600 regular files, nlink=1, valid JSON/key, free disk space and state.lock. Existing files were not reset.'); }
  } else {
    const host = await createHost(config);
    const selected = { connector: host.connector };
    if (command === 'inbox-pending' || command === 'inbox-resolve') {
      if (!host.inbox) throw new SafeError('Feishu inbox is disabled.');
      console.log(JSON.stringify(await host.inbox.receipts(command === 'inbox-resolve' ? receiptId : undefined, outcome))); host.close(); process.exit(0);
    }
    if (command === 'ingest' || command === 'daily') {
      const intake = host.inbox ? await host.inbox.processPending() : { ok: true, skipped: true };
      if (command === 'ingest') { console.log(JSON.stringify(intake)); host.close(); process.exit(0); }
    }
    const result = command.startsWith('pair-') ? await host.pairing.manage(command.slice(5), pairId, fingerprint) : command === 'daily' ? await selected.connector.daily() : await selected.connector.dispatch(command === 'check' ? 'health' : command === 'export' ? 'export' : 'pending');
    console.log(JSON.stringify(command === 'check' ? { ok: result.ok, capabilities: result.capabilities } : command === 'pending' ? { ok: result.ok, pending: !!result.pending } : result));
    host.close();
  }
} catch (error) {
  const diagnostic = cleanDiagnostic(error?.diagnostic);
  if (diagnostic) console.error(JSON.stringify(diagnostic));
  console.error(safeErrorMessage(error)); process.exitCode = 1;
}
