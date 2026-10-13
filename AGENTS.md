# Project collaboration rules

## Scope and architecture

- Before adding a hosting platform, external service, external account, recurring cloud job, deployment workflow, cost, or a different credential-management architecture, explain why it is needed, the data and trust boundaries, maintenance impact, and available choices. Obtain the user's explicit choice before implementation.
- A request such as “connect directly to Feishu APIs” or “improve security” does not by itself authorize selecting a cloud provider or introducing an additional architectural dependency.
- Read-only investigation, fixes within the accepted architecture, local tests, and documentation may proceed without repeated permission questions.
- If a change cannot be completed within the accepted scope, explain the blocker and ask for the missing decision rather than silently expanding the architecture.
- The user explicitly selected an Aliyun Simple Application Server running Ubuntu 24.04 for both Chrome synchronization and daily reminders. The real approved HTTPS origin is private deployment information, stored only in Git-ignored local configuration. Public docs, examples, tests, and extension defaults must use https://newsbridge.example.com. Chrome may access only the operator-configured exact origin; no wildcard domain permission, local-device listener, hosted OAuth platform, or browser credential scraping is allowed. Keep Feishu credentials in the server's authorized lark-cli workspace and use a separate scoped service key for Chrome. Prepare source and deployment instructions; do not access or deploy to the actual server without authorization and connection details.

## Product boundaries

- Position NewsBridge as an open-source Chrome extension for saving articles, videos, and other content that takes time to understand, with Feishu Bitable as the data-management workspace. The core workflow is capture, organize, read or watch, take notes, and review related material.
- Capture stores page titles and links. Do not imply video downloading, transcription, automatic playback tracking, or AI knowledge synthesis unless those features are explicitly requested and implemented.
- Keep reading-state synchronization part of the core workflow. Daily unread reminders are an optional supporting feature, owned by the server at 10:00 Asia/Shanghai by default. Chrome must never independently send daily reminders. Hosting is an implementation detail, not the product's primary identity.
- Do not add calendar booking or agent connectors.
- Do not add or redesign frontend pages as part of documentation, backend, or security work. Necessary changes to existing page logic should be limited to verified security or functional fixes, and their purpose should be explained.
- Keep English and Simplified Chinese documentation aligned, preserve upstream attribution and the MIT license, and avoid personal credentials in committed examples.

## Verification

- Run `npm test` and `npm run security` after relevant changes.
- Never log authorization codes, access tokens, App Secrets, full credential URLs, or raw provider error payloads.
- Report whether validation used offline mocks or an actual deployment. Do not present mocked tests as proof of live security.
