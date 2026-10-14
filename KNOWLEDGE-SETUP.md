# NewsBridge reading table / 阅读表配置

Use one eight-column Feishu Bitable. Your existing authorized connection implements the NewsBridge contract. Follow [SETUP.md](SETUP.md) for the connection and [README](README.md) / [中文说明](README.zh-CN.md) for the reading workflow.

使用一个八字段飞书多维表格，由用户已有的授权连接通过 NewsBridge 接口访问。连接步骤和阅读流程见上述文档。

| Field / 字段 | Type / 类型 | Purpose / 用途 |
| --- | --- | --- |
| 标题 | Text, primary / 文本主字段 | Article title / 素材标题 |
| 链接 | URL or text / 超链接或文本 | Public HTTP(S) source / 公开来源链接 |
| 内容 | Text / 文本 | Summary and review questions / 摘要、回顾问题 |
| 类别 | Single/multiple select / 单选或多选 | Group related material / 聚合相关素材 |
| 阅读状态 | Single select / 单选 | Reading progress / 阅读进度 |
| 推荐指数 | Number/rating / 数字或评分 | Suggested 1–5 / 建议 1–5 |
| 笔记 | Text / 文本 | Your observations and synthesis / 个人理解和聚合结论 |
| 时间 | Date / 日期 | Collection date / 收藏日期 |

Import [Excel](templates/Daily-Briefing-飞书阅读模板.xlsx) or [CSV](templates/Daily-Briefing-飞书阅读模板.csv). The [JSON source](templates/daily-briefing.json) contains the same starter content. Confirm types after import; importing a spreadsheet does not guarantee the correct Bitable field types.

模板提供 10 条初始素材，不是自动新闻订阅。导入后检查字段类型，个人笔记留给用户填写；时间是收藏日期。

Add categories **Builder Insights**, **Tech Radar**, **Project Watch**, **Try This**, and **待分类**. Add reading states **待阅读、阅读中、已读、跳过、已沉淀、归档**. Only `待阅读` and `阅读中` are unread; unknown/empty states are excluded from reminders. Safe links are also required. New Chrome captures start as `待分类`; the extension does not summarize article bodies or assign scores.

添加上述类别和状态；只有“待阅读”和“阅读中”会参与提醒，空白或未知状态不推送。新收藏默认为“待分类”，正文摘要与评分由用户整理。

Create an unread view filtered to the first two states and group by category. Create a review view for `已读` and `已沉淀`. Add shared conclusions, disagreements, and practical experiments in `笔记`; use Feishu's views to bring related material together.

建议建立按类别分组的未读视图，以及已读/已沉淀的回顾视图，在笔记里写共同结论、分歧和验证结果。

Feishu owns existing content, notes, links, and status. Changes are read at the next sync. Chrome read/unread toggles update only `阅读状态`, then update the cache after success. Delete linked items in Feishu; a later sync marks the local link as deleted without recreating the record. Delivery receipts remain separate from reading progress.

已有记录以飞书为准。扩展只在状态更新成功后修改本地状态，不覆盖笔记和内容；关联记录在飞书中删除，下次同步标记本地关联已删除，不会重新创建记录。发送提醒不改变阅读状态。

Skip / 跳过 preserves the record but removes it from the unread extension view and daily reminder selection. Change it back to 待阅读 in Feishu and sync to restore it. A new eight-field table can be created with the optional [one-command setup](SETUP.md#create-the-eight-field-table--一键创建八字段表).

跳过会保留记录，但从插件未读列表及提醒中排除；改回待阅读并同步可恢复。新用户也可用 SETUP 中的一键脚本建表。
