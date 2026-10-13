import { isSafeArticleUrl, SafeError } from './security.js';
// Build a Feishu rich-text reading digest from the latest table records.
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
    ? '请阅读或处理这些素材；完成后在飞书多维表格更新阅读状态和笔记。'
    : 'Read or process these items, then update their reading status and notes in Feishu Bitable.' }]);
  return { [zh ? 'zh_cn' : 'en_us']: { title: zh ? `NewsBridge · ${items.length} 条阅读素材` : `NewsBridge · ${items.length} reading items`, content } };
}
