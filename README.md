# NewsBridge

**NewsBridge is based on and modified from [zarazhangrui/reading-block-lark](https://github.com/zarazhangrui/reading-block-lark/tree/main). Credit remains with the original author and contributors. The original [MIT license](LICENSE) is retained.**

[English](README.md) | [简体中文](README.zh-CN.md)

**Save content worth your time. Organize it in Feishu.**

NewsBridge is an open-source Chrome extension for saving articles, videos, and other content that takes time to understand. It uses Feishu Bitable to manage your collection, categories, reading status, and notes.

Save something now, return when you have time, and record what you learn. Group related material in Bitable to review it together and connect ideas across individual saves.

## Features

- **Capture:** save the title and link of an article, video page, or other resource from Chrome.
- **Organize:** manage content, categories, recommendations, and notes in Feishu Bitable using the eight fields below.
- **Track progress:** sync reading status between the extension and Bitable. For videos, the same status field represents your viewing progress, updated manually.
- **Review:** use Bitable views to group related material and record your understanding in notes.
- Sync after capture, at browser startup, manually, and every 15 minutes while Chrome is running and sync is enabled.

Video capture saves the page title and link; it does not download videos, transcribe audio, or automatically track playback.

## Optional daily reminders

With a Feishu conversation configured, the server sends unread-content reminders at 10:00 in its configured timezone (Asia/Shanghai by default). Reminders support the reading workflow; capture and table management do not require a reminder destination.

- Send linked titles, categories, summaries, and notes to a Feishu `chat_id`, as your signed-in user.
- Refresh Bitable before each send. Read, consolidated, archived, deleted, and link-free items are excluded.
- Keep delivery receipts separate from reading status. Sending a reminder never marks its articles as read; still-unread items are reminded again the next day.

Daily reminders include unread items with HTTP(S) links, oldest first. There is no minimum: one unread item is enough. An empty collection sends nothing. Large collections are split into messages of up to 20 items, including the remainder. Messages can be English or Simplified Chinese.

Each account/table/chat scope completes at most one daily run. Items added after that run wait until the next day. Capture and manual sync update the table without sending a reminder.

The server and its scheduled job must be running, with valid Feishu authorization. Chrome does not need to be open for reminders about content already synced to Bitable. If a run is missed, the next server check after 10:00 attempts that day's reminder; previous missed days are not replayed. If CLI authorization cannot renew, reauthorize in its configured workspace.

## Reading table

Use these exact field names. The English labels explain their meaning.

| Feishu field | Meaning | Type |
| --- | --- | --- |
| 标题 | Title | Text, primary field |
| 链接 | Link | URL; text URLs also work |
| 内容 | Content | Text: summary and review questions |
| 类别 | Category | Single select; multiple select also works |
| 阅读状态 | Reading status | Single select |
| 推荐指数 | Recommendation | Number, 1–5; rating fields also work |
| 笔记 | Notes | Text: your own observations |
| 时间 | Date | Date added to the collection |

Suggested categories: **Builder Insights**, **Tech Radar**, **Project Watch**, **Try This**, and **待分类** (uncategorized).

Reading states: **待阅读** (to read), **阅读中** (reading), **已读** (read), **已沉淀** (consolidated), and **归档** (archived). The first two count as unread. **已归档** is also recognized as archived.

Feishu is the source of truth for existing content, notes, and status. New captures contain a title and link and start uncategorized. NewsBridge does not scrape article text, generate summaries, or assign scores. Edit notes in Bitable; toggle read/unread in either Bitable or the extension. Deleted linked records are not recreated.

## Getting started

Follow the [server setup guide](SETUP.md) for the configuration files and deployment sequence.

Use Chrome 106+ and a Feishu account that can edit your Bitable. The connection service runs on a server with Node.js 22+ and an authorized [official lark-cli](https://github.com/larksuite/cli).

1. Import the Daily Briefing template below and check the eight field types and reading-status options.
2. Configure your own HTTPS service using the [server configuration example](server/server.config.example.json), [Nginx templates](deploy/nginx/), and [systemd service and timer templates](deploy/systemd/). Configure the table, authorized account, and extension ID; a chat ID is optional.
3. Set your exact server origin with `node scripts/configure-server.mjs https://your-server.example`. Configure the same origin in the server and Nginx settings. The domain in this repository is a deployment example, not a public service.
4. At `chrome://extensions`, enable Developer mode and load this project folder. Use the resulting extension ID in the server configuration.
5. Enter your service access key in the extension's Settings, check the connection, and sync your collection. Feishu credentials stay on the server.

Capture and manual sync update the table. Enable the server's daily timer when you want unread reminders; its first run after 10:00 can send that day's reminder.

## Connection

The path is **Chrome → your HTTPS service → authorized lark-cli → Feishu cloud APIs**. The extension can access only the configured server origin. The service limits access to the configured table, conversation, and supported fields.

The current deployment templates target an Ubuntu 24.04 server. Nginx receives HTTPS requests and forwards them to a service listening only on the server's loopback address. No service listens on the user's computer. NewsBridge does not read Feishu desktop login data or browser cookies; CLI authorization is required.

## Daily Briefing template

The template contains ten example items with source links, summaries, categories, and suggested ratings. Personal notes are blank; all items start unread. Dates indicate collection dates, not publication dates. Supplementary reading and proposed experiments are labeled.

- [Excel template](templates/Daily-Briefing-飞书阅读模板.xlsx)
- [CSV import file](templates/Daily-Briefing-飞书阅读模板.csv)
- [Editable JSON source](templates/daily-briefing.json)

These are starter examples rather than an automatically updated news feed. Use Bitable views grouped by category and filtered by reading status to review related material together.

## Data and delivery receipts

Captures, language settings, table snapshots, and the service access key are stored in the current Chrome profile. Feishu credentials are managed by lark-cli on the server; the extension stores no Feishu App Secret, access token, or refresh token. Delivery receipts live in `notification-state.json` in the configured private server state directory. Keep credentials and receipts out of Git and back them up as private data.

Receipts are scoped by app, account, table, and conversation. A shared process lock serializes server requests and daily jobs using the same state directory. Receipts survive browser restarts. Separate server state directories do not share receipts: configure one sender per destination.

An uncertain send retries with its original UUID within one hour. Older requests, changed links, or changed reading states pause retries. Verify the target conversation, then confirm **Delivered** or **Not delivered** in Settings. Do not erase the entire journal. See [delivery recovery](docs/ARCHITECTURE.md#delivery-recovery).

NewsBridge includes no analytics, calendar booking, or agent connectors. [Related projects](docs/RELATED-PROJECTS.md) lists the original author's independent Feishu bridge. The CLI's own data handling is described in [SECURITY.md](SECURITY.md).

## Tests and security

```sh
npm test
npm run security
```

Tests cover field mapping, reading-state synchronization, daily scheduling, catch-up, next-day reminders, delivery retries, identity checks, private files, process locking, and HTTPS API authentication and request restrictions. Feishu responses are mocked; tests never log in or send real messages. Local tests do not verify an actual deployment.

Controls include exact extension origins, fixed CLI executable/workspace, table and recipient restrictions, reading-field limits, no arbitrary commands, private journals, unsafe-link rejection, and withheld raw errors. See [security scope and limitations](SECURITY.md), the [review report](docs/SECURITY-AUDIT.md), and [architecture](docs/ARCHITECTURE.md).

The extension needs no build step or npm runtime dependencies. Its server requires Node.js and an authorized lark-cli. Deployment templates are configured and installed by the operator. Changes introducing hosting or another architecture require an explicit choice under [project collaboration rules](AGENTS.md).

## License

MIT; see [LICENSE](LICENSE). Linked content retains its own copyright and license.
