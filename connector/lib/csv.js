import { readingNote } from '../../src/lib/reading-note.js';
// RFC 4180 quoting plus spreadsheet-formula protection for user-controlled cells.
const cell = value => {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
export function libraryCsv(articles) {
  const rows = [['标题', '链接', '阅读状态', '时间', '标签', '笔记', '标记已读时间']];
  for (const a of articles) rows.push([a.title, a.url, a.status,
    Number.isFinite(a.savedAt) ? new Date(a.savedAt).toISOString() : '', (a.tags || []).join('; '), readingNote(a), Number.isFinite(a.readAt) ? new Date(a.readAt).toISOString() : '']);
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
