import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { SafeError } from '../src/lib/security.js';
import { validateFeishuOperation } from '../src/lib/api-policy.js';

export function createCliRunner(config, { exec = execFile, signal } = {}) {
  return async (method, path, { params, data } = {}) => {
    // Every path is selected by helper code, never accepted as an IPC action.
    const args = ['api', method, path, '--as', 'user', '--format', 'json'];
    if (params) args.push('--params', JSON.stringify(params));
    // Send article text/notes through stdin rather than process command arguments.
    if (data) args.push('--data', '-');
    return new Promise((resolve, reject) => {
      const child = exec(config.larkCliPath, args, { cwd: config.cliWorkspace, shell: false, timeout: 60000,
        env: { ...process.env, PATH: [dirname(process.execPath), dirname(config.larkCliPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':') },
        maxBuffer: 2 * 1024 * 1024, ...(signal ? { signal } : {}) }, (error, stdout) => {
        if (error) return reject(new SafeError('lark-cli failed or timed out. Check its login and permissions in the configured workspace.'));
        try {
          const value = JSON.parse(stdout);
          if (value.ok === true && value.identity === 'user' && value.data && typeof value.data === 'object') return resolve({ code: 0, data: value.data });
          if (value.code === 0 && value.data && typeof value.data === 'object') return resolve(value);
        } catch {}
        reject(new SafeError('lark-cli returned an invalid or unsuccessful response. Raw output is withheld.'));
      });
      child.stdin?.on('error', () => {});
      child.stdin?.end(data ? JSON.stringify(data) : undefined);
    });
  };
}
export function createCliClient(config, run) {
  async function verifyIdentity() {
    const result = await run('GET', '/open-apis/authen/v1/user_info');
    if (result.data?.open_id !== config.accountId) throw new SafeError('The CLI user/app identity does not match the pinned helper account. No reading data was written.');
  }
  return {
    verifyIdentity,
    request: async (method, path, options) => {
      validateFeishuOperation(config, method, path, options);
      // Re-check before writes so switching CLI accounts does not silently send
      // a cached collection under another identity.
      if (method !== 'GET') await verifyIdentity();
      return run(method, path, options);
    },
  };
}
