import { ARTICLE_FIELDS } from '../src/lib/bitable.js';
import { createConnector } from '../connector/runtime.js';
export function fixture({ remindersEnabled = true, clock } = {}) {
  let time = Date.UTC(2026, 9, 13, 1), state = { version: 1, scopes: {} }, identity = 'test-user', queue = Promise.resolve();
  const config = { connectionId: 'test-user', baseToken: 'baseTest', articleTableId: 'tblTest', chatId: 'oc_test', remindersEnabled,
    timeZone: 'Asia/Shanghai', language: 'en' };
  const records = [{ record_id: 'recInitial', fields: { 标题: 'Initial', 链接: 'https://example.com/initial', 阅读状态: '待阅读' } }];
  const sends = [], writes = [];
  const adapter = {
    capabilities: { tableRead: true, tableWrite: true, messages: true },
    getIdentity: async () => ({ connectionId: identity }),
    request: async (method, path, { data } = {}) => {
      if (path.endsWith('/fields')) return { code: 0, data: { items: Object.entries(ARTICLE_FIELDS).map(([field_name, type]) => ({ field_name, type })) } };
      if (path.endsWith('/messages')) { sends.push(data); return { code: 0, data: { message_id: `om_${sends.length}` } }; }
      if (method === 'PUT') {
        writes.push(data); Object.assign(records.find(r => r.record_id === path.split('/').at(-1)).fields, data.fields);
        return { code: 0, data: {} };
      }
      if (method === 'POST') { const record = { record_id: `rec${records.length}`, fields: data.fields }; records.push(record); writes.push(data); return { code: 0, data: { record } }; }
      return { code: 0, data: { items: structuredClone(records) } };
    },
  };
  const store = { load: async () => structuredClone(state), save: async value => { state = structuredClone(value); } };
  const exclusive = work => { const run = queue.then(work); queue = run.catch(() => {}); return run; };
  const create = (overrides = {}) => createConnector({ config, adapter, store, exclusive, now: clock || (() => time), ...overrides });
  return { config, adapter, store, exclusive, create, runtime: create(), records, writes, sends, setIdentity: value => { identity = value; }, setTime: value => { time = value; } };
}
