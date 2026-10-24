import { DiagnosticError } from '../src/lib/diagnostics.js';
import { createKnowledgeService, textOf } from '../connector/lib/bitable.js';

// Explicit operator-only test. No browser action exposes this function.
export async function writeProbe({ adapter, config, store, exclusive }) {
  return exclusive(async () => {
    const state = await store.load();
    if (state.probe) throw new DiagnosticError('PROBE_CLEANUP', 'records.update');
    const schema = await createKnowledgeService(adapter.request).preflight(config);
    const marker = `ReadFlow self-test ${crypto.randomUUID()}`;
    const url = 'https://example.com/readflow-self-test';
    const fields = { 标题: marker, 链接: schema.fieldTypes.链接 === 1 ? url : { text: marker, link: url },
      内容: marker, 类别: schema.fieldTypes.类别 === 4 ? ['待分类'] : '待分类', 阅读状态: '已读', 笔记: marker, 时间: Date.now(),
      ...(schema.captureMetadata?.available ? { 标签: [], 备注: marker } : {}) };
    state.probe = { marker, base: `${config.baseToken}/${config.articleTableId}`, recordId: null, createdAt: Date.now() };
    await store.save(state);
    let verified = false;
    // The adapter's private closure grants GET/DELETE only for the returned new record.
    await adapter.probeRecord(fields, async recordId => { state.probe.recordId = recordId; await store.save(state); }, record => {
      const f = record?.fields || {};
      const returnedUrl = typeof f.链接?.link === 'string' ? f.链接.link : textOf(f.链接);
      verified = textOf(f.标题) === marker && returnedUrl === url && textOf(f.内容) === marker && textOf(f.笔记) === marker && textOf(f.阅读状态) === '已读';
      if (schema.captureMetadata?.available) verified = verified && textOf(f.备注) === marker && (!f.标签 || Array.isArray(f.标签) && f.标签.length === 0);
      if (!verified) throw new DiagnosticError('PROBE_FAILED', 'records.list');
    }, async () => { delete state.probe; await store.save(state); });
    return { ok: verified, roundTrip: true, deleted: true };
  });
}
