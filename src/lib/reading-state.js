export const READING_STATUSES = ['待阅读', '已读', '跳过'];
export const isUnread = item => !item.read && item.status !== '跳过' && !item.feishuDeleted;
export const readingStatus = item => item.status === '跳过' ? '跳过' : item.read ? '已读' : '待阅读';
