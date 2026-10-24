import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleItems, nextBatch, MAX_ITEMS_PER_MESSAGE } from '../connector/lib/batch.js';
const item = (id, extra = {}) => ({ id, url: `https://example.com/${id}`, read: false,
  savedAt: `2026-01-${String(id + 1).padStart(2, '0')}`, ...extra });

test('any non-empty unread selection forms a message, ordered oldest first', () => {
  assert.equal(nextBatch([]).ready, false);
  assert.equal(nextBatch([item(0)]).ready, true);
  assert.deepEqual(nextBatch([item(2), item(0), item(1)]).batch.map(a => a.id), [0, 1, 2]);
});
test('read, deleted, link-free, and already delivered today items are excluded', () => {
  const rows = [item(0, { read: true }), item(1, { notifiedAt: 'today' }), item(2, { feishuDeleted: true }),
    item(3, { url: '' }), item(4)];
  assert.deepEqual(eligibleItems(rows).map(a => a.id), [4]);
});
test('large collections split at the size limit rather than requiring a minimum', () => {
  const rows = Array.from({ length: MAX_ITEMS_PER_MESSAGE + 1 }, (_, id) => item(id));
  assert.equal(nextBatch(rows).batch.length, MAX_ITEMS_PER_MESSAGE);
  assert.equal(nextBatch(rows.slice(MAX_ITEMS_PER_MESSAGE)).batch.length, 1);
});
