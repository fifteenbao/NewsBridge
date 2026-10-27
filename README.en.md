# ReadFlow

[简体中文](README.md) · [Introduction](https://bot.fifteenbao.com/readflow/)

**Before you start: local-only capture needs just the Chrome extension. Synchronization requires a self-run ReadFlow service; AI reviews additionally require your own configured agent. This project provides server source code, not hosting, agents, or model accounts.**

## What is it for?

ReadFlow is an open-source Chrome extension for saving articles and video links that deserve time and attention. Add tags and notes, track unread/read/skipped items, and discuss the evidence with your existing agent. Ask about past collections, reading habits, or evidence you may have overlooked. The agent saves a cited review to ReadFlow only after you confirm its specific contents.

Chrome captures content; your self-hosted ReadFlow service stores it in SQLite, the sole source of truth. Your agent performs the analysis. Feishu is just one optional conversation interface for that agent; other existing agent interfaces can be used. ReadFlow does not call model APIs or store model credentials.

## What you need

**Local-only capture:** Chrome 106+ and an extracted extension folder. Choose local-only capture; no agent or server is required. Browser storage is not a database backup.

**Synchronization and AI reviews:** prepare the environment and authorizations below. Synchronization alone does not require an agent.

- **Chrome 106+** and an extracted extension folder in a permanent location.
- **Your existing agent**, capable of running the signing helper or implementing the same HTTP protocol. The helper requires Node.js 22.13+. No new Feishu bot is required merely to discuss reviews.
- **Your own service environment** for synchronization and reviews: a single-machine POSIX runtime, Node.js 22.13+, private persistent SQLite storage, and an existing HTTPS endpoint. The repository supplies reference server code, not a hosted server.
- **Two independent authorizations:** register the installed Chrome extension ID and approve its full pairing fingerprint. Authorize the agent separately; never copy the browser private key to it. No spreadsheet URL or model key is needed in the extension.

For an initial trial, explicitly choose local-only capture. This needs no running server, but browser storage is not a database backup and is not directly queryable by the agent.

## Install the Chrome extension

1. Download an extension archive from Releases, if available, or choose **Code → Download ZIP** in this repository.
2. **Extract it to a permanent folder.** Find the folder directly containing `manifest.json`, `src/`, and `icons/`. Chrome cannot load the ZIP itself.
3. Enter `chrome://extensions` in Chrome's address bar and enable **Developer mode** at the top right.
4. Click **Load unpacked**, select that folder, and check that a ReadFlow extension card appears.
5. Open the toolbar's puzzle-shaped **Extensions** menu and pin ReadFlow. Open an article or video page, click ReadFlow, choose to save the current page, optionally add tags and notes, and check the success or failure message.

Alternatively, build with Node.js 22.13+:

```sh
npm run build
```

No npm dependencies are required. Outputs: `dist/readflow/`, `dist/readflow.zip`, and `dist/readflow-V0.4.3.zip`. To upgrade, replace files in the **same installation folder**, then reload the extension in Chrome. Moving the folder may change the extension ID and require a server allowlist update. Uninstalling can remove local data.

## Connect your library

Follow [SETUP](SETUP.en.md) and [self-hosting instructions](docs/SELF-HOSTING.en.md). Give the settings page's copied configuration task and repository location to your existing agent. The extension does not send that task automatically or provision infrastructure.

Enter your complete ReadFlow HTTPS endpoint, retaining its path prefix. In **Step 2**, connect to obtain a fingerprint, then copy the confirmation task to the service operator's agent. After the operator verifies the full fingerprint and approves it, use **Step 3** to verify approval and save the connection. The extension ID is an allowlist entry, not authentication; subsequent requests are signed.

The initial guide hides after setup. “Update now” uploads pending local items and retrieves current library data and reading states. Disconnecting is for changing libraries: it archives the local list, keeps server data, and does not revoke pairing. Connection failures retain pending captures; only a database acknowledgement counts as synchronized.

## Verify completion

Chrome pairing and agent authorization are independent. A running server or connected extension does not prove that reviews work.

1. **Chrome synchronization:** save a material, verify its database acknowledgement, tags, note and reading state, and find it in CSV.
2. **Agent integration:** query that material using the agent identity, produce a review with verifiable material IDs and citations, present the exact final content, wait for explicit user confirmation, save, then retrieve the returned review ID. Never write an unconfirmed draft.

If only the first check passes, report synchronization as complete and agent integration as pending.

## Capture, read, and export

ReadFlow stores titles, links, tags, a single note, saved time, reading state, and server-recorded time marked read. It does not fetch article bodies, download/transcribe videos, or equate opening a link with reading. The collection is the home screen, with counted unread/read/skipped filters. Tags have no count limit; individual length and overall request limits still apply.

CSV export uploads pending items first and downloads all database records. It handles Unicode, quoting, and spreadsheet formula injection. CSV does not include pairing identities or replace a full private-state backup. No Feishu/Google spreadsheet synchronization is provided.

Separately, optional [Feishu private-message link intake (Chinese)](docs/FEISHU-INBOX.md) can save links to the same library and acknowledge receipt. This is independent of using Feishu to talk with an agent; enabling intake does not enable analysis. Daily unread reminders are temporarily removed. Disable old `daily` jobs; retain configured `ingest` jobs if needed.

## Reviews with your existing agent

Use the [agent integration guide](docs/AGENT.en.md) for independent pairing, signed queries, cited reviews, and confirmation before saving. Hermes has a reference signing helper; actual deployment still needs verification, and universal agent compatibility is not claimed.

Reviews appear in your existing conversation. The agent distinguishes facts from interpretations, checks counterevidence, and avoids unsupported praise or personality claims. After presenting the final content and citations, it requests explicit confirmation before saving. You can retrieve saved reviews through the agent. ReadFlow validates signatures, citations, and content digests; it trusts the authorized agent to report the human confirmation honestly and cannot independently verify that chat identity.

Chrome review pages, scheduled AI reviews, full-text capture, and multi-machine database clustering are not implemented. Tests use local SQLite and mocked external services, not proof of a live deployment.

[Architecture (Chinese)](docs/ARCHITECTURE.md) · [Security (Chinese)](SECURITY.md)

## References and acknowledgements

ReadFlow is based on [zarazhangrui/reading-block-lark](https://github.com/zarazhangrui/reading-block-lark/tree/main). Thanks to the original author and contributors. Original notices and the [MIT license](LICENSE) are retained. The visual direction references [Bold Poster](https://github.com/zarazhangrui/beautiful-html-templates/blob/main/templates/bold-poster/template.html).
