import { readFile, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONNECTION_ORIGIN } from '../src/lib/connection-config.js';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const findings = [];
const report = (file, rule, line) => findings.push({ file, rule, ...(line ? { line } : {}) });
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))];
const placeholders = /^(mock[-_]|test[-_]|short[-_]|YOUR_|REPLACE[-_]|example[-_]|placeholder)/i;
for (const file of files) {
  let info;
  try { info = await lstat(resolve(root, file)); } catch { continue; }
  if (info.isSymbolicLink()) { report(file, 'symlink requires manual review; target is not read'); continue; }
  if (!info.isFile()) continue;
  if (/(^|\/)(\.env|\.dev\.vars)(\..*)?$|\.(key|pem|p12|pfx|jks)$|(^|\/)(private|dist)\/|(^|\/)(connection\.config\.json|notification-state[^/]*)$/.test(file)) report(file, 'private data or generated package must not be committed');
  if (info.size > 2 * 1024 * 1024 || /\.(png|xlsx)$/i.test(file)) continue;
  const source = await readFile(resolve(root, file), 'utf8');
  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(source)) report(file, 'private key material');
  if (/\beyJ[A-Za-z0-9_-]{12,}\.eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{16,}\b/.test(source)) report(file, 'JWT credential literal');
  const secrets = /(?:["']?)(?:FEISHU_APP_SECRET|app_secret|client_secret|appSecret|access_token|refresh_token|accessToken|connectionAccessKey)(?:["']?)\s*[:=]\s*(["'])([^"'\r\n]{12,})\1/g;
  for (const match of source.matchAll(secrets)) {
    if (!placeholders.test(match[2])) report(file, 'possible credential literal', source.slice(0, match.index).split('\n').length);
  }
  if (file.startsWith('src/') && /\.innerHTML\s*=|\.outerHTML\s*=|\beval\s*\(|\bnew\s+Function\s*\(/.test(source)) report(file, 'unsafe DOM or code execution sink');
}
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
if (CONNECTION_ORIGIN !== '' || manifest.host_permissions || manifest.optional_host_permissions) report('manifest.json', 'public source must be offline with no host permissions');
if (manifest.content_scripts || manifest.externally_connectable || manifest.web_accessible_resources ||
    manifest.permissions.some(permission => !['storage', 'activeTab', 'contextMenus', 'alarms'].includes(permission))) {
  report('manifest.json', 'expanded extension access');
}
if (manifest.content_security_policy.extension_pages.includes('unsafe-') || (!manifest.content_security_policy.extension_pages.includes("object-src 'none'") || !manifest.content_security_policy.extension_pages.includes("connect-src 'none';"))) {
  report('manifest.json', 'unsafe extension content policy');
}
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
if (Object.keys(pkg.dependencies || {}).length) report('package.json', 'new runtime dependencies require security review');
// Findings contain metadata only: never print the matched token or source line.
if (findings.length) {
  for (const finding of findings) process.stdout.write(JSON.stringify(finding) + '\n');
  process.exitCode = 1;
} else process.stdout.write('Repository security checks passed (permissions, credential patterns, and unsafe code sinks).\n');
