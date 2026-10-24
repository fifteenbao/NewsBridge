// RFC 4180 quoting plus spreadsheet-formula protection for user-controlled cells.
const cell = value => {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
export function libraryCsv(articles) {
  const rows = [['标题', '链接', '内容', '类别', '阅读状态', '推荐指数', '笔记', '时间', '标签', '备注']];
  for (const a of articles) rows.push([a.title, a.url, a.content, a.category, a.status, a.recommendation, a.note,
    Number.isFinite(a.savedAt) ? new Date(a.savedAt).toISOString() : '', (a.tags || []).join('; '), a.remark]);
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
