import { SafeError, isSafeArticleUrl } from './security.js';
// Feishu owns notes, topics and status. Upload only new captures; never overwrite
// an existing record with the browser's older copy.
export const ARTICLE_FIELDS = { 标题: 1, 链接: 15, 内容: 1, 类别: 3, 阅读状态: 3, 推荐指数: 2, 笔记: 1, 时间: 5 };
export const LEGACY_ARTICLE_FIELDS = { 标题: 1, 链接: 15, 收藏ID: 1, 阅读状态: 3, 主题: 18, 我的理解: 1, 收藏时间: 5 };
export const TOPIC_FIELDS = { 主题: 1, 核心问题: 1, 阶段结论: 1, 下一步: 1 };

export function textOf(value) {
  if (typeof value === 'string') return value.slice(0, 64000);
  if (Array.isArray(value)) return value.map(v => typeof v === 'string' ? v : typeof v?.text === 'string' ? v.text : '').join('').slice(0, 64000);
  return '';
}

export function topicIds(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap(v => typeof v === 'string' ? [v] : v?.record_ids || (v?.record_id ? [v.record_id] : []));
}

export function validateConfig(config = {}) {
  for (const key of ['baseToken', 'articleTableId', ...(config.topicTableId ? ['topicTableId'] : [])]) {
    if (typeof config[key] !== 'string' || !/^[a-zA-Z0-9]+$/.test(config[key])) {
      throw new SafeError(`请在扩展设置中填写有效的 ${key}（只填写 ID，不是完整链接）。`);
    }
  }
  if (config.topicTableId && config.articleTableId === config.topicTableId) throw new SafeError('素材表和主题表必须是两个不同的数据表。');
  if (config.schema && !['briefing', 'legacy'].includes(config.schema)) throw new SafeError('schema 只支持 briefing 或 legacy。');
  if (config.schema === 'legacy' && !config.topicTableId) throw new SafeError('旧版双表模式需要 topicTableId。');
  return config;
}

export function checkFields(fields, expected, label, topicTableId) {
  for (const [name, type] of Object.entries(expected)) {
    const field = fields.find(f => f.field_name === name);
    const compatible = (type === 18 && field?.type === 21) ||
      (name === '链接' && field?.type === 1) || (name === '类别' && field?.type === 4) ||
      (name === '推荐指数' && field?.type === 20);
    if (!field || (field.type !== type && !compatible)) {
      throw new SafeError(`${label}的「${name}」字段缺失或类型不正确，请按 README 配置。`);
    }
    if (name === '主题' && type === 18 && field.property?.table_id !== topicTableId) {
      throw new SafeError('素材表的「主题」字段必须关联到配置的主题表。');
    }
  }
}

export function normalizeArticle(record) {
  const f = record.fields || {};
  if (!/^rec[A-Za-z0-9]{1,128}$/.test(record.record_id || '')) throw new SafeError('Feishu returned an invalid record ID.');
  const status = textOf(f.阅读状态);
  const rawUrl = typeof f.链接?.link === 'string' ? f.链接.link : textOf(f.链接);
  return { recordId: record.record_id, captureId: textOf(f.收藏ID), title: textOf(f.标题),
    url: isSafeArticleUrl(rawUrl) ? rawUrl : '', status, read: !['待阅读', '阅读中'].includes(status),
    content: textOf(f.内容), category: Array.isArray(f.类别) ? f.类别.map(textOf).join('、') : textOf(f.类别),
    recommendation: typeof f.推荐指数 === 'number' ? f.推荐指数 : null,
    topicIds: topicIds(f.主题), note: textOf(f.笔记 ?? f.我的理解), savedAt: f.时间 ?? f.收藏时间 ?? null };
}

export function createKnowledgeService(request) {
  let queue = Promise.resolve();
  const serial = fn => { const run = queue.then(fn); queue = run.catch(() => {}); return run; };
  async function api(method, path, { params, data } = {}) {
    const result = await request(method, path, { params, data });
    if (result.code && result.code !== 0) throw new SafeError('Feishu API rejected the operation.');
    return result.data || {};
  }
  const pathFor = (c, table) => `/open-apis/bitable/v1/apps/${c.baseToken}/tables/${table}`;
  async function list(path) {
    const all = [], seen = new Set();
    let token;
    do {
      const page = await api('GET', path, { params: { page_size: 100, ...(token ? { page_token: token } : {}) } });
      if (!Array.isArray(page.items)) throw new SafeError('飞书未返回完整列表，请检查飞书授权权限。');
      if (all.length + page.items.length > 10000) throw new SafeError('The table exceeds the 10000-record sync limit.');
      all.push(...page.items);
      if (!page.has_more) return all;
      if (seen.size >= 100) throw new SafeError('Too many pagination responses; sync stopped before writing.');
      token = page.page_token;
      if (!token || seen.has(token)) throw new SafeError('飞书分页响应异常，已停止同步。');
      seen.add(token);
    } while (true);
  }
  async function syncNow({ config, items = [] }) {
    validateConfig(config);
    if (!Array.isArray(items) || items.length > 5000) throw new SafeError('每次最多同步 5000 条本地收藏。');
    // Validate all captures before any external write.
    for (const item of items) {
      if (!item.id || typeof item.url !== 'string' || (!item.feishuRecordId && !isSafeArticleUrl(item.url)) ||
          !Number.isFinite(Date.parse(item.savedAt))) throw new SafeError('本地收藏包含无效 ID、链接或时间。');
    }
    const articlesPath = pathFor(config, config.articleTableId);
    const legacy = config.schema === 'legacy' || (!config.schema && !!config.topicTableId);
    const articleFields = await list(`${articlesPath}/fields`);
    checkFields(articleFields, legacy ? LEGACY_ARTICLE_FIELDS : ARTICLE_FIELDS, '素材表', config.topicTableId);
    const topicsPath = legacy ? pathFor(config, config.topicTableId) : null;
    if (legacy) checkFields(await list(`${topicsPath}/fields`), TOPIC_FIELDS, '主题表');
    const records = await list(`${articlesPath}/records`);
    const topics = legacy ? await list(`${topicsPath}/records`) : [];
    const byId = new Map(records.map(r => [r.record_id, r]));
    const byCapture = new Map(records.map(r => [textOf(r.fields?.收藏ID), r]));
    const byUrl = new Map(records.map(r => [normalizeArticle(r).url, r]).filter(([url]) => url));
    const bindings = [];
    let created = 0;
    for (const item of items) {
      const linkedHere = item.feishuRecordId && item.feishuBase === config.baseToken + '/' + config.articleTableId;
      let record = linkedHere ? byId.get(item.feishuRecordId) : byCapture.get(item.id) || byUrl.get(item.url);
      // A linked record deleted in Feishu stays deleted; never resurrect it.
      if (!record && (linkedHere || !isSafeArticleUrl(item.url))) continue;
      if (!record) {
        const linkIsText = articleFields.find(f => f.field_name === '链接').type === 1;
        const fields = { 标题: item.title || item.url,
          链接: linkIsText ? item.url : { text: item.title || item.url, link: item.url },
          阅读状态: item.read ? '已读' : '待阅读',
          ...(legacy ? { 收藏ID: item.id, 收藏时间: Date.parse(item.savedAt) } : { 内容: item.content || '',
            类别: articleFields.find(f => f.field_name === '类别').type === 4 ? ['待分类'] : '待分类',
            笔记: '', 时间: Date.parse(item.savedAt) }) };
        const result = await api('POST', `${articlesPath}/records`, { data: { fields } });
        record = result.record;
        if (!record?.record_id) throw new SafeError('飞书未返回记录 ID；请重试同步，已有记录会按链接去重。');
        record = { ...record, fields: { ...fields, ...record.fields } };
        records.push(record);
        byCapture.set(item.id, record);
        byUrl.set(item.url, record);
        created++;
      }
      bindings.push({ id: item.id, recordId: record.record_id });
    }
    return { created, bindings, articles: records.map(normalizeArticle), topics: topics.map(r => ({
      id: r.record_id, name: textOf(r.fields?.主题), question: textOf(r.fields?.核心问题),
      synthesis: textOf(r.fields?.阶段结论), next: textOf(r.fields?.下一步),
    })) };
  }
  return { sync: body => serial(() => syncNow(body)) };
}
