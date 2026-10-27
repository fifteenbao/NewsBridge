# Project collaboration rules

## Scope and architecture

- Before adding a hosting platform, external service, external account, recurring cloud job, deployment workflow, cost, or a different credential-management architecture, explain why it is needed, the data and trust boundaries, maintenance impact, and available choices. Obtain the user's explicit choice before implementation.
- A request such as “connect directly to Feishu APIs” or “improve security” does not by itself authorize selecting a cloud provider or introducing an additional architectural dependency.
- Read-only investigation, fixes within the accepted architecture, local tests, and documentation may proceed without repeated permission questions.
- If a change cannot be completed within the accepted scope, explain the blocker and ask for the missing decision rather than silently expanding the architecture.
- ReadFlow is a portable Chrome extension with an optional provider-neutral connection contract. Do not require a particular CLI, cloud provider, server OS, process manager, or agent product. Existing tools may implement the contract; never claim compatibility without testing their identity, task and message capabilities.
- Public defaults have no endpoint or granted host permissions. Users may configure an HTTPS endpoint in Settings: declare HTTPS hosts as optional and request only the chosen exact host from a user gesture. A private extension build may prefill one exact HTTPS origin chosen by the operator. Keep real domains, identities and credentials out of source and public packages. Do not introduce listeners or infrastructure automatically.
- Agent-assisted setup should inspect capabilities, configure an existing connection, validate the contract, and report missing capabilities. It must not rewrite core source or silently deploy new services.

## Product boundaries

- Position ReadFlow as an open-source Chrome extension for saving articles, videos, and other content that takes time to understand, with the server SQLite database as the sole source of truth. No Bitable synchronization. CSV exports come from the database. Analysis belongs to an existing conversational agent on any supported conversation surface. Feishu remains an optional current link-intake channel; ReadFlow must not call model APIs or store model credentials. Approved agents may query records and append explicitly confirmed cited reviews through the separate signed agent API. Chat confirmation is attested by the trusted agent, not independently verified by ReadFlow. Retain Chrome capture and support explicitly configured Feishu private-message link intake. Do not reintroduce other spreadsheet providers. The core workflow is capture, organize, read or watch, take notes, and review related material.
- Capture stores page titles, links, optional multi-select 标签 (no tag-count cap; preserve per-tag length and whole-request limits) and a single 笔记 (internal key remark). Preserve and combine legacy note/remark text without duplication. Explicit metadata edits may update tags and the unified note; ordinary sync must preserve database edits. CSV exports only 标题、链接、阅读状态、时间、标签、笔记、标记已读时间. Record server-side read transitions and preserve history; never fabricate missing historical read times. The collection with counted unread/read/skipped filters is the default home. Never reverse-import Bitable edits. Do not imply video downloading, transcription, automatic playback tracking, or AI knowledge synthesis unless those features are explicitly requested and implemented.
- Public product scope is recorded in README.md. Product planning files matching **/*PRD*.md are local-only and must not be committed; docs/MVP-PRD.md may be available locally. The signed agent query/confirmed review storage contract is implemented; live Hermes integration, Chrome review UI and scheduled AI reviews remain unverified or unimplemented. State those boundaries accurately.
- Keep reading-state synchronization. Daily unread reminders are temporarily removed: do not expose reminder controls or enable daily sending, including from old saved preferences. Retain Feishu link intake and its existing ingest task; future reminders need a separate product decision.
- Do not add calendar booking or product-specific agent connectors. A generic adapter interface is authorized.
- Do not add or redesign frontend pages as part of documentation, backend, or security work. Necessary changes to existing page logic should be limited to verified security or functional fixes, and their purpose should be explained.
- Maintain Chinese as the primary documentation language. Do not create parallel translated documents until requested. Preserve upstream attribution and the MIT license; keep personal credentials out of examples.

## Release versioning

- Before every push containing new changes, increment the patch version by default (for example 0.4.1 → 0.4.2), unless the user explicitly specifies a different target version. Update package.json and manifest.json together, record the changes in CHANGELOG.md, update version references in documentation, and regenerate versioned archives before committing and pushing. A retry of the same versioned commit after a failed push must not increment the version again. Never commit, tag, push or publish without user authorization.
- Keep manifest.json and package.json aligned. Internal edits and task iterations do not each require a version bump; the bump is required when preparing new changes for a push. This standing versioning preference does not itself authorize a push.

## Verification

- Run `npm test` and `npm run security` after relevant changes.
- Never log authorization codes, access tokens, App Secrets, full credential URLs, or raw provider error payloads.
- Report whether validation used offline mocks or an actual deployment. Do not present mocked tests as proof of live security.
