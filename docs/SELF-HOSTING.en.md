# Self-hosting ReadFlow

[简体中文](SELF-HOSTING.md) · [Setup](../SETUP.en.md) · [Agent integration](AGENT.en.md)

ReadFlow provides self-runnable server source code, not hosting. Local-only capture needs no deployment. Synchronization requires this service; AI reviews additionally require an existing independently authorized agent.

The reference implementation uses a single-machine POSIX environment, Node.js 22.13+, private SQLite storage and an existing HTTPS route. No specific cloud, CLI, hosted database or agent is required. Chrome synchronization and CSV need no Feishu credentials. Initialize in the order described in [Setup](../SETUP.en.md).

## Configuration

Copy `examples/host.example.json` to a private directory. Never commit real configuration.

| Field | Meaning |
| --- | --- |
| `baseUrl` | Full HTTPS endpoint, preserving its path prefix |
| `extensionId` | Actual 32-character Chrome ID using a–p; empty permits server preparation but blocks browser pairing |
| `stateDir` | Private directory relative to the config file; HTTP and tasks must share it |
| `connector.storageProvider` | Must be `database` |
| `connector.language` | Default language, `zh` or `en` |
| `feishu.appId` | Optional application ID matching `FEISHU_APP_ID` |
| `feishuInbox` | Optional encrypted intake/card callbacks with exact conversation and sender allowlists |

`node examples/run.mjs init private/host.json` initializes without resetting existing identity or data. Health checks do not call Feishu. Startup fails if the database is missing. Directories require 0700, files 0600, service-user ownership, no symlinks and no multiple hard links.

## HTTPS routing

Mount `createHost(config).handleRequest` on an existing route, or explicitly run:

```sh
node examples/serve.mjs private/host.json
```

The reference service listens only on loopback port 8787, configurable through `port`. Chrome uses the outer HTTPS proxy. Preserve the full path prefix and `X-ReadFlow-*` headers; allow POST/OPTIONS, enforce a 20 MiB request-body limit and disable caching of authenticated responses. Do not expose the loopback port publicly.

Imports do not deploy processes, open listeners, request certificates or install schedules. Use the existing process manager with the same nonprivileged uid for HTTP and tasks. Restart after config changes. Keep the extension folder fixed and verify fingerprints before pairing approval.

## Optional Feishu intake

Provide `FEISHU_APP_ID` and `FEISHU_APP_SECRET` through the service environment or `--env private/host.env` only for messages/callbacks. No spreadsheet permissions or model credentials are needed. Merely using Feishu to chat with an existing agent does not require enabling this intake service.

Sending requires message permissions and a fixed conversation. Intake/card callbacks also require encryption, a verification token and allowlists; see [Feishu guide (Chinese)](FEISHU-INBOX.md). Desktop login or another agent's ability to chat does not grant this service API permissions.

## Existing scheduler

Only after user authorization, use the same config, stateDir, uid and environment:

```sh
node examples/run.mjs ingest private/host.json --env private/host.env
```

Schedule intake only as needed, for example every minute. Daily unread reminders are removed: disable old daily jobs. The CLI no longer exposes daily, and old enabled preferences do not trigger sending.

## Backups and limits

Stop HTTP and tasks, then copy the complete private state directory preserving permissions. SQLite uses FULL synchronous commits and DELETE journaling. A cross-process lock protects writes. Before clearing a stale lock, verify its recorded process is no longer running. Never delete delivery logs to force resending. Use `audit`, `pending` and `inbox-pending` for diagnosis.

The reference library supports up to 10,000 materials. Intake retains up to 2,000 message records and errors at capacity instead of discarding them. Card bindings retain the latest 1,000 messages; older cards cannot update state. Multi-machine clustering and automatic retention are not provided. CSV exports content, not operational state.

Repository checks use real local SQLite and mocked Feishu APIs. Verify actual routing, permissions and event subscriptions in deployment.

## Update to V0.4.3

Record the current commit/startup method and inspect the working tree; do not overwrite local modifications. Pause ReadFlow writes and back up the full private state, real configuration, environment files and pairing identities, preserving permissions. Do not reinitialize the database or regenerate existing keys.

Fetch the V0.4.3 code and verify both package.json and manifest.json report 0.4.3. Run tests, security checks and doctor, then restart with the original config, uid, HTTPS prefix and process manager. Disable only old ReadFlow daily jobs; preserve needed ingest jobs and unrelated application/agent tasks.

Verify health, existing materials/readAt, CSV, browser authorization and independent agent signed queries. Verify the review flow by checking citations, presenting the final content and waiting for explicit user confirmation before saving, then retrieving its returned ID. Report Chrome and agent outcomes separately; server startup alone is insufficient. Never send real reminders as a test.

On failure, retain diagnostics and pause new writes before restoring code and necessary state from backup. Do not discard data created after the update or automatically restore disabled daily jobs during rollback.
