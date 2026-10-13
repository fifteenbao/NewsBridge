import { createServer } from 'node:http';
import { loadServerConfig } from './config.js';
import { createServerRuntime } from './runtime.js';
import { createHttpHandler } from './http.js';
import { createCliRunner } from '../helper/cli.js';
import { safeErrorMessage } from '../src/lib/security.js';

async function main() {
  const config = await loadServerConfig(), abort = new AbortController();
  const runtime = createServerRuntime({ config, run: createCliRunner(config, { signal: abort.signal }) });
  const server = createServer({ maxHeaderSize: 8192, headersTimeout: 10000, requestTimeout: 30000 }, createHttpHandler({ config, dispatch: runtime.dispatch }));
  server.on('clientError', (_error, socket) => socket.destroy());
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { abort.abort(); server.close(); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, '127.0.0.1', resolve); });
  process.stdout.write('NewsBridge API ready on server loopback.\n');
}
main().catch(error => { process.stderr.write(safeErrorMessage(error) + '\n'); process.exitCode = 1; });
