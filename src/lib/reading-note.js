// Keep one user-facing note while preserving distinct text from older records.
export function readingNote(item = {}) {
  return [...new Set([item.remark, item.note].filter(value => typeof value === 'string' && value.trim()))].join('\n\n');
}
