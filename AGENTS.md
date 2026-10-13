# Project collaboration rules

## Scope and architecture

- Before adding a hosting platform, external service, external account, recurring cloud job, deployment workflow, cost, or a different credential-management architecture, explain why it is needed, the data and trust boundaries, maintenance impact, and available choices. Obtain the user's explicit choice before implementation.
- A request such as “connect directly to Feishu APIs” or “improve security” does not by itself authorize selecting a cloud provider or introducing an additional architectural dependency.
- Read-only investigation, fixes within the accepted architecture, local tests, and documentation may proceed without repeated permission questions.
- If a change cannot be completed within the accepted scope, explain the blocker and ask for the missing decision rather than silently expanding the architecture.
- NewsBridge is a portable Chrome extension with an optional provider-neutral connection contract. Do not require a particular CLI, cloud provider, server OS, process manager, or agent product. Existing tools may implement the contract; never claim compatibility without testing their table and message capabilities.
- Public defaults are offline with no host permissions. A private extension build may allow one exact HTTPS origin chosen by the operator. Keep real domains, identities and credentials out of source and public packages. Do not introduce listeners or infrastructure automatically.
- Agent-assisted setup should inspect capabilities, configure an existing connection, validate the contract, and report missing capabilities. It must not rewrite core source or silently deploy new services.

## Product boundaries

- Position NewsBridge as an open-source Chrome extension for saving articles, videos, and other content that takes time to understand, with Feishu Bitable as the data-management workspace. The core workflow is capture, organize, read or watch, take notes, and review related material.
- Capture stores page titles and links. Do not imply video downloading, transcription, automatic playback tracking, or AI knowledge synthesis unless those features are explicitly requested and implemented.
- Keep reading-state synchronization part of the core workflow. Daily unread reminders are an optional supporting feature, triggered by the operator’s existing scheduler at 10:00 Asia/Shanghai by default. Chrome must never independently send daily reminders. Scheduling and durable storage belong to the chosen integration environment.
- Do not add calendar booking or product-specific agent connectors. A generic adapter interface is authorized.
- Do not add or redesign frontend pages as part of documentation, backend, or security work. Necessary changes to existing page logic should be limited to verified security or functional fixes, and their purpose should be explained.
- Keep English and Simplified Chinese documentation aligned, preserve upstream attribution and the MIT license, and avoid personal credentials in committed examples.

## Release versioning

- Release versions are chosen by the user. Keep manifest.json and package.json aligned; do not increment versions merely for internal edits or task iterations.

## Verification

- Run `npm test` and `npm run security` after relevant changes.
- Never log authorization codes, access tokens, App Secrets, full credential URLs, or raw provider error payloads.
- Report whether validation used offline mocks or an actual deployment. Do not present mocked tests as proof of live security.
