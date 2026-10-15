# Self-hosting NewsBridge (Feishu / Google Sheets)

[中文](SELF-HOSTING.zh-CN.md) · [Setup](../SETUP.md)

The extension sends captures to **your existing connection service over HTTPS**. Only that service holds provider credentials and calls Feishu / Google. Chrome automatically signs using its approved browser pairing; it does not inherit Google or Feishu desktop login. Google Sheets storage uses the Sheets API, not Apps Script. Reminders for either storage provider currently go to a configured **Feishu chat**; Google email delivery is not implemented.

Use Node.js 22+ and a POSIX filesystem for the optional reference below. No npm runtime dependencies are needed. A single machine may run both the service and jobs using the same private state directory and file lock. Multiple machines need a durable shared database and shared lock implemented through the connection contract; copying state files is insufficient. Nothing is deployed or scheduled by importing examples.

Use V0.3.0 connection source together with the V0.3.0 extension for provider switching and custom reminders.

## 1. Choose a configuration

From the repository root, create `private/` with mode 0700. Copy **one** example to a new `private/host.json` (do not overwrite existing configuration):

- Feishu: `examples/host.example.json`.
- Google: `examples/host.google.example.json`.
- Both, selectable in Settings: `examples/host.dual.example.json`.

Fill values privately. `connector` selects the default profile for CLI commands. If `connections` is present, it is the authoritative map of configured `feishu` and `google` profiles; its default must also exist in that map. Keep each profile's `storageProvider` equal to its map key. The same approved browser identity authorizes both configured profiles, so use this only for one trusted user's workspaces. This is not a multi-user account service.

| Setting | Feishu | Google |
| --- | --- | --- |
| storageProvider | `feishu` | `google` |
| connectionId | **`app:<actual appId>`**, e.g. `app:cli_EXAMPLE` | **`google:<actual service-account client_email>`** |
| baseToken | Bitable app token | Spreadsheet ID between `/d/` and `/edit` |
| articleTableId | `tbl…` | Numeric sheet/tab ID (`gid`), **including `0`** |
| chatId | Empty unless reminders enabled | Empty unless Feishu reminders enabled |
| remindersEnabled | `false` until message permission and scheduler ready | Same; also set `messageConnectionId: "app:<actual Feishu appId>"` |
| reminderTime / timeZone | Daily `HH:mm` / IANA timezone; default `10:00` / `Asia/Shanghai` | Same |

`baseUrl` is the public HTTPS URL, optionally with an application path, for example `https://connection.example.com/newsbridge/`. Use the same URL in private extension packaging. `extensionId` can remain empty for initialization and operator checks; browser requests are denied until it contains the actual unpacked extension ID. `stateDir` is relative to host.json; `port` is optional (8787 default), used only by the opt-in loopback server.

Set host.json, host.env and service-account JSON to 0600, owned by the service user, with no symlinks or hard links. Keep `private/`, state, backups and secrets out of Git and published archives. State/key files require private ownership and one hard link; `audit` checks these. On Windows provide a different secure persistence implementation; these POSIX checks are intentional.

## 2A. Feishu provider

Create/use your own Feishu custom application and publish its permitted scopes according to your organization's rules. Grant Bitable field/record read, record create and record update. Share the chosen base with the application with edit access. Wiki links additionally require wiki-node read permission. Message send permission and access to the target `oc_…` chat are needed only for reminders. Broad tenant administration is unnecessary.

Set the actual app ID / secret in private/host.env:

```dotenv
FEISHU_APP_ID=cli_REPLACE_ME
FEISHU_APP_SECRET=REPLACE_ME
```

The adapter acquires a tenant access token at call time and verifies `connectionId === app:<appId>`. A valid token alone is insufficient if the application cannot access the selected table. Configure exactly the eight fields described in [the reading table guide](../KNOWLEDGE-SETUP.md). New users may explicitly run the optional [create-table script](../SETUP.md#create-the-eight-field-table--一键创建八字段表); its creation scopes are separate from ordinary sync.

## 2B. Google provider

1. In your Google Cloud project enable **Google Sheets API**.
2. Create a dedicated service account and obtain its JSON credential through your organization's permitted workflow. Do not enable domain-wide delegation. If service-account keys are prohibited, supply an environment-specific authenticated adapter instead; the reference implements service-account JWT OAuth, not interactive user OAuth or workload federation.
3. Put the credential at an absolute private path with 0600 permissions. Share **only the intended spreadsheet** with its `client_email` as Editor. Cloud IAM roles do not grant access to spreadsheet contents; sheet sharing is a separate step.
4. Create/open a normal grid tab with at least two grid rows, no more than 10,000 allocated grid rows initially, and at least eight columns. Set baseToken from its spreadsheet URL and articleTableId from `gid`. The setup command targets this tab and does not create a new spreadsheet or guess the first tab.
5. Add the private absolute path to host.env (not JSON contents):

```dotenv
GOOGLE_SERVICE_ACCOUNT_FILE=/absolute/private/path/service-account.json
```

6. Run `init`, then the explicit `prepare` command below. On a completely blank A:H grid, prepare writes the eight headers. Existing content requires these headers in order: `标题 | 链接 | 内容 | 类别 | 阅读状态 | 推荐指数 | 笔记 | 时间`; conflicting headers stop without rewriting data. Prepare assigns invisible row developer metadata to imported rows; it adds **no ninth column**. It is an operator write action, not a health check. Avoid simultaneous structural edits while preparing imported rows.

All eight Google columns use plain cell values. Title/link/content/category/status/note are strings; recommendation is a number or blank; time written by NewsBridge is Unix milliseconds. Imported times may be ISO 8601 strings or Unix milliseconds; native Sheets date serials are **not** interpreted as dates. URLs use plain text, not HYPERLINK formulas. API writes use literal strings / RAW, preventing captured `=…` text from becoming formulas. Google has no Feishu field types; the adapter checks the header schema instead.

Records use stable row developer-metadata IDs and status updates use metadata data filters. Whole-row moves retain identity; do not sort a single column independently, remove metadata, merge data cells, or replace the tab. Manually imported new rows need another explicit prepare (at most 1,000 new identities per preparation). Ordinary sync does not silently adopt unknown rows. Blank rows are ignored; zero-record sheets are supported. New captures insert directly below the header. The supported grid ceiling is 10,001 allocated rows (header plus data); at that ceiling creation stops. Delete excess blank grid rows if needed, while retaining at least two rows.

The reference scope is `https://www.googleapis.com/auth/spreadsheets`. Google does not scope it to one tab; minimize exposure by sharing only needed spreadsheets with the dedicated service account. The server additionally restricts requests to the configured spreadsheet/tab and fixed API endpoints. Never paste the JSON key or a Google OAuth token into Chrome Settings.

[Google authorization](https://developers.google.com/identity/protocols/oauth2/service-account) · [Scopes](https://developers.google.com/workspace/sheets/api/scopes) · [Stable metadata](https://developers.google.com/workspace/sheets/api/guides/metadata)

## 3. Initialize and validate

Run as the same user that will own the service and jobs, from the repository root:

```sh
node examples/run.mjs init private/host.json
node examples/run.mjs audit private/host.json
# Google only (add --provider google for a dual-profile host):
node examples/run.mjs prepare private/host.json --env private/host.env --provider google
node examples/run.mjs check private/host.json --env private/host.env
node examples/run.mjs check private/host.json --env private/host.env --write
# For the secondary profile:
node examples/run.mjs check private/host.json --env private/host.env --provider google --write
```

`--env` loads only the explicit file before credential callbacks. File paths in host.env are not resolved relative to that file; use an absolute service-account path. Existing process environment values take precedence. `check` is read-only. `check --write` creates, reads back and removes one marked test record: Feishu deletes it; Google clears only its eight cells and removes its metadata, leaving an empty row. It never deletes existing user records or grid rows. Uncertain cleanup leaves a durable probe journal; inspect the matching test before retrying. Do not clear the journal or delivery receipts blindly.

[Browser pairing](PAIRING.md) replaces manual access keys: fill the extension ID on the host, request pairing from Settings, compare the fingerprint, approve once and check again. New reference initialization does not create access.key.


## 4. Expose the existing service over HTTPS

If your existing router accepts Fetch Request/Response, import `createHost()` from examples/host.js and mount `host.handleRequest` at the configured prefix. Importing never binds a socket. Alternatively explicitly start the optional reference listener:

```sh
node examples/serve.mjs private/host.json --env private/host.env
```

This listens **only on 127.0.0.1**, not the public interface. Keep it under your existing service manager and proxy with HTTPS. Do not open its internal port in the firewall. The listener exists for server-side browser/API transport, not for reading a local desktop login. No local Chrome helper or desktop bridge is required.

For an existing Nginx HTTPS virtual host, an example location (configure your own domain/certificate separately):

```nginx
location /newsbridge/ {
    client_max_body_size 20m;
    proxy_read_timeout 200s;
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header Origin $http_origin;
    proxy_set_header X-NewsBridge-Pair $http_x_newsbridge_pair;
    proxy_set_header X-NewsBridge-Time $http_x_newsbridge_time;
    proxy_set_header X-NewsBridge-Nonce $http_x_newsbridge_nonce;
    proxy_set_header X-NewsBridge-Signature $http_x_newsbridge_signature;
}
```

Preserve the path: no trailing slash after the upstream port. Pass Origin and Authorization unchanged. Apply your existing proxy's rate limits and exclude authorization headers, request bodies and credential URLs from logs. The handler enforces a fixed HTTPS URL, exact extension origin, dedicated key, bounded JSON and two active operations; CORS is not a substitute for authentication. Access without Origin is permitted only with a valid key for operator checks. Public requests must pass through TLS. A proxy on a different machine cannot use this loopback endpoint; wire the handler into that environment with equivalent controls instead.

## 5. Build, associate, disconnect and switch

### Configure the endpoint directly in Settings

Install the public package, or run npm run build and load dist/newsbridge/. Enter **Connection service address** in Settings: your HTTPS baseUrl, optionally including its application path. There is no need to edit CONNECTION_BASE_URL or rebuild for each server. Check / Save asks Chrome for optional access to that specific host; installation does not grant access to all websites. The https://*/* optional declaration enables choosing a host at runtime, not an all-sites grant. Denying permission leaves local capture available. [Chrome optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)

Use the same address as the host's baseUrl. Base/Spreadsheet and Table/gid IDs resolve automatically and are not displayed as inputs. Provider selection changes the adjacent Feishu / Google link label and hint. The header language changes the interface immediately; saving applies it to reminders too, without a second language selector.

Only public HTTPS hosts are currently supported, not http://localhost:8787/. localhost refers to the computer running Chrome, not your remote server. A connection address is not a table URL and does not deploy or authorize a host. The earlier 127.0.0.1:8787 is the server's internal proxy destination; Chrome uses its HTTPS address.

### Fill in the Chrome extension ID

1. Build with the command below. Open chrome://extensions, enable Developer mode and load dist/newsbridge/.
2. Find the **NewsBridge** card and copy its **ID** (32 letters a–p), not its name or version. Settings also shows the actual extension ID in the footer.
3. On the **connection-service machine**, edit private/host.json. Set the top-level extensionId alongside baseUrl and stateDir, not inside connector.
4. Save and restart the service, or reload the existing router configuration and recreate its handler. Then check the connection in extension Settings.

Configuration location (structure only; retain the rest of your file):

```json
{
  "extensionId": "REPLACE_WITH_ACTUAL_CHROME_EXTENSION_ID"
}
```

Use the actual ID without a chrome-extension:// prefix. An empty ID permits startup and authenticated operator checks but denies browser requests. A wrong ID, a handler that has not reloaded, or a moved unpacked folder with an outdated ID causes 403 ORIGIN_DENIED. Re-entering the access key does not fix it.


```sh
npm run build
```

Load `dist/newsbridge/` at a stable folder path. Copy the actual extension ID from chrome://extensions into private/host.json and restart/recreate the host handler. Moving an unpacked directory can change the ID and cause **403 ORIGIN_DENIED**. Keep the same folder/profile during upgrades; never broaden the origin whitelist.

In Settings choose **Feishu Bitable / Google Sheets**, enter the corresponding link, request pairing and confirm its fingerprint on the server, then check again and save. See [pairing](PAIRING.md). Base links may omit table=; Google links may omit gid and then use the configured tab in the **same** spreadsheet. Neither link supplies a Feishu reminder conversation ID. The server must preconfigure the chosen provider; the dropdown does not create credentials or automatically grant access. A dual-profile config allows both without rebuilding the extension or changing the HTTPS address.

Before switching a linked collection, use **Disconnect collection**. It keeps a local archive keyed by the HTTPS endpoint and verified connection identity/table; clears the active linked list, association and preferences; and never deletes remote rows. Unlinked local captures remain. Reconnecting the exact same account/table restores its archive; a different provider/table starts separately, and old linked captures are not uploaded there. Archive storage is limited by Chrome's quota; a failed archive update retains the original data. Removing the extension may erase local archives, so the remote table remains the durable workspace.

Disconnect is local: it does **not** revoke provider authorization or stop server jobs. Pause reminders and save before disconnecting if desired; unresolved messages remain server-side for later reconciliation. Changing accounts/tables on the server also requires disconnect/reassociation. To change the HTTPS host, disconnect and enter the new address in Settings and pair separately, then grant its exact host permission. No rebuild is needed for the configurable public package. Optional prefilled private builds keep their fixed-domain restrictions.

## 6. Customize daily reminders

For either table provider, provision Feishu messaging credentials, a configured chatId and your existing scheduler, then set server `remindersEnabled: true`. For Google also configure messageConnectionId as the verified Feishu app identity. Saving/syncing Google data does not otherwise require a Feishu application.

Settings controls enable/disable and daily `HH:mm` and IANA timezone. The header language is applied to reminders when settings are saved. Defaults remain 10:00 Asia/Shanghai. Save applies the values to durable server preferences; health returns the actual values. Profiles keep separate preferences/receipts. Conversation selection remains server-side so a browser cannot redirect messages.

Run the job every minute or every few minutes, rather than hardcoding 10:00 in a scheduler, so UI time changes take effect. Example for an existing Linux cron (replace paths privately, keep env file private; add one entry per enabled profile):

```cron
* * * * * cd /absolute/path/NewsBridge && /absolute/path/node examples/run.mjs daily private/host.json --env private/host.env --provider feishu >> /private/path/newsbridge-job.log 2>&1
* * * * * cd /absolute/path/NewsBridge && /absolute/path/node examples/run.mjs daily private/host.json --env private/host.env --provider google >> /private/path/newsbridge-google-job.log 2>&1
```

This is optional manual configuration, not an installed scheduled job. Give log directories private permissions and rotate logs. Both jobs and HTTP requests must share stateDir and its cross-process lock. Repeated calls after the configured local time use daily receipts; completed days are not resent. Delay/sleep catches up only the current local date. DST follows the IANA timezone and sends at most once for the completed local date; this is not a guaranteed exact-minute delivery service. Read/skipped/deleted rows are excluded, sending never marks them read, and still-unread rows may recur tomorrow. An uncertain send stays pending until reconciled; changing the time or provider does not erase it.

## Verification boundary

Repository tests use offline API simulations, including empty tables, identity isolation, literal writes, moved row metadata, status updates and reminder timing. They do not prove your real Google/Feishu scopes, sharing, proxy or scheduler work. Run the explicit checks and a disposable capture in your authorized environment before enabling reminders. No real accounts are preconfigured in public packages.
