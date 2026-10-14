// Opt-in loopback server for an existing HTTPS reverse proxy. Importing is inert.
import { Readable } from 'node:stream';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { loadHostConfig, createHost } from './host.js';
import { parseConnectionUrl } from '../src/lib/connection-url.js';
export function createNodeServer({ handleRequest, baseUrl, maxBytes = 20 * 1024 * 1024 }) {
  const target = parseConnectionUrl(baseUrl);
  const server = createServer(async (incoming, outgoing) => {
    try {
      if (!incoming.url?.startsWith('/') || incoming.url.startsWith('//') || Number(incoming.headers['content-length']) > maxBytes) {
        outgoing.writeHead(413).end(); incoming.resume(); return;
      }
      // Let the authenticated, concurrency-limited handler consume a bounded stream.
      // Never buffer arbitrary unauthenticated requests in front of that handler.
      const request = new Request(target.origin + incoming.url, { method: incoming.method, headers: incoming.headers,
        ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) });
      const response = await handleRequest(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer())); incoming.resume();
    } catch { if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); outgoing.end('{"ok":false,"error":"Connection request failed."}'); }
  });
  server.requestTimeout = 200000; server.headersTimeout = 15000;
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [file, flag, envFile] = process.argv.slice(2);
    if (!file || flag && (flag !== '--env' || !envFile) || process.argv.length > 5) throw new Error();
    if (envFile) loadEnvFile(envFile);
    const config = await loadHostConfig(file), host = await createHost(config);
    const port = config.port ?? 8787;
    if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error();
    const server = createNodeServer({ ...host, baseUrl: config.baseUrl });
    server.on('error', () => { console.error('Could not start the loopback connection server.'); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log('NewsBridge connection ready on loopback; expose only through your authenticated HTTPS configuration.'));
  } catch { console.error('Connection startup failed. Use: node examples/serve.mjs private/host.json [--env private/host.env]. Check private configuration, environment and state initialization.'); process.exitCode = 1; }
}
