import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { localDay, dueDay, nextDailySend } from '../src/lib/schedule.js';

test('no delivery before 10:00; due at 10:00 and for same-day catch-up', () => {
  assert.equal(dueDay(new Date(2026, 9, 12, 9, 59, 59)), null);
  assert.equal(dueDay(new Date(2026, 9, 12, 10, 0, 0)), '2026-10-12');
  assert.equal(dueDay(new Date(2026, 9, 12, 23, 59)), '2026-10-12');
  assert.equal(dueDay(new Date(2026, 9, 13, 0, 1)), null);
});
test('calendar scheduling stays at 10:00 and crosses month/year boundaries', () => {
  const before = new Date(nextDailySend(new Date(2026, 9, 12, 9)));
  assert.equal(localDay(before), '2026-10-12');
  assert.equal(before.getHours(), 10);
  const after = new Date(nextDailySend(new Date(2026, 11, 31, 10)));
  assert.equal(localDay(after), '2027-01-01');
  assert.equal(after.getHours(), 10);
  assert.equal(after.getMinutes(), 0);
});
test('daylight-saving transitions use calendar days rather than a 24-hour interval', () => {
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { nextDailySend } from './src/lib/schedule.js';
    const start = new Date(2026, 2, 7, 10);
    const next = new Date(nextDailySend(start));
    process.stdout.write(JSON.stringify({ hour: next.getHours(), day: next.getDate(), elapsed: next - start }));
  `], { cwd: new URL('../', import.meta.url), env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' }));
  assert.deepEqual(result, { hour: 10, day: 8, elapsed: 23 * 60 * 60 * 1000 });
});
