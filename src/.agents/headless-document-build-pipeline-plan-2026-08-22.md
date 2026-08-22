# Headless Document Build Pipeline Plan

Status: proposed implementation plan as of 2026-08-22.

## Objective

Make CoCalc's complete LaTeX, Knitr, R Markdown, and Quarto build pipelines
available through one authoritative project-side implementation.

The same implementation must serve:

- the existing frontend Build and Force Build actions
- build-on-save in open editors
- `cocalc project build <path>`
- agents, CI, and automation with no browser connected
- multiple browsers observing the same build without independently running it

The implementation may be substantial. The hard requirement is that the
complexity lives in a reusable headless build application and a single
project-side coordinator, not in a protocol that asks browsers to execute a
pipeline on behalf of the CLI.

## Architectural Decision

Document builds are project compute/data-plane operations.

- The build pipeline is implemented in a new environment-neutral package,
  `src/packages/apps/document-build`, published as
  `@cocalc/app-document-build`.
- A singleton manager in `@cocalc/project` is the only authority that starts,
  sequences, cancels, and completes builds inside a running project compute
  container.
- The existing direct project API exposes start, status, list-active, and
  cancel operations. Calling it may start project compute, which is correct for
  compilation.
- Project-local ephemeral events provide progress to browsers. The project API
  status snapshot is authoritative and repairs missed or out-of-order events.
- The frontend saves collaborative source state, asks the project service to
  build, and renders returned progress. It does not execute build stages.
- The CLI calls the same project service directly. It never requires or
  discovers a browser.
- The hub/control plane is not involved in steady-state build traffic.

This follows the constraint already documented in
[`conat/project/api/index.ts`](../packages/conat/project/api/index.ts): project
RPC is appropriate for operations that intrinsically require code execution.
It also follows the direct browser/CLI-to-project-host data-plane rule in
[`scalable-architecture.md`](./scalable-architecture.md).

## Non-Goals

- Do not move compilation to a hub, bay, or Next API route.
- Do not use an open browser as a build worker.
- Do not duplicate the pipeline in the CLI.
- Do not make Redux or an editor store the source of truth for build results.
- Do not redesign PDF rendering, SyncTeX navigation, word count, or the editor
  frame layout as part of the initial extraction.
- Do not add a fallback to the old browser-driven pipeline. A document kind is
  exposed through the CLI only after its project-side implementation is ready.
- Do not make build results permanently durable. Project-local bounded
  retention sufficient for reconnect and recent inspection is enough.

## Current Pipeline Inventory

### LaTeX And Knitr

The orchestration currently lives primarily in
[`latex-editor/actions.ts`](../packages/frontend/frame-editors/latex-editor/actions.ts).
The full build behavior includes:

1. Resolve the source kind and distinguish `.tex` from `.Rnw`/`.Rtex`.
2. Resolve a build command from the shared auxiliary syncdb, `% !TeX cocalc`,
   `% !TeX program`, or the default engine.
3. Save the main document and open included files.
4. For Knitr, run R/Knitr to generate the working `.tex` file.
5. Run `latexmk`, including the current output-directory behavior.
6. Parse LaTeX logs into errors, warnings, typesetting issues, dependencies,
   and files.
7. For Knitr, patch SyncTeX concordance information.
8. Detect SageTeX and PythonTeX requirements from the LaTeX output.
9. Disable the temporary output directory when those tools require source-tree
   paths, run the required stage, and rerun LaTeX.
10. Return stage logs and derived PDF/dependency information.

The command builders, subprocess wrappers, and parsers are currently split
across:

- [`latexmk.ts`](../packages/frontend/frame-editors/latex-editor/latexmk.ts)
- [`knitr.ts`](../packages/frontend/frame-editors/latex-editor/knitr.ts)
- [`sagetex.ts`](../packages/frontend/frame-editors/latex-editor/sagetex.ts)
- [`pythontex.ts`](../packages/frontend/frame-editors/latex-editor/pythontex.ts)
- [`latex-log-parser.ts`](../packages/frontend/frame-editors/latex-editor/latex-log-parser.ts)
- [`util.ts`](../packages/frontend/frame-editors/latex-editor/util.ts)

Frontend-only effects are currently interleaved with those steps: Redux
updates, gutter updates, status text, PDF reloads, dependency editor setup,
word count, and error-panel state. Those effects must become consumers of a
typed build snapshot rather than inputs to the pipeline.

### R Markdown

[`rmd-editor/actions.ts`](../packages/frontend/frame-editors/rmd-editor/actions.ts)
currently saves the editor, parses frontmatter in the browser, derives the
`Rscript -e rmarkdown::render(...)` command, executes it, updates Redux, reloads
the preview, and probes for generated files.

The headless implementation must preserve:

- the current `self_contained`/explicit-output heuristic
- `MPLBACKEND=Agg`
- the four-minute stage timeout unless intentionally changed
- generated `.pdf`, `.html`, and `.nb.html` discovery
- line extraction from current Knitr/R Markdown errors

### Quarto

[`qmd-editor/actions.ts`](../packages/frontend/frame-editors/qmd-editor/actions.ts)
has the same coupling. Its headless implementation must preserve
`quarto render <file> --log-level info`, generated artifact discovery, and
current error-line parsing.

### Behavior That Stays Frontend-Specific

- Saving live collaborative editor state before a user-initiated build
- deciding whether build-on-save is enabled for an account
- choosing a parent/master document after an included file changes
- rendering logs, errors, warnings, gutters, and resource usage
- reloading PDF, HTML, and Markdown previews
- word count
- forward and inverse SyncTeX navigation

The frontend may provide the selected logical/master path to the service, but
it must not provide an imperative pipeline or a Redux-derived result.

## PR 278 And PR 280

PR 278 and PR 280 should not be merged as the implementation of this feature.
They are still useful design input and contain tests that can be adapted.

### Retain From PR 278

- The user-facing goal and basic `cocalc project build <path>` command shape.
- A typed overall result rather than treating one subprocess exit code as the
  complete pipeline result.
- The requirement to save live editor state before frontend-triggered builds.
- Multi-client visibility: a build started by one client updates every client.
- Explicit job/build identifiers, cancellation, logs, and bounded summaries.
- Agent guidance that invokes a named CLI command after modifying a buildable
  document.

### Replace From PR 278

- The `true` command used as a build trigger.
- Browser watchers that interpret an exec job as a request to rebuild.
- `BuildRequestQueue` instances in every open editor.
- browser-to-CLI result subjects.
- Redux inspection as the source of a result.
- background editor opening/hydration solely to make a build possible.
- first-browser-response-wins behavior.

### Retain From PR 280

PR 280 identifies a genuine model requirement: a pipeline stage needs both the
logical document requested by the user and the concrete file that the stage
operates on.

For example:

| Request           | Logical path | Working path | Exclusive resource key |
| ----------------- | ------------ | ------------ | ---------------------- |
| Build `paper.Rnw` | `paper.Rnw`  | `paper.tex`  | `paper.tex`            |
| Build `paper.tex` | `paper.tex`  | `paper.tex`  | `paper.tex`            |

Every stage and result must retain the logical path. The manager must lock on
the exclusive resource key. Thus the two requests remain distinguishable, but
they cannot run simultaneously over the same generated files.

This is stronger than PR 280's implementation. A late browser never joins the
pipeline at `latex` and conditionally skips Knitr. It attaches to the existing
build snapshot and renders whichever stages have already happened. There is
only one process running the pipeline.

### Tests Worth Adapting

- logical path versus generated path classification
- late client/reconnect during a long LaTeX stage
- two clients seeing one execution and the same build ID
- a client joining after Knitr without rerunning Knitr
- saving the requested document before frontend build submission
- overall result summaries for successful and failing stages

The tests should target project-side identity, locking, snapshots, and
frontend projection. They should not preserve browser orchestration classes.

## Package Design

Create `src/packages/apps/document-build` following the headless package model
used by `apps/notebook` and `apps/tasks`.

Suggested layout:

```text
src/packages/apps/document-build/
  package.json
  tsconfig.json
  src/
    index.ts
    contracts.ts
    registry.ts
    pipeline.ts
    config.ts
    runtime.ts
    latex/
      commands.ts
      config.ts
      log-parser.ts
      pipeline.ts
      knitr.ts
      sagetex.ts
      pythontex.ts
    rmarkdown/
      command.ts
      diagnostics.ts
      pipeline.ts
    quarto/
      command.ts
      diagnostics.ts
      pipeline.ts
  test/
    ...
```

The package must not import `@cocalc/frontend`, React, Redux, browser globals,
or the project API client.

### Runtime Interface

The app owns orchestration while the environment supplies effects through a
small interface. A representative contract is:

```ts
export interface DocumentBuildRuntime {
  readText(path: string): Promise<string>;
  readBuildConfig(path: string): Promise<SavedBuildConfig | undefined>;
  exists(path: string): Promise<boolean>;
  hash(path: string): Promise<string>;
  execute(
    stage: BuildStageSpec,
    onEvent: (event: BuildStageEvent) => void,
  ): Promise<BuildStageResult>;
  copy(source: string, destination: string): Promise<void>;
}
```

The real adapter belongs in `@cocalc/project` and uses project-visible paths,
`@cocalc/backend/execute-code`, and the project filesystem. Unit tests use a
fake runtime that records stage order and supplies fixture output.

Do not expose raw Redux callbacks such as `set_job_info` through this
interface. Stage events are plain immutable values associated with one build
and one stage instance.

### Registry

The app package owns the only buildable-document registry:

```ts
type DocumentKind = "latex" | "knitr" | "r-markdown" | "quarto";

interface DocumentBuildDefinition {
  kind: DocumentKind;
  extensions: readonly string[];
  resolveIdentity(path: string): BuildDocumentIdentity;
  resolveConfig(...): Promise<ResolvedBuildConfig>;
  run(...): Promise<DocumentBuildResult>;
}
```

The CLI, project API, and frontend must query this registry or project API
capabilities. There must not be a second hardcoded extension list that says
"keep in sync" with editor registrations.

### Identity

Every build receives a stable identity before it enters the manager:

```ts
interface BuildDocumentIdentity {
  kind: DocumentKind;
  logical_path: string;
  working_path: string;
  resource_key: string;
}
```

- `logical_path` is the path requested by the caller.
- `working_path` is the main file operated on by the compiler.
- `resource_key` identifies files that cannot safely be modified by concurrent
  pipelines.
- Paths are normalized once at the project boundary using project runtime path
  helpers. App-level contracts use project-visible paths.

### Build And Stage Results

Use plain JSON-compatible values. A representative snapshot is:

```ts
interface DocumentBuildSnapshot {
  build_id: string;
  request_id?: string;
  identity: BuildDocumentIdentity;
  state: "queued" | "running" | "succeeded" | "failed" | "canceled";
  seq: number;
  submitted_at: number;
  started_at?: number;
  ended_at?: number;
  force: boolean;
  stages: BuildStageSnapshot[];
  diagnostics: BuildDiagnostic[];
  dependencies: string[];
  artifacts: BuildArtifact[];
  exit_code?: number;
  error?: string;
}
```

Each stage snapshot includes a unique stage instance ID, stage name, command,
working directory, underlying exec job ID, state, timing, exit code, bounded
stdout/stderr, and resource statistics. Stage names alone are insufficient
because LaTeX can run more than once.

The app returns the final snapshot/result directly. The manager must never
reconstruct it afterward from mutable frontend state.

### Success Semantics

- `succeeded` and exit code `0` require the whole pipeline to finish without a
  failed required stage or parsed error diagnostic.
- `failed` uses the first meaningful failed-stage exit code, or `1` for an
  orchestration/parser failure without a subprocess code.
- `canceled` is distinct from `failed` and maps to a nonzero CLI exit status.
- A generated PDF does not by itself make a build successful when LaTeX
  reported errors.
- Transport failures are represented separately from compiler diagnostics.
- Successful CLI output may truncate logs aggressively; failure output keeps
  the useful beginning and end. The retained project snapshot remains the
  source for richer frontend display.

## Configuration And Source Consistency

### Saved Source Is The Build Input

The project-side pipeline builds filesystem state. It does not depend on an
open sync document.

- The CLI builds the files already saved in the project.
- Before a frontend build, the editor awaits `save_all(false)` for LaTeX or the
  corresponding source save for R Markdown/Quarto.
- A frontend request may include an expected saved revision. The project
  service verifies it after save and rejects a stale submission rather than
  silently building older content.
- Included-file build-on-save continues selecting the master path in the
  frontend for the first migration. Automatic headless `% !TeX root`
  discovery can be added later.

### Shared LaTeX Build Configuration

The existing build command is shared in the auxiliary
`.filename.ext.syncdb` document and explicitly saved to disk. The project-side
configuration repository must read that saved JSONL representation without
opening a frame editor.

Preserve this precedence:

1. `% !TeX cocalc = ...`
2. explicitly persisted `build_command`
3. recognized `% !TeX program = ...`
4. the default PDFLaTeX command

Move directive parsing, engine selection, command generation, target filename
repair, `-deps` handling, and output-directory sanitization into the app
package. The frontend build-command UI calls the same pure helpers and awaits
configuration persistence before starting a build.

Malformed explicit configuration should produce a clear configuration error.
It must not silently compile with a different default command.

The SageTeX/PythonTeX output-directory fallback becomes pipeline-local
effective configuration. The pipeline must not mutate shared build
configuration merely because a package was detected while compiling.

### R Markdown And Quarto Configuration

Move browser-independent frontmatter extraction and command generation into
the app. Both services read the saved source file. Frontend preview rendering
of Markdown remains in the frontend and is not part of compilation.

## Project-Side Build Manager

Add a singleton manager under `src/packages/project/document-build`.

Suggested files:

```text
src/packages/project/document-build/
  index.ts
  manager.ts
  runtime.ts
  retention.ts
  events.ts
```

### Responsibilities

- validate and normalize requests
- resolve a document definition and identity
- assign the build ID
- enforce per-resource exclusivity
- enforce a small project-wide active-build limit
- run the app pipeline exactly once
- maintain authoritative snapshots and monotonically increasing sequence
  numbers
- publish progress snapshots/events
- cancel the current underlying exec stage when requested
- retain bounded completed snapshots for reconnect/status inspection
- expose active builds by logical path and resource key

### Concurrency And Idempotency

- Only one pipeline may run for a `resource_key`.
- `paper.Rnw` and `paper.tex` therefore serialize even though their logical
  paths differ.
- Different independent documents may build concurrently up to a configurable
  project limit.
- An optional opaque `generation` makes retries idempotent. The frontend uses a
  stable saved-document revision for build-on-save so multiple clients seeing
  the same save receive the same build ID.
- A request without `generation` is a new explicit build.
- `force: true` bypasses successful-result reuse and stage aggregation. It does
  not implicitly cancel another caller's running build.
- Replacing a running build requires an explicit cancel/replace operation.
- Queued builds are bounded. Admission failure returns a typed error instead
  of allowing an unbounded per-project queue.

Existing keyed async exec jobs can still run individual subprocesses and
provide process IDs, output, stats, and cancellation. They are an execution
primitive, not the distributed pipeline coordinator. Pipeline correctness must
not depend on the short completed-key cache in
[`backend/execute-code.ts`](../packages/backend/execute-code.ts).

### Retention

Use a bounded in-memory LRU initially, configurable by count and TTL. A
reasonable starting point is 100 completed builds for one hour, with per-stage
log caps. The underlying generated files remain on disk.

A project daemon restart may mark previously running builds lost. Browser or
CLI callers can start a new build. Durable build history is a separate feature.

## Direct Project API

Add a `documentBuild` group to the existing project API.

Suggested contract file:

- `src/packages/conat/project/api/document-build.ts`

Suggested implementation file:

- `src/packages/project/conat/api/document-build.ts`

Initial methods:

```ts
interface DocumentBuildApi {
  capabilities(): Promise<DocumentBuildCapabilities>;
  start(request: DocumentBuildRequest): Promise<DocumentBuildSnapshot>;
  get(build_id: string): Promise<DocumentBuildSnapshot>;
  getActive(query: { path?: string }): Promise<DocumentBuildSnapshot[]>;
  cancel(build_id: string): Promise<DocumentBuildSnapshot>;
}
```

`start` returns quickly with a queued/running snapshot. Callers do not hold one
request/reply RPC open for an entire compilation.

### Progress Events

Define a project-local document-build event subject in
`@cocalc/conat/project/document-build`.

- Only the project daemon publishes authoritative events.
- Events include `build_id`, logical path, resource key, sequence number, and a
  snapshot or typed delta.
- A browser may subscribe before or after `start`.
- On initial attach, reconnect, or sequence gap, it calls `get` or `getActive`
  and replaces its projection with the authoritative snapshot.
- Missing an ephemeral event can delay rendering but cannot change the build
  result or cause another build to run.
- CLI correctness uses `get` polling and does not rely exclusively on event
  delivery. Event streaming can improve interactive log output later.

This retains the useful multi-client behavior from the existing exec-job
watchers without assigning execution authority to every subscriber.

## Frontend Migration

Create a small frontend document-build client/projection adapter shared by the
three editor families.

### Starting A Build

1. Save the relevant collaborative documents and build configuration.
2. Call `projectApi.documentBuild.start` with the logical path, force flag, and
   optional saved generation.
3. Store the returned build ID as the editor's active build.
4. Subscribe to project-side progress for rendering.

### Opening Or Reconnecting

1. Subscribe to progress for the logical path/resource.
2. Call `getActive({ path })`.
3. Render any current build immediately from its snapshot.
4. Never rerun or skip a pipeline stage merely because the browser joined
   late.

### Rendering Compatibility

Use a temporary pure adapter that projects `DocumentBuildSnapshot` into the
existing Redux fields such as `build_logs`, `building`, `job_info`,
`build_exit`, `build_log`, and `build_err`. This limits the first UI diff.

After all editors use the service, components should consume typed snapshots
directly and remove Immutable-specific build-result reconstruction.

### Completion Effects

- Reload PDF/HTML/Markdown previews from the completion snapshot and artifact
  list.
- Update dependency navigation and gutters from typed diagnostics and
  dependencies.
- Keep filesystem watchers as a fallback for external commands that modify a
  PDF, not as the build coordinator.
- A build continues if every browser closes.
- Every browser displaying the document receives the same build ID and result.

### Cancellation

The Stop button cancels the project-side build ID. It does not walk Redux logs
and independently signal every process a browser happens to know about.

## CLI Design

The first user-facing command remains:

```bash
cocalc project build <path> [--project <project>] [--force] [--detach]
```

Behavior:

- Waiting is the default because agents invoke this command to verify edits.
- `--detach` returns after submission with the build ID.
- The CLI resolves the routed direct project API and calls
  `documentBuild.start`.
- Waiting polls `documentBuild.get`; it may also consume progress events for
  nicer logs.
- Compiler failure, cancellation, unsupported type, stale-source rejection,
  and wait timeout all produce a nonzero process exit status.
- A wait timeout does not silently cancel a still-running build; output includes
  its build ID and state.
- Structured output includes the build ID, identity, stages, exit code,
  diagnostics summary, artifacts, and bounded logs.
- The command works when no browser session exists and must have an end-to-end
  test proving that property.

Status and cancel CLI subcommands may be added after the primary command, but
the underlying API supports them from the start for the frontend.

Agent prompts should change only after this command is available in the tools
bundle used by projects. Guidance should state that the command builds saved
project files and returns a nonzero status when verification fails.

## Implementation Sequence

### Phase 0: Characterize Existing Behavior

Before moving code, add focused fixture tests for:

- LaTeX configuration precedence and sanitization
- default engines and custom shell commands
- output-directory copying
- LaTeX parser diagnostics and dependencies
- plain `.tex` stage order
- Knitr stage order and SyncTeX patching
- SageTeX-only, PythonTeX-only, and combined documents
- R Markdown command/frontmatter behavior
- Quarto command behavior
- artifact discovery
- compiler, transport, timeout, and cancellation failures

Acceptance:

- Fixtures describe the current intended behavior without requiring Redux or
  React rendering assertions.
- Known accidental behavior is marked explicitly rather than silently encoded
  as a permanent contract.

### Phase 1: Create `@cocalc/app-document-build`

- Add contracts, registry, runtime interface, and fake runtime.
- Move command generation, configuration parsing, and log/error parsers into
  the app package.
- Keep temporary re-exports from old frontend paths to avoid one enormous
  frontend change.
- Convert parser outputs to plain typed objects at the package boundary.

Acceptance:

- The app package has no frontend dependency.
- Pure command/config/parser tests pass in the app package.
- Existing frontend tests continue passing through temporary adapters.

### Phase 2: Add The Project Build Manager And API

- Implement the project runtime adapter over `executeCode` and filesystem
  operations.
- Implement identity resolution, resource locking, sequencing, cancellation,
  retention, and admission limits.
- Add the `documentBuild` project API group.
- Add project-local progress events and snapshot reconciliation.
- Test with a synthetic multi-stage pipeline before migrating production
  editors.

Acceptance:

- A build continues and completes after its initiating client disconnects.
- Two callers with the same idempotency generation receive one build ID.
- Two builds sharing a resource key never overlap.
- Different resource keys can run concurrently within the configured limit.
- Late subscribers reconstruct exact current state from `get`.
- Cancellation stops the active subprocess and produces one terminal snapshot.

### Phase 3: Migrate R Markdown And Quarto

- Move each converter pipeline into the app.
- Switch frontend Build, Force Build, Stop, and build-on-save to the project
  service.
- Project typed snapshots into the existing build panels.
- Return generated artifact paths from the pipeline.

Acceptance:

- R Markdown and Quarto build with no browser through direct project API tests.
- Browser builds preserve current commands, previews, logs, and error lines.
- Two browsers show one shared build.

### Phase 4: Migrate Plain LaTeX

- Move LaTeX command resolution and execution into the app pipeline.
- Move log parsing and dependency extraction.
- Preserve custom commands, engine directives, output-directory handling,
  PDF copying, and resource stats.
- Switch the plain `.tex` frontend to the service.

Acceptance:

- Default and custom builds match the Phase 0 fixtures.
- Frontend gutters, dependencies, logs, and PDF reloads are driven from the
  returned snapshot.
- No browser executes `latexmk` directly.

### Phase 5: Migrate Knitr, SageTeX, And PythonTeX

- Add logical/working/resource identity to every stage.
- Move Knitr generation and error parsing.
- Move SyncTeX concordance patching.
- Move SageTeX hashing/execution and PythonTeX execution.
- Preserve required LaTeX reruns and combined SageTeX/PythonTeX behavior.
- Add the PR 280 late-join and generated-file concurrency cases.

Acceptance:

- `.Rnw`/`.Rtex` builds complete headlessly.
- `paper.Rnw` and direct `paper.tex` builds serialize on `paper.tex`.
- A browser joining during any stage renders the same build without executing
  or skipping stages.
- SageTeX and PythonTeX failures produce typed diagnostics and nonzero results.

### Phase 6: Add The CLI And Agent Guidance

- Register `cocalc project build` as a thin project API client.
- Make waiting and exit-status semantics explicit and tested.
- Add human and JSON formatting from the same result DTO.
- Add runtime guidance only after the command is included in project tools.

Acceptance:

- A fresh project with no browser open builds `.tex`, `.Rnw`/`.Rtex`, `.Rmd`,
  and `.qmd` through the CLI.
- Valid documents exit `0` and invalid documents exit nonzero.
- Timeout and cancellation exit nonzero and report the build ID.
- CLI and frontend report the same build result for the same build ID.

### Phase 7: Delete Browser-Orchestrated Build Code

- Remove document rebuild triggers from generic exec job groups.
- Remove per-editor build job watchers used to rerun pipelines.
- Remove browser request queues and reply subjects from PR 278 if any were
  temporarily carried during development.
- Remove duplicate frontend subprocess wrappers after all imports move.
- Remove Redux-based overall-result reconstruction.
- Remove duplicate buildable extension registries.
- Remove background editor hydration introduced only for building.

Acceptance:

- Searching the frontend finds no code that starts a document build because an
  exec job appeared.
- The only production pipeline implementations are in
  `@cocalc/app-document-build`.
- The only production pipeline coordinator is the project build manager.

## Test Matrix

### App Unit Tests

- fake-runtime stage order and conditional branches
- all configuration precedence cases
- command argument and shell-command preservation
- parser golden fixtures
- identity and resource-key resolution
- overall success/failure derivation
- artifact and dependency normalization

### Project Service Tests

- no-browser start/get/completion
- progress sequence monotonicity
- reconnect/status reconciliation
- same-generation idempotency
- resource locking and global admission limits
- cancellation during every stage type
- client disconnect during a build
- completed-result retention and expiry
- project daemon restart/lost-build semantics

### CLI Tests

- supported and unsupported extensions
- path normalization and missing files
- success, compiler failure, timeout, and cancellation process status
- detached submission
- bounded human logs and complete-enough JSON diagnostics
- direct project API use with no browser session

### Frontend Tests

- save completes before build submission
- build-on-save generation reuse
- Build, Force Build, and Stop call the service correctly
- late open/reconnect hydrates an active snapshot
- multiple clients render one build ID
- PDF/HTML reload only after relevant artifact completion
- diagnostics update gutters without rerunning parsers in Redux actions

### Live Validation

Use a project with the required TeX, R, Sage, PythonTeX, and Quarto tools.
Validate at least:

- a quick plain LaTeX document
- a deliberately slow LaTeX document while opening a second browser
- a failing LaTeX document
- Knitr with a long LaTeX stage and a reconnect after Knitr completes
- direct `paper.tex` submission while `paper.Rnw` holds the shared resource
- SageTeX and PythonTeX documents
- R Markdown to HTML and PDF
- Quarto to HTML and PDF
- CLI builds after all browsers are closed

## Rollout

- Land the app extraction and project service behind a development feature flag
  if needed, but do not expose a browser fallback under the same API.
- Migrate one document kind at a time using the registry capability response.
- Keep old frontend rendering fields temporarily, not old execution authority.
- Enable CLI support only for kinds reported by the project service.
- Dogfood against Lite/Launchpad and CoCalc Plus because both use the same
  project API boundary.
- Remove the feature flag after every supported editor has moved and the legacy
  execution code is deleted.

## Final Acceptance Criteria

The work is complete only when all of the following are true:

- `cocalc project build <path>` performs the complete matching editor pipeline
  with no browser connected.
- Frontend and CLI builds call the same project-side implementation.
- One build has one authoritative ID, snapshot, result, and coordinator.
- Multiple browsers observe rather than execute a build.
- A client can reconnect during any stage without changing the pipeline.
- Knitr logical identity and generated `.tex` resource locking are correct.
- Build configuration is resolved without Redux or an open editor.
- Compiler failures reliably cause nonzero CLI status.
- No build request/reply protocol depends on `true` exec jobs, browser
  hydration, or first-browser-response-wins behavior.
- The old frontend pipeline implementations and duplicate registries are
  removed rather than retained indefinitely.
