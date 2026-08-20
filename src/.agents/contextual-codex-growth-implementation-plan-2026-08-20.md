# Contextual Codex Growth Implementation Plan

Date: 2026-08-20

Status: Proposed implementation plan

## Executive Summary

Make Codex visibly useful throughout a user's first week in CoCalc by offering
small, contextual, user-initiated actions in notebooks, terminals, LaTeX,
editors, and project navigation. Every offer should explain what Codex will do,
use the current live project context, show the actual funding source, and make
clear whether a per-prompt CoCalc charge can occur.

The objective is not to maximize AI prompts. The objective is to help a user
finish useful work, understand that Codex is already available, return to the
project, and become independently active. The primary outcomes are subsequent
self-directed work and D1/D7 project engagement. Prompt submission, provider
requests, and spend are diagnostic funnel and cost measures.

CoCalc already contains much of the difficult infrastructure: site-funded
Codex admission and accounting, connected ChatGPT plans and API keys, hidden
agent prompts, live-document instructions, notebook and editor actions, an
agent flyout, recent session routing, and growth analytics. The missing product
layer is consistent discovery, funding disclosure, lifecycle/frequency policy,
reliability handling, and outcome measurement across those pieces.

## Evidence and Baseline

Capture these values as the pre-rollout baseline:

- Among 6,144 legitimate new accounts observed since site-funded Codex became
  available, 809 attempted at least one Codex turn (13.2%) and 651 completed at
  least one successful turn (10.6%).
- 388 new users attempted multiple turns, 278 completed multiple successful
  turns, and only 75 returned to Codex on another calendar day.
- Across the broader observed population, 947 users attempted Codex, 755 had at
  least one successful turn, 341 had at least two successful turns, 229 had at
  least three, and 71 had at least ten.
- In first-run onboarding, 561 users selected the Codex path, but only about
  190 reached project-ready and about 195 eventually completed a successful
  turn. Selection, switching, and event timing mean those counts are not a
  simple funnel, but they show substantial loss before useful output.
- Reported site-funded Luna medium spend for the queried recent period was about
  $9.68 at the time of the audit. Cost is not the immediate limiting factor;
  discovery and successful continuation are.
- Known ACP failures are material. A historical 429 configuration problem
  affected early rollout, active-writer/resume conflicts affected at least 53
  users and 184 turns, and oversized payloads affected a smaller set. These
  failures must be reduced before aggressively increasing prompt volume.
- When the expanded onboarding prompt was correctly delivered, even a vague
  request such as “See benchmarks of some basic number theory algorithms” led
  Luna medium to create, execute, validate, and explain a useful notebook in
  under a minute. This confirms that focused hidden context can turn weak user
  prompts into successful first work.

These figures do not prove a retention lift yet. They do show that most new
users never discover or try included Codex, and most users who try it do not
establish a repeat-use habit.

## Goals

1. Make eligible users understand that Codex is available at the point where
   it can solve their current problem.
2. Remove the legacy expectation that every AI request creates a small
   pay-as-you-go CoCalc purchase.
3. Increase successful first turns and second independent turns without
   auto-submitting prompts or surprising users with AI activity.
4. Help users cross concrete product barriers: an empty project, a blank
   notebook, an error, a missing kernel, a LaTeX compile failure, an unfamiliar
   terminal, or an unfinished template.
5. Reuse one consistent agent thread, prompt, funding, loading, error, and
   recovery model across surfaces.
6. Respect course AI restrictions, account preferences, site configuration,
   source credentials, and provider limits.
7. Attribute contextual offers to later meaningful work, D1/D7 engagement,
   reliability, and provider cost without collecting content.
8. Keep the UI fast: no contextual offer may delay a notebook, terminal,
   editor, file list, or project becoming visible.

## Non-Goals

- Do not automatically run Codex because a file is empty or an error appears.
- Do not send project content to Codex before a user explicitly submits an
  action.
- Do not add an AI chatbot overlay unrelated to the current CoCalc task.
- Do not promise unlimited or universally free usage. Membership allowances,
  connected ChatGPT plans, and API keys have different limits and billing.
- Do not reintroduce CoCalc's old per-request AI purchase flow.
- Do not weaken course policies or use full-solution actions when an instructor
  allows hints only.
- Do not add a Codex marketing email cadence. The existing one-time factual
  project-continuation email remains separate. Codex feature email requires the
  normal marketing consent policy; contextual discovery is in-product.
- Do not judge success by total token use or provider spend.

## What Already Exists

### Funding and Entitlement

`useCodexPaymentSource` calls the authoritative payment-source RPC, caches it,
and distinguishes:

- CoCalc Membership (`site-api-key`);
- connected ChatGPT Plan (`subscription`);
- project OpenAI API key;
- account OpenAI API key;
- local/shared credentials in Lite or Launchpad;
- unavailable (`none`).

`getCodexPaymentSourceOptions`, short/long labels, tooltips,
`MembershipUsageMeters`, quota help, and Codex settings already expose much of
the required information. Contextual UI should compose these primitives rather
than infer entitlement from membership names or duplicate allowance math.

### Agent Submission and Live Context

`submitNavigatorPromptInWorkspaceChat` and
`dispatchNavigatorPromptIntent` already support:

- a concise `visiblePrompt` shown in the chat;
- a richer `acp_prompt` sent to the agent;
- immediate floating-agent opening;
- current or new thread routing;
- workspace/path targeting;
- staging in the composer or immediate submission;
- `waitForAgent: false` handoff.

The editor assistant in `frame-editors/ai/create-chat.ts` correctly instructs
Codex to use live synchronized document state. For terminal frames it carries a
live terminal session ID and tells Codex to use terminal history/state/write
APIs. The first-run onboarding prompt detects LaTeX, terminal, notebook,
software, and general goals and prevents a notebook default when another format
fits.

### Existing Contextual Actions

- Jupyter can generate cells at an insertion point.
- Jupyter tracebacks have **Fix with Agent**.
- Missing kernels can be installed with Agent.
- Jupyter has an agent-cell tool with selectable cell context.
- Generic editors have **Help me fix** and **Hint** paths.
- LaTeX rich editing can route formula requests to Agent.
- Terminal onboarding has an **Ask Codex** tour step.
- Environment/capability settings can ask Agent to install software or
  formatters.
- File headers, explorer search, and project navigation have some navigator
  agent intents.
- Every normal frame has a generic Codex command that opens the side agent.
- The project Agents flyout and chat Codex controls show session, model,
  reasoning, source, and usage information.

The problem is not an absence of buttons. Most actions are hidden until the
user already understands the product, several dialogs omit funding reassurance,
and there is no shared first-week policy or end-to-end outcome funnel.

## Product Model: Contextual Offers, Not Popups Everywhere

A **contextual Codex offer** is a bounded, dismissible UI element attached to a
specific task state. It consists of:

- a concrete action, such as “Fix this error” or “Create an analysis from my
  data”;
- one sentence describing what project context will be used;
- the actual funding/charge statement;
- optional suggested requests appropriate to the current surface;
- an explicit user action that opens a composer or confirmation dialog;
- an inspectable expanded prompt before submission when the action includes
  substantial hidden instructions.

Contextual offers have three prominence levels:

1. **Coach card:** visible first-week guidance in an otherwise empty or blocked
   state.
2. **Context callout:** a compact suggestion next to an error, blank artifact,
   or selected object.
3. **Ambient action:** the permanent Agent/Codex button or menu item available
   to experienced users.

The system should promote existing ambient actions at useful moments, then
recede after the user learns them. It should not keep adding banners after the
user has demonstrated successful Codex use.

## Eligibility and Lifecycle

### Availability Gate

An offer renders only when all of these are true:

- account-level AI is not disabled;
- project/course AI policy allows the requested action class;
- the authoritative payment source is not `none`;
- site-funded usage, when selected, is enabled and has a positive allowance;
- the project is writable when the action proposes mutation;
- the current surface supports a safe prompt builder;
- the user has not globally dismissed contextual Codex guidance.

If entitlement is loading, reserve a small stable layout area or render no
offer. Never flash “included” and then replace it with an API-key charge source.
The submit preflight must recheck the source because a cached source can change
while a dialog is open.

### First-Week Window

Use **the first seven distinct active days, capped at 14 calendar days after
account creation**. Calendar-only seven-day logic misses users who sign up and
return several days later; unlimited active-day logic turns onboarding into
permanent promotion.

Special cases:

- invited students see project/course-specific offers only after entering the
  invited project, subject to instructor policy;
- users arriving to purchase or administer licenses without a project see no
  Codex coach;
- template users see template-specific adaptation actions after the template
  entry becomes visible;
- legacy users get a separate one-time trust notice because they may remember
  per-prompt charges, even though they are not in a new-account window;
- users with no available source see normal setup/help UI, not a disabled
  promotional coach card.

### Learning States

Derive a compact UI state without reading growth analytics synchronously:

- `undiscovered`: no successful Codex turn;
- `tried`: exactly one successful turn;
- `repeat`: two or more successful turns;
- `dismissed`: user disabled contextual guidance;
- `unavailable`: no usable source or policy denial.

Successful-turn counts and active-day summaries come from authoritative ACP
per-account metering or an account-home projection, not the eventually
consistent growth dashboard. The growth pipeline measures outcomes but does
not control product eligibility.

Prominence policy:

- `undiscovered`: at most one coach card per browser session and three coach
  cards during the first-week window;
- `tried`: no generic coach card; show at most two task-specific callouts in
  unused surfaces;
- `repeat`: ambient actions and direct error actions only;
- `dismissed`: ambient actions only;
- after any successful turn, suppress additional promotion for the rest of the
  session;
- an X dismisses the current surface suggestion; a menu action **Don't suggest
  Codex** globally disables coach cards and context callouts without disabling
  Codex itself.

## Funding and Trust Disclosure

Create one reusable `ContextualCodexFundingNotice` based on
`useCodexPaymentSource`. Use the same component in onboarding, Jupyter Agent
dialogs, Help me fix, terminal/editor assistants, LaTeX Agent actions, template
adaptation, and the agent flyout.

Authoritative text matrix:

| Effective source        | Primary text                                                                     | Additional detail                                                              |
| ----------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| CoCalc Membership       | **Included with your CoCalc membership. No per-prompt CoCalc charges.**          | Show the compact membership usage meter and that allowances reset/are limited. |
| ChatGPT Plan            | **Uses your connected ChatGPT plan. CoCalc will not charge per prompt.**         | Show the connected account and ChatGPT Codex usage meter when available.       |
| Account OpenAI API key  | **Uses your personal OpenAI API key. CoCalc adds no per-prompt charge.**         | State that OpenAI API charges may apply to the key owner.                      |
| Project OpenAI API key  | **Uses this project's OpenAI API key. CoCalc adds no per-prompt charge.**        | State that OpenAI API charges may apply to the key owner.                      |
| Shared/local credential | **Uses this site's configured Codex access. CoCalc will not charge per prompt.** | Use Lite/Launchpad-specific source language.                                   |
| None/exhausted          | **Codex is not currently available from this account.**                          | Link to credentials, membership, or quota help; do not submit.                 |

Do not use “free” as the main label, since allowance and external-source limits
exist. Do not say “included” for a turn that will actually use a connected
ChatGPT plan or API key under automatic preference. Do not display a stale
model default: use the effective site-funded policy exactly as
`applyEffectiveCodexPolicyToAgentSession` currently does for recent sessions.

For legacy users, the one-time note should be direct:

> CoCalc no longer creates a small pay-as-you-go purchase for each Codex
> request. This request uses the source shown below.

The note is acknowledged once and remains available through a “How Codex usage
works” link.

## Surface-by-Surface Implementation

### 1. Empty First Project or File List

Trigger: a writable, user-created project has no meaningful HOME files after
the project surface is visible.

Offer:

> **Create your first useful result with Codex**
>
> Describe what you want to make. Codex can create files, run code, and check
> the result in this project.

Provide a composer and format-aware examples. If onboarding already has a
declared Jupyter, terminal, LaTeX, Sage, or template intent, seed matching
examples and hidden instructions. Do not automatically inspect browser tabs or
search an intentionally empty workspace.

If the user reached an empty project through a course invitation, show course
instructions instead and do not assume they should create independent work.

### 2. Blank Jupyter Notebook

Trigger: first writable notebook, no substantive cells, no successful
execution.

Make the existing **Generate...** insertion action persistently visible for the
first interaction rather than hover-only. Add a compact coach line:

> Tell Codex what you want to calculate, visualize, or learn. It can add and
> run the first cells.

Suggested requests depend on kernel language. Python examples must not appear
in an R, Julia, or Sage kernel. Use the existing insertion location and live
notebook APIs; do not read or rewrite `.ipynb` JSON.

### 3. Jupyter Cell Selection

Trigger: one or more selected cells.

Promote existing agent-cell actions with three concise choices:

- Explain these cells;
- Improve or simplify them;
- Add a test or visualization.

The expanded prompt states selected cell IDs and lets Codex retrieve live
content. The frontend must not put large cell bodies into analytics or an
unbounded prompt payload.

### 4. Jupyter Error or Missing Kernel

Keep **Fix with Agent**, **Hint**, and Agent kernel installation. Add the shared
funding notice and a short preview of the context being supplied. The existing
notebook error builder already bounds traceback and cell input and instructs
Codex to use live notebook APIs; preserve that behavior.

When a course permits hints but not solutions, expose **Give me a hint** only.
Do not route a solution intent through site-funded Codex as a policy fallback.

### 5. Blank LaTeX Document

Trigger: a newly created or template-empty `.tex` document with no meaningful
body.

Offer:

- Draft an article structure;
- Create a Beamer presentation;
- Add a bibliography and example citation.

The prompt must say this is LaTeX, use live document state, compile the result,
and fix errors. Never default to Jupyter for a LaTeX request.

### 6. LaTeX Compile Error and Formula Selection

Connect compile-log errors to the generic Help me fix machinery with a
LaTeX-specific hidden prompt and funding notice. Preserve current formula Agent
editing, but use a short visible prompt instead of exposing the entire hidden
instruction as the chat message. The confirmation should name the selected
file/formula and whether Codex will edit or only explain.

### 7. New Terminal

The terminal tour already explains Ask Codex, but tours are easy to skip. For a
first-week user opening an empty terminal, show one nonmodal line above or near
the prompt:

> Ask Codex in everyday language to run or explain a Linux task.

Examples: “find the largest files,” “make a Python virtual environment,” or
“explain this command.” The user opens a composer before submission.

Pass the exact live terminal session ID through the existing terminal assistant
path. A `.term` filename is not enough. Codex may write commands only after the
user submits the request, and destructive/escalated actions still follow normal
agent safety rules.

### 8. Terminal Output or Failed Command

Do not attempt broad automatic shell-error classification in phase 1. Provide
an explicit selection/recent-output action:

- Explain this output;
- Diagnose the last command;
- Suggest a safer command.

Use terminal history/state APIs and bounded ranges. Never ship an entire
long-running terminal transcript in a prompt or analytics event.

### 9. Code and Text Editors

When a writable file is empty, promote **Create a first draft with Codex**.
When text is selected, promote Explain, Refactor/Edit, and Add tests where the
language supports them. Linter/build errors should use the existing Help me fix
path.

All actions go through `frame-editors/ai/create-chat.ts`, which already handles
live state and terminal specialization. Add surface-specific prompt builders
instead of concatenating arbitrary UI labels into a generic prompt.

### 10. Project Explorer and Search

Use the existing navigator intents for bounded actions:

- empty project: create a useful starter;
- no search results: ask Codex to find content by meaning or inspect project
  structure;
- selected file: explain, test, or adapt it;
- multiple selected files: summarize their relationship.

Do not hide normal file creation or search behind Codex. The AI action is an
adjacent accelerator.

### 11. Software and Environment Setup

Existing RootFS capability and formatter rows can route installation to Agent.
Add funding disclosure and explain that installation changes the project. Prefer
tested curated recipes from the managed app catalog when available; Codex
should not rediscover package installation from scratch every time.

### 12. Executable Templates

After an executable template entry is visible, show two or three
release-authored adaptation actions, for example:

- Use my CSV instead of the example data;
- Explain the model and results;
- Extend this benchmark with another algorithm.

These are a strong acquisition-to-activation bridge. The hidden prompt includes
template ID, release ID, entry path, validation command, and desired mutation,
but no account acquisition metadata. The user sees and submits the natural
language request.

### 13. Project Continuation

The existing one-time project-continuation notification/email remains factual:
it says a first project is waiting and links back to it. After the project
opens, a contextual Codex offer may help continue the actual artifact. Do not
put feature promotion in the status email, and do not send additional Codex
email without marketing consent.

## Shared Frontend Architecture

Add a focused module, tentatively:

```text
src/packages/frontend/contextual-codex/
  eligibility.ts
  state.ts
  funding-notice.tsx
  offer.tsx
  composer.tsx
  submit.ts
  events.ts
  prompt-contract.ts
  prompts/
    empty-project.ts
    jupyter.ts
    latex.ts
    terminal.ts
    editor.ts
    template.ts
```

### Intent Contract

```ts
interface ContextualCodexIntent {
  version: number;
  surface: ContextualCodexSurface;
  action: ContextualCodexAction;
  project_id: string;
  path?: string;
  context_class: string;
  mutation_mode: "read-only" | "workspace-write" | "terminal-command";
  visible_prompt: string;
  hidden_prompt: string;
  title: string;
  tag: string;
  create_new_thread?: boolean;
}
```

Prompt builders return this contract. UI components do not independently
construct hidden prompts. Each builder is versioned and unit tested with vague,
empty, malformed, and domain-specific user input.

### Offer Component

`ContextualCodexOffer` owns:

- eligibility and frequency checks;
- semantic heading/text/action markup;
- funding notice and loading state;
- suggested-request chips;
- composer/confirmation dialog;
- hidden-prompt inspection;
- immediate queued state;
- dismissal and global opt-out;
- analytics lifecycle;
- error and retry UI.

Surfaces supply the task state and prompt builder. They do not duplicate
payment-source polling, Agent session selectors, disclosure copy, or event
names.

### Durable Preference State

Use an account-home `other_settings` object such as
`contextual_codex_coach_v1` for user-controlled durable state:

```ts
{
  version: 1,
  globally_dismissed_at?: string,
  legacy_notice_acknowledged_at?: string,
  dismissed_surfaces?: Record<string, string>,
}
```

Do not write every impression into account settings. Session-level caps can use
session storage; canonical exposures and outcomes use growth events. State
writes must use the convergent account settings action and must never block an
Agent request when preference persistence fails.

## Prompt Design

Every contextual hidden prompt must:

1. name the user's visible request exactly;
2. identify project, path, surface, and live object IDs needed to locate state;
3. state that live in-memory state is authoritative;
4. specify whether edits or commands are allowed;
5. explain the expected useful deliverable or resolution;
6. require focused validation and a concise summary;
7. avoid investigating unrelated browser/account/project metadata;
8. avoid asking for clarification when safe reasonable defaults can create a
   useful first result;
9. avoid format bias: LaTeX remains LaTeX, terminal tasks remain terminal-first,
   and notebook language follows the kernel;
10. remain bounded by referencing live state rather than embedding huge files,
    outputs, or tracebacks.

The user-visible prompt remains short. The dialog offers **Show instructions
sent to Codex** for transparency. This follows the established `visiblePrompt`
plus `acp_prompt` model used by Agent dialogs.

Prompt injection from project content is not solved by hiding instructions.
The agent already has the user's project privileges. The prompt should tell it
to treat file content as project data, not higher-priority policy, and normal
safety/approval boundaries remain in force.

## Fast and Reliable Handoff

Contextual discovery will fail if submitting a request leaves a blank project
for several seconds. The visible sequence should be:

1. User clicks Send.
2. Within one animation frame, the offer enters “Opening Agent” and the Agent
   flyout opens with the visible request in a queued state.
3. Submission proceeds through the existing pending chat outbox.
4. The UI reports admission, start, first response, completion, or a specific
   recoverable error.

Implementation work:

- prefetch the small Agent flyout/composer chunks after the primary project
  surface is visible and the browser is idle;
- warm the cached payment-source lookup after project entry, never before the
  primary surface;
- use `waitForAgent: false` and preserve immediate local queued messages;
- add an idempotency/correlation ID from offer click through ACP turn;
- if a selected session has an active writer, route visibly to the active turn,
  queue the request, or offer a new thread; do not repeatedly resume and fail;
- default a context action to a new thread when the recent session belongs to a
  different path/task, while allowing explicit session selection;
- preserve queued intents across reload and browser disconnect;
- classify payload-size failures before provider submission and replace large
  embedded context with live identifiers;
- make provider/accounting errors distinguishable from project-host and UI
  errors;
- never retry a mutation turn invisibly if duplicate execution is possible.

Aggressive coach-card rollout is blocked until active-writer/resume conflicts
are below 1% of submitted contextual turns and oversized payload failures are
below 0.5%.

## Authority and Multibay Design

- Durable user preferences follow the account's `home_bay_id`.
- Payment source and site-funded admission are resolved through the existing
  account/control-plane APIs, not a local hub database assumption.
- Course and project policy are resolved from the project owning bay.
- Live files, notebooks, terminals, Codex sessions, and steady-state Agent
  traffic remain direct browser-to-project-host data-plane operations.
- Project-host ACP outcome facts are delivered durably to account-home growth
  facts and aggregate-only global projections.
- No hub proxies notebook content, terminal history, or agent output merely to
  support contextual UI.
- Launchpad uses the same contract with one bay and local/shared credential
  source labels.

## Analytics and Causal Discipline

### Semantic Events

Extend the growth event allowlist with bounded events such as:

- `contextual_codex_offer_seen`
- `contextual_codex_offer_opened`
- `contextual_codex_request_staged`
- existing `ai_prompt_submitted`
- `codex_turn_admitted`
- `codex_first_response`
- `codex_turn_completed`
- `codex_turn_failed`
- `contextual_codex_offer_dismissed`

ACP admission/completion/failure comes from authoritative server/project-host
metering, not optimistic browser events. Browser events cover exposure,
opening, and local staging. A correlation ID links the short-lived raw funnel
without putting prompt/session content in analytics.

Allowlisted properties:

- surface and action class;
- prompt-builder version;
- account lifecycle class (`undiscovered`, `tried`, `repeat`);
- funding class, never credentials;
- course policy class;
- onboarding/template intent class;
- outcome/failure class;
- model policy class;
- source confidence.

Do not record visible prompts, hidden prompts, filenames, selected text,
tracebacks, terminal output, generated content, ChatGPT email, API-key metadata,
or exact allowance balances in growth events.

### Outcome Funnel

For each surface and release cohort report:

```text
eligible surface
  -> offer seen
  -> offer opened
  -> request staged
  -> prompt submitted
  -> turn admitted
  -> first response
  -> successful completion
  -> second independent successful turn
  -> subsequent self-directed work
  -> D1/D7 project engagement
```

Join cost from committed ACP turn accounting at aggregate level. Report cost
per successful first turn, per second-turn user, per self-directed activation,
and per D1 retained user. Do not call the full provider request count “turns.”

### Evaluation Strategy

These are standard missing onboarding affordances, so do not delay the initial
release for an underpowered A/B test. Use explicit release cohorts and compare:

- pre/post eligible users by acquisition channel and onboarding path;
- exposed versus unexposed eligible surfaces caused by natural product state;
- reliability and latency before and after each ramp;
- D1/D7 only after cohorts mature;
- site-funded cost per retained outcome.

Do not claim causation from a raw pre/post increase if acquisition mix, course
traffic, performance, or abuse changed. Controlled experiments remain useful
later for uncertain wording, frequency, and suggested prompts once denominators
support them. Never withhold direct error repair or truthful funding disclosure
as an experiment.

## Course and Academic Policy

Use the existing account/project checks:

- `disableAI`: render no Agent offer;
- `disableSomeAI`: expose hints/explanations but not full solutions or broad
  workspace mutation;
- read-only/viewer project: explanation only;
- instructor-owned content: do not make student mutations outside permitted
  areas.

The action class is part of the typed prompt contract so policy enforcement is
server-authoritative as well as visible. A client label change must not turn a
hint-only action into a solution request.

For course projects, wording should support learning:

- “Explain this error”;
- “Give me the next debugging step”;
- “Check my reasoning without completing the solution.”

Avoid generic first-week “build this for me” coach cards in student assignment
contexts.

## Accessibility and Interaction Requirements

- Use semantic buttons, form labels, headings, and status/live regions.
- Funding source and remaining usage cannot be color-only.
- Suggested prompts are buttons with complete accessible names, not clickable
  cards or placeholders.
- Opening and closing a composer/modal moves and restores focus predictably.
- Queued/admitted/completed states are announced without repeatedly reading
  streaming Agent output.
- All controls work with keyboard only at 200% zoom and 320 CSS px.
- Respect reduced motion through the existing animation helpers.
- Dismissal has an accessible label and does not accidentally mean “disable
  Codex.”
- Add role/name-focused tests for every new interactive surface and run
  `pnpm -C src lint:frontend` during implementation.

## Cost and Capacity Guardrails

Contextual offers are user-initiated, so there is no provider cost for an
impression. Site-funded admission continues to enforce per-tier allowance,
global pool limits, reservations, and committed-cost accounting.

Add dashboards and alerts for:

- contextual site-funded attempts, admissions, completions, and cost;
- cost per successful first/second turn and retained outcome;
- allowance denials by membership tier;
- global pool headroom;
- unexpected model or service-tier drift;
- retries/provider requests per completed turn;
- a surface producing high spend without later meaningful work.

The product response to approaching budget is to reduce coach-card prominence
or adjust explicit allowances, not silently switch a user to a chargeable API
key or revive per-prompt purchases.

## Implementation Phases

### Phase 0: Reliability and Shared Contracts

1. Fix or provide deterministic recovery for active-writer/resume conflicts.
2. Add preflight size estimation and live-context references for oversized
   prompts.
3. Add correlation/idempotency IDs through navigator intent, pending outbox,
   ACP admission, and committed outcome.
4. Define the typed contextual intent and prompt-builder contracts.
5. Implement `ContextualCodexFundingNotice` and lifecycle eligibility.
6. Add effective-model tests so dialogs never display stale development
   defaults instead of the site-funded policy.

Exit criterion: existing Agent dialogs can use the shared funding component,
prompt submission gives immediate visible feedback, and reliability gates pass
on staging.

### Phase 1: Upgrade Existing High-Intent Actions

1. Add funding disclosure and consistent session routing to Jupyter Fix,
   Generate, kernel installation, generic Help me fix/Hint, terminal/editor
   assistant, and LaTeX formula actions.
2. Replace full hidden prompts used as visible messages with concise visible
   prompts where needed.
3. Add hidden-prompt inspection and task-specific mutation wording.
4. Instrument the full offer-to-completion funnel.
5. Preserve all course restrictions and existing non-Codex AI fallbacks.

Exit criterion: every existing contextual Agent dialog answers “what will it
do?”, “what context will it use?”, and “who pays?” consistently.

### Phase 2: First-Week Empty and Blocked States

1. Add the empty-project composer.
2. Make blank-notebook Agent generation discoverable without hover.
3. Add blank LaTeX and empty code-file offers.
4. Add new-terminal and selected-output actions.
5. Add lifecycle caps, per-surface dismissal, and global opt-out.
6. Add the legacy per-prompt-charge trust notice.

Exit criterion: a new eligible user encounters one useful, nonblocking Codex
offer in each primary workflow but never multiple competing coach cards.

### Phase 3: Explorer, Selection, and Environment Context

1. Add project-explorer empty/search/selection intents.
2. Unify editor selection and linter/build-error actions.
3. Connect managed app and environment setup to curated recipes.
4. Improve active-thread versus new-thread choice using task/path affinity.
5. Add in-product “How Codex usage works” documentation and settings.

Exit criterion: contextual actions across all surfaces use the same contract,
funding, submission, and event systems.

### Phase 4: Executable Template Integration

1. Accept release-authored adaptation prompts in the template manifest.
2. Show them only after template entry-visible.
3. Carry template/release classification into content-free analytics.
4. Measure adaptation completion, subsequent edits/executions, D1/D7, and
   site-funded cost.

Exit criterion: a Google-acquired template user can run a useful example and
adapt it to a personal goal without needing to discover the general Agent UI.

### Phase 5: Tune From Mature Outcomes

1. Review surface funnels weekly.
2. Remove low-use callouts that do not improve meaningful work.
3. Improve prompt builders with high failure or clarification rates.
4. Adjust frequency using mature retention and cost, not clicks.
5. Use controlled tests only for genuinely uncertain choices with adequate
   power.

## Validation Plan

### Unit Tests

- eligibility across source, allowance, account age, lifecycle, course policy,
  read-only, and dismissal states;
- exact funding text for every effective source;
- site-funded effective model/reasoning display;
- prompt builders for blank, vague, domain-specific, and oversized input;
- LaTeX/terminal/notebook format routing;
- first-week active-day/calendar cap;
- per-session and per-surface frequency limits;
- visible versus hidden prompt preservation;
- event payload allowlist and content rejection.

### Integration Tests

- submit through each source type and reconcile committed accounting;
- source changes while a dialog is open;
- quota exhausted after impression but before submission;
- active writer, interrupted turn, browser refresh, worker restart, and pending
  outbox recovery;
- same-path resume versus unrelated-path new thread;
- large notebook/traceback/terminal output stays below payload limits;
- course hint-only and disable-AI policy enforcement on client and server;
- account-home preference behavior after rehome;
- cross-bay project Agent routing with no local DB assumption.

### Browser Scenarios

Exercise new, legacy, invited-course, invited-project, template, purchaser-only,
site-funded, ChatGPT-connected, API-key, exhausted, and unavailable accounts.
For each relevant surface:

1. confirm primary content loads before contextual UI;
2. confirm only one prominent offer appears;
3. inspect the funding statement and hidden instructions;
4. submit and see an immediate queued Agent panel;
5. observe correct live context and useful output;
6. refresh during submission and recover;
7. dismiss locally and globally;
8. verify no content in growth events;
9. verify keyboard, zoom, mobile, and reduced-motion behavior.

### Staging Rollout

1. Enable telemetry and shared funding disclosure with coach cards off.
2. Validate existing actions for at least two days.
3. Ramp coach cards to staff/test accounts, then 10%, 50%, and 100% of eligible
   users using a kill-switch flag. The ramp is for operational safety, not a
   retention experiment.
4. Pause automatically if active-writer, payload, admission, or UI-open latency
   gates regress.
5. Keep a release-cohort annotation in `/admin/retention`.
6. Review mature D1 after two days and D7 only after the cohort matures.

## Operational SLOs

- contextual eligibility work adds less than 20 ms main-thread P95 after the
  primary surface is visible;
- payment-source cache lookup does not delay primary content;
- submit-to-visible-queued-state P95 below 250 ms;
- submitted-to-admitted P95 below 3 seconds excluding provider queueing;
- active-writer/resume failures below 1% of contextual submissions;
- payload-too-large failures below 0.5%;
- at least 90% of admitted contextual turns reach a terminal completion state;
- no duplicate mutation turn after refresh/retry;
- growth/telemetry failure never blocks Agent submission or project work.

## Success Criteria

Within 30 days of full rollout, compared with the recorded eligible baseline:

- at least 25% of eligible new users attempt Codex, up from roughly 13%;
- at least 20% complete a successful turn, up from roughly 11%;
- at least 10% complete two independent successful turns, materially above the
  current roughly 4.5% of legitimate new accounts;
- at least 20% of successful first-turn users use Codex on another active day;
- contextual first turns have at least 85% successful completion after
  admission;
- successful contextual users show higher subsequent self-directed work and
  mature D1/D7 project engagement than the pre-rollout baseline after
  acquisition and onboarding mix are reported;
- cost per self-directed activation and D1 retained user stays within the
  explicit site-funded budget;
- no increase in first-project abandonment, surface-load latency, course-policy
  violations, or support reports about surprise AI charges;
- a survey/support sample confirms that users understand Codex is included or
  which external source pays.

The growth claim should be made only after mature retention data exists. The
feature can still be considered operationally successful earlier if discovery,
completion, repeat use, funding comprehension, and reliability improve.

## Recommended Decisions

1. Use contextual, user-initiated offers rather than generic AI promotion.
2. Define the first week as seven active days capped at 14 calendar days.
3. Stop prominent coaching after two successful turns; keep ambient actions.
4. Show the authoritative effective funding source and charge implications in
   every Agent action.
5. Use the existing navigator/agent flyout and hidden-prompt mechanism, not a
   second assistant UI.
6. Fix active-writer and payload reliability before increasing exposure.
7. Add immediate queued feedback and durable outbox recovery.
8. Respect hint-only and disabled-AI course policy on both client and server.
9. Keep Codex promotion in-product; do not add nonconsensual feature email.
10. Judge the work by later self-directed activity, D1/D7 retention, and cost
    per retained outcome, not raw prompts or spend.
