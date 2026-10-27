# Configure ReadFlow

[简体中文](SETUP.md) · [Installation](README.en.md) · [Deployment](docs/SELF-HOSTING.en.md) · [Agent integration](docs/AGENT.en.md)

Local-only capture requires just the extension, not a server or agent. The steps below enable database synchronization. AI reviews additionally require an existing agent with independent authorization. The project provides self-runnable server source code, not hosting.

## 1. Initialize the database

Use a single-machine POSIX environment and Node.js **22.13+**, with built-in `node:sqlite`. No npm dependencies are needed. Some Node versions display an SQLite experimental warning. From the repository root, for a new installation:

```sh
mkdir -m 700 private
cp examples/host.example.json private/host.json
chmod 600 private/host.json
```

Do not overwrite an existing private configuration. Set `baseUrl` to your existing full HTTPS endpoint, including its path prefix. Set `stateDir` to `./state`, resolved relative to the configuration file. `extensionId` may initially be empty; fill it after installing Chrome. Keep credentials and configuration private, even though `private/` is Git-ignored.

```sh
node examples/run.mjs init private/host.json
node examples/run.mjs check private/host.json
node examples/run.mjs audit private/host.json
```

Initialization creates `state/readflow.sqlite` and a stable library identity without replacing existing data. SQLite stores materials, pairings and task state; `state.json` is used only for initialization/permission checks. Directories must be 0700 and files 0600, owned by the service uid, with no symlinks or multiple hard links (`nlink=1`). `audit` checks permissions; `check` checks the database, not Feishu authorization.

## 2. Connect HTTPS

Mount `createHost(config).handleRequest` on an existing HTTPS service, or explicitly start the loopback reference service behind an existing HTTPS proxy:

```sh
node examples/serve.mjs private/host.json
```

See [deployment](docs/SELF-HOSTING.en.md) for routing requirements. Do not expose the loopback port publicly. Importing modules does not launch a service or install schedules.

## 3. Install and pair Chrome

Follow [installation](README.en.md#install-the-chrome-extension). Put the actual extension ID shown at `chrome://extensions` in the server's `extensionId` and restart.

**Keep the installation folder fixed. Moving it may change the extension ID, requiring an allowlist update to avoid `403 ORIGIN_DENIED`. An extension ID is not an authentication key.**

In settings, enter the HTTPS endpoint. Step 2 connects and obtains a fingerprint after granting access to that host. Copy the confirmation task to the service operator's agent. Verify the full fingerprint and extension ID before approving:

```sh
node examples/run.mjs pair-list private/host.json
node examples/run.mjs pair-approve private/host.json --pair-id REQUEST_ID --fingerprint DISPLAYED_HEX
```

After approval, Step 3 verifies and saves the connection. No spreadsheet link or model key is needed. Save a test link within the user's authorized scope and verify database synchronization and CSV. See [pairing details (Chinese)](docs/PAIRING.md) for rejection, revocation and reconnection.

## 4. Export CSV

“Download CSV” first synchronizes pending local materials, then exports all database materials: title, link, reading state, saved time, tags, note and time marked read. It needs no Feishu credentials or spreadsheet permissions.

## 5. Optional Feishu link intake

Follow the [Feishu guide (Chinese)](docs/FEISHU-INBOX.md) only if requested. Use `ingest` to process the queue. This is separate from using Feishu as an existing agent's conversation interface. Daily unread reminders are removed; do not configure reminderTime, remindersEnabled or daily schedules. Disable existing daily jobs. Do not send test messages or install schedules without authorization.

## Backups

Stop service and task processes, copy the entire private state directory preserving ownership/permissions, then restart. CSV is not a backup of pairing or operational state. A missing database must fail startup, not silently create a replacement library.

## Instructions for the configuring agent

Read `AGENTS.md` and this guide first.

1. Inspect only relevant runtime, HTTPS, private storage and scheduler capabilities. Do not scan unrelated credentials. Ask before introducing platforms, accounts or costs.
2. Follow initialization, checks, installation and pairing in order. Verify full fingerprints; never reset the database to conceal failures.
3. Within authorization, verify deduplication, tag/note edits, offline retries, reading states and CSV. Distinguish mocks from actual deployment checks.
4. Enable Feishu intake only if needed, with minimal permissions. Analysis belongs to the existing agent; do not deploy a new agent or model endpoint.
5. Report the endpoint, fixed installation folder, verification results, backup location and remaining work. Assisting setup does not mean AI reviews are integrated.

A conversation ID alone does not prove analysis support. Do not request model keys or spreadsheet permissions for ReadFlow.

## Authorize the existing agent and verify completion

Follow [agent integration](docs/AGENT.en.md). The agent uses an independent pairing identity; Chrome pairing does not grant it access. Review the library access scope and confirmation trust boundary before approval.

Verify two separate outcomes:

- **Chrome synchronization:** a capture reaches the database with correct metadata and state, and appears in CSV.
- **Agent review:** the independently authorized agent queries that material, generates a review with verifiable IDs and citations, presents the exact final content, waits for explicit user confirmation, saves, and retrieves the same review by the returned ID.

Do not save an unconfirmed draft. If the user has not confirmed, mark save verification pending. A running service or connected browser is not proof of the complete review flow.
