# NewsBridge

**NewsBridge is based on and modified from [zarazhangrui/reading-block-lark](https://github.com/zarazhangrui/reading-block-lark/tree/main). Credit remains with the original author and contributors. The original [MIT license](LICENSE) is retained.**

[English](README.md) | [简体中文](README.zh-CN.md)

**Save content worth your time. Organize it in Feishu.**

NewsBridge is an open-source Chrome extension for saving articles, videos, and other content that takes time to understand. Use Feishu Bitable to organize your collection, reading status, categories, and notes.

Save → organize → read or watch → take notes → review related material.

## Install

Use **Google Chrome 106 or later**. NewsBridge is installed by loading an unpacked extension; you do not need to configure Feishu before trying local capture.

### Download the extension or source

Choose one of these options:

| Download | What to do | Folder to select in Chrome |
| --- | --- | --- |
| Extension package `newsbridge.zip`, if available in this repository's Releases → Assets | Download and unzip it | The extracted folder containing `manifest.json` |
| Source ZIP from this repository's **Code → Download ZIP** | Download and unzip it; no build step is needed | The source root containing `manifest.json`, `src/`, and `icons/` |
| A local source checkout | Load the source root directly, or build the smaller package below | The source root, or `dist/newsbridge/` after building |

If no release package is available, use **Code → Download ZIP**. Download from this NewsBridge repository; the upstream project linked in the attribution is a different extension.

### Load it in Chrome

1. Move the extracted folder to a permanent location on your computer. Chrome continues to read its files, so keep the folder after installation.
2. Enter `chrome://extensions` in Chrome's address bar.
3. Enable **Developer mode** in the upper-right corner.
4. Click **Load unpacked** and select the folder containing `manifest.json`. Select the folder, not the ZIP or the manifest file itself.
5. Confirm that **NewsBridge** appears in the extension list and is enabled.
6. Click Chrome's puzzle-piece **Extensions** button and pin **NewsBridge** to the toolbar.

For the extension package, the selected directory should look like this:

```text
<selected folder>/
├── manifest.json
├── src/
├── icons/
└── LICENSE
```

### Try your first capture

Open an ordinary `https://` article or video page and click the NewsBridge icon. A green `✓` on the icon confirms the save; clicking saves directly without opening a popup. A `!` indicates an unsupported page or a capture/sync error; hover over the icon for details. A sync error does not discard a successful local capture. Right-click the icon and choose **Reading list** to find the saved title and link. Chrome internal pages such as `chrome://extensions` cannot be captured.

The default package works locally with **no host permissions, connection key, or background service**. Feishu synchronization and daily reminders need a separate connection setup; follow [Setup](SETUP.md) or give your agent the [agent setup instructions](docs/AGENT-SETUP.md). Saving a video captures its page title and link, not its video file or transcript.

### Build a package from source (optional)

With Node.js 22+ and npm installed, open a terminal in the project root containing `package.json` and run:

```sh
npm run build
```

This creates the loadable directory `dist/newsbridge/` and archive `dist/newsbridge.zip`. No `npm install` is required. Node.js is needed only for packaging and development, not for daily extension use.

### Installation help

- **“Manifest file is missing or unreadable”:** check that you unzipped the download and selected the directory directly containing `manifest.json`, not its parent.
- **The toolbar icon is missing:** open Chrome's Extensions menu and pin NewsBridge.
- **Saved items do not appear in Feishu:** local installation does not enable synchronization automatically; complete the connection setup linked above.
- **Updating the extension:** replace the files in the same installation folder, then click **Reload** on NewsBridge's card at `chrome://extensions`. Keep the same folder and Chrome profile; removing the extension can erase its local collection.

## Connect Feishu with your existing tools

Feishu sync is optional. NewsBridge defines a connection contract; it does not require a particular command-line tool, cloud provider, server OS, or agent product.

An agent can inspect your existing environment, implement the contract using an authorized Feishu connection, and generate a private extension build for its HTTPS base URL, including an optional application path. A tool that can send chat messages is not necessarily able to read/write Bitable: these capabilities must be verified separately.

- [Setup](SETUP.md): installation and environment checks.
- [Connection contract](docs/CONNECTION.md): adapter operations, authentication and scheduling.
- [Agent setup instructions](docs/AGENT-SETUP.md): what an agent may configure and how to verify it.

The current browser transport is an authenticated HTTPS interface. Existing tools must expose that interface, directly or through an adapter. The repository includes a portable connection module and an adapter template, not preconfigured integrations with third-party products. No new hosting is required when an existing environment can provide the interface.

## Reading table

Keep these exact field names; the English column explains them.

| Feishu field | Meaning | Type |
| --- | --- | --- |
| 标题 | Title | Text, primary field |
| 链接 | Link | URL; text URLs also work |
| 内容 | Content | Text: summary and review questions |
| 类别 | Category | Single or multiple select |
| 阅读状态 | Reading status | Single select |
| 推荐指数 | Recommendation | Number or rating, 1–5 |
| 笔记 | Notes | Text: your observations |
| 时间 | Date | Collection date |

States: **待阅读** (to read), **阅读中** (reading), **已读** (read), **已沉淀** (consolidated), **归档** (archived). Only the first two count as unread. For videos, the same manually updated field represents viewing progress; playback is not tracked.

New captures save a title and link and start uncategorized. Existing notes, content and status belong to Feishu. Sync after capture, at browser startup, manually, and every 15 minutes while Chrome is running and sync is enabled. Changes in Feishu appear on the next sync. Linked read/unread changes are committed locally only after the remote write succeeds. Delete linked records in Feishu; they are not recreated by sync.

## Optional daily reminders

Your existing scheduler can trigger the connection module at **10:00 Asia/Shanghai** (timezone configurable). Enable reminders only after configuring a conversation and verifying message permissions, durable receipts, and shared locking.

It rereads Bitable before sending, excludes read or deleted material, and sends up to 20 linked items per message. There is no five-item threshold. Sending does not mark content read. A completed day is not repeated; later captures wait until tomorrow, and still-unread items can recur the next day. A delayed check catches up only the current day after 10:00.

Chrome never sends scheduled reminders itself. Delivery requires the chosen scheduler and connection to remain available. Uncertain delivery pauses when its retry window expires or its content/status changes; check the conversation before resolving it in Settings.

## Daily Briefing template

Ten starter items include source links, summaries, categories, and suggested ratings. Notes are blank and items start unread. These examples are not an automatically updated news feed. Dates are collection dates.

- [Excel](templates/Daily-Briefing-飞书阅读模板.xlsx)
- [CSV](templates/Daily-Briefing-飞书阅读模板.csv)
- [Editable JSON](templates/daily-briefing.json)
- [Field and view guide](KNOWLEDGE-SETUP.md)

## Development and privacy

```sh
npm run doctor
npm test
npm run security
npm run build
```

No npm runtime dependencies. The connection module takes an adapter, durable storage and a lock from the host environment; it starts no listener or scheduler. Public extension builds contain only the manifest, browser code, icons and license. Real domains and credentials belong in private configuration and private builds, not published releases.

See [security boundaries](SECURITY.md), [architecture](docs/ARCHITECTURE.md), and [related projects](docs/RELATED-PROJECTS.md). Tests use mocked Feishu operations and do not prove compatibility with an untested third-party tool or deployment.

## License

MIT; see [LICENSE](LICENSE). Linked content retains its own copyright and license.
