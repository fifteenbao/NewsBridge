# NewsBridge MVP PRD: a reading conversation with a useful outcome

English | [简体中文](MVP-PRD.zh-CN.md)

Document revision: draft 0.1 · 2026-10-15. A product discussion, not a release version, implementation claim or infrastructure decision. See README for shipped behavior.

## 1. Product hypothesis

People already save worthwhile articles and videos, but lack a prompt to start and feedback that helps turn reading into understanding and application.

NewsBridge initiates a short reading conversation: a specific starting point, followed by source-grounded explanation, feedback or an application challenge after the user responds.

**Hypothesis:** a concrete reading task with responsive feedback produces more useful reading outcomes than an unread-link invitation alone. This remains unverified.

## 2. Users and context

Initial users save long articles or videos, use Chrome and Feishu, and occasionally want to spend about 5–10 minutes exploring a piece of content.

Typical session: receive a Feishu invitation, read a specified section, express an understanding or question, receive feedback, then revise, apply or finish.

The pilot does not require replacing existing collection tools or integrating every bookmark platform.

## 3. Required session outcome

The user should confirm at least one of these outcomes:

- A question receives an evidence-based explanation, or missing evidence is made explicit.
- An understanding is tested and the user confirms or revises a judgment.
- An idea becomes a specific action the user wants to try.

Saving notes, sending summaries and marking content read do not by themselves count. AI feedback is neither fact verification nor a measure of cognitive ability.

## 4. Core flow and minimum features

| Stage | MVP behavior | Completion condition |
|---|---|---|
| Intake | Reuse Chrome capture or manually submit a link and excerpt; obtain title automatically, make tags and collection reason optional | Save material and disclose available content scope |
| Preparation | Select one unprocessed item; derive a reading location and one question from available text or a supplied excerpt | User can locate the source and understand the task |
| Invitation | Send via Feishu at the user's chosen time, at most once a day; offer start, later, skip and pause | Track delivery separately; no repeated nudges for silence |
| Response | Accept free text with optional Explain / Test my understanding / Apply / Finish intents | Bind reply to the correct material and session |
| Feedback | Give one source-grounded response with at most one follow-up question | User can inspect evidence, challenge or correct feedback |
| Closure | Invite closure after roughly 1–3 exchanges; allow continuation or immediate exit | Show conclusion, open questions and optional next step for user confirmation or editing |
| Follow-up | User explicitly chooses a review or action follow-up time | Return to the concrete question; do not silently create recurring work |

5–10 minutes and 1–3 exchanges are starting design assumptions, not completion requirements or efficacy promises.

### Response handling

| Intent | Response | Example |
|---|---|---|
| Explain | Locate evidence, explain concepts and conditions, disclose gaps | Does “cost” mean coding cost or total project cost? |
| Test understanding | Identify supported, missing or unsupported parts; optionally introduce a new situation | Does this hold when requirements change frequently? |
| Apply | Establish goals and constraints, propose a small action for the user's choice | Record development and rework time on one task |
| Disagree / Ask | Accept challenges, expose evidence, revise AI claims and allow uncertainty | An author's assertion is not automatically an established fact |
| Finish / Skip | Stop questioning and synchronize state | Ending does not automatically mean correct understanding or read completion |

### Example session

1. Invite the user to a roughly five-minute section about development versus delivery speed, linking to the specific source location and asking why the author distinguishes them.
2. User: “Because requirements are unclear.”
3. AI links that answer to rework costs, identifies testing and integration costs with source references, and asks whether faster coding guarantees proportionately faster delivery when requirements are clear.
4. User: “No, testing could remain the bottleneck.”
5. AI offers to save the revision and finish, or help design a time log for a real task. Create follow-up only after user confirmation.

This is a fictional interaction. Actual feedback must be supported by the selected material.

## 5. Content and quality boundaries

- Validate articles first. Analyze video content only with user-provided subtitles or legitimately accessible text; do not assume transcription exists.
- With only a title and link, do not pretend to review full content. Ask for an excerpt or offer capture only.
- Disclose full-text, excerpt or subtitle scope. Label reading-time estimates.
- Distinguish source claims, AI inferences and user interpretations. Preserve links and locatable passages, or timestamps when available.
- Ground questions and feedback in inspectable material. Allow reports of unsupported claims, misunderstanding and misattribution.
- Analyze selected material by default. Additional web research needs a separately explained scope and is not an MVP prerequisite.
- No general intelligence, creativity or cognitive-improvement score. Start with self-explanation, application and revision; do not import the entire six-week training experiment.

## 6. State and data

Keep separate state dimensions:

- Material: unread / read / skipped, confirmed by the user.
- Delivery: queued / sent / failed / uncertain.
- Session: awaiting reply / active / ended; pausing does not force completion.
- Follow-up: unset / due / completed / cancelled.

Minimum records include source and available content, reading location, invitation, original user answer, AI feedback and evidence, revisions and optional follow-up time. Do not overwrite original answers. Persistence supports continuation and review rather than serving as the outcome itself.

Proposed responsibilities: Chrome captures; a backend persists data, schedules work and calls AI; Feishu carries invitations and replies. Feishu / Google tables are not mandatory in this proposed direction; retaining existing support remains undecided.

This defines responsibilities only. Server, model provider, database, cost and credential choices require separate agreement before implementation. Before sending content to AI, explain what material and replies go to which service. Include pause, export and deletion controls.

## 7. Scope

**Include:** a single-user flow, one article per session, user-configured daily invitations, Feishu text replies, three feedback intents, source locations, state synchronization, one optional review, pause, export and deletion.

**Exclude for now:** a new general bookmark manager, full cross-platform import/sync, a full reader, video downloading or transcription, automatic knowledge graphs, external action execution, calendar booking, brain games and the complete six-week training program.

Manually supplied related material may be explored, but cross-document synthesis is not a launch dependency.

## 8. Validation

Start with a small, manually assisted pilot before new deployment or full AI automation. Suggested starting point: 3–5 participants, six invitations each, alternating link-only invitations and concrete tasks with feedback within each participant. Match interest, difficulty and time demands where possible. Adjust scale as needed; interpret results as directional evidence only.

| Measure | Definition |
|---|---|
| Start rate | Explicit reading starts divided by confirmed delivered invitations |
| Useful outcome rate (primary) | Invitations yielding a user-confirmed outcome from section 3 divided by confirmed delivered invitations; ask both conditions consistently |
| Feedback usefulness | Whether feedback advanced understanding and how |
| Voluntary continuation | Choosing another session, review or invitation |
| Burden and errors | Reasons for skipping or pausing, time spent, unsupported feedback and misattribution |

Delivery counts, summary volume, note length and streaks are not primary success measures. The pilot does not establish causal efficacy, long-term retention or broad cognitive improvement.

Proceed when multiple participants repeatedly identify concrete value after replying, want to continue, and find evidence quality and interruption levels acceptable. If users only want summaries, test that product instead. If feedback adds no value, improve the interaction before adding platforms. Agree numerical thresholds before starting the pilot.

## 9. Decisions to refine

1. Is the leading promise easier reading initiation or useful feedback after reading? This draft favors the latter while keeping proactive invitations.
2. Do initial users prefer explanation, a challenge or practical application? Observe voluntary choices rather than enforcing training.
3. Should an invitation immediately offer a task or first ask how much time is available?
4. What content and replies may reach AI, through which service and for how long?
5. Retain existing table support, reduce it to export or remove it? Decide after validation.

This PRD does not initiate refactoring, removal of tables, deployment, real message delivery or a release version change.
