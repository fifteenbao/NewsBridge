import { isSafeArticleUrl, SafeError } from '../../src/lib/security.js';
// Build a Feishu rich-text reading digest from the selected reading records.
const clip = (value, max) => String(value || '').slice(0, max);
export function buildReadingMessage(items, language = 'en', mentionOpenId) {
  if (items.some(item => !isSafeArticleUrl(item.url))) throw new SafeError('Unsafe article links cannot be sent.');
  const zh = language === 'zh';
  const content = [];
  if (mentionOpenId) content.push([{ tag: 'at', user_id: mentionOpenId }]);
  items.forEach((item, index) => {
    content.push([{ tag: 'text', text: `${index + 1}. ` },
      { tag: 'a', text: clip(item.title || item.url, 160), href: item.url }]);
    if (item.category) content.push([{ tag: 'text', text: `${zh ? '类别' : 'Category'}: ${clip(item.category, 80)}` }]);
    if (item.content) content.push([{ tag: 'text', text: clip(item.content, 400) }]);
    if (item.note) content.push([{ tag: 'text', text: `${zh ? '笔记' : 'Notes'}: ${clip(item.note, 240)}` }]);
  });
  content.push([{ tag: 'text', text: zh
    ? '请阅读或处理这些素材；完成后在 ReadFlow 更新阅读状态。'
    : 'Read or process these items, then update their reading status in ReadFlow.' }]);
  return { [zh ? 'zh_cn' : 'en_us']: { title: zh ? `ReadFlow · ${items.length} 条阅读素材` : `ReadFlow · ${items.length} reading items`, content } };
}


export function buildReadingCard(items, language, requestId) {
  if (items.some(item => !isSafeArticleUrl(item.url))) throw new SafeError('Unsafe article links cannot be sent.');
  const zh = language === 'zh';
  return { config: { wide_screen_mode: true }, header: { title: { tag: 'plain_text', content: zh ? 'ReadFlow · 阅读邀请' : 'ReadFlow · Reading invitation' } },
    elements: items.flatMap(item => [
      { tag: 'div', text: { tag: 'plain_text', content: clip(item.title || item.url, 160) } },
      { tag: 'action', actions: [
        { tag: 'button', text: { tag: 'plain_text', content: zh ? '打开原文' : 'Open' }, url: item.url },
        ...[['read', zh ? '已读' : 'Read'], ['later', zh ? '稍后（24小时）' : 'Later (24h)'], ['skip', zh ? '跳过' : 'Skip']].map(([action, content]) =>
          ({ tag: 'button', text: { tag: 'plain_text', content }, value: { action, recordId: item.recordId || item.id, requestId } }))
      ] }
    ]) };
}
