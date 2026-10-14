import { SafeError } from './security.js';
export const messages = Object.freeze({
  ACCESS_KEY: 'Missing or invalid access.key. Initialize private state and check file ownership and permissions.',
  TABLE_MISMATCH: 'The pasted table differs from the authorized table. Ask the connection operator to configure the intended table; use a separate collection for a different table.',
  AUTH_VERIFY: 'Connection authorization could not be verified.',
  API_TRANSPORT: 'Feishu request failed. Check network access and current credentials.',
  API_REJECTED: 'Feishu rejected the operation. Check its numeric code, permissions and field values.',
  API_RESPONSE: 'The adapter returned an invalid response.',
  SCHEMA_INVALID: 'Table fields are missing or have incompatible types.',
  STATE_LOAD: 'Cannot load valid connection state. Check stateDir, ownership and file contents.',
  STATE_SAVE: 'Cannot persist connection state. Check disk space and write permissions.',
  LOCK_BUSY: 'State lock is held. Retry; after a crash, stop all owners before removing the lock.',
  OPERATION_FAILED: 'Connection operation failed. Check the failure stage and reference.',
});
const stages = new Set(['identity', 'fields', 'records.list', 'records.create', 'records.update', 'messages.send', 'state.load', 'state.save', 'lock', 'health', 'sync', 'read', 'pending', 'resolve', 'preferences', 'daily']);
const fieldNames = new Set(['标题', '链接', '内容', '类别', '阅读状态', '推荐指数', '笔记', '时间']);
export function cleanDiagnostic(value) {
  if (!value || !Object.hasOwn(messages, value.code) || !stages.has(value.stage)) return null;
  const result = { code: value.code, stage: value.stage };
  if (Number.isSafeInteger(value.providerCode)) result.providerCode = value.providerCode;
  if (Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599) result.httpStatus = value.httpStatus;
  if (typeof value.reference === 'string' && /^[a-f0-9-]{36}$/.test(value.reference)) result.reference = value.reference;
  if (Array.isArray(value.fields)) result.fields = value.fields.slice(0, 8).filter(f => fieldNames.has(f?.name) && Array.isArray(f.expected) && f.expected.every(Number.isSafeInteger) && (f.actual === null || Number.isSafeInteger(f.actual))).map(f => ({ name: f.name, expected: f.expected.slice(0, 2), actual: f.actual }));
  return result;
}
export class DiagnosticError extends SafeError {
  constructor(code, stage, details = {}) {
    const diagnostic = cleanDiagnostic({ ...details, code, stage });
    super(formatDiagnostic(diagnostic));
    this.diagnostic = diagnostic;
  }
}
export function formatDiagnostic(value) {
  const d = cleanDiagnostic(value);
  if (!d) return messages.OPERATION_FAILED;
  const fields = d.fields?.map(f => `${f.name}: expected ${f.expected.join('/')}, actual ${f.actual ?? 'missing'}`).join('; ');
  return `${messages[d.code]} [${d.code}; ${d.stage}${d.providerCode !== undefined ? `; provider=${d.providerCode}` : ''}${d.httpStatus ? `; HTTP=${d.httpStatus}` : ''}${d.reference ? `; ref=${d.reference}` : ''}]${fields ? ` ${fields}` : ''}`;
}
