# CoCalc Essential Frontend

`@cocalc/essential-frontend` is CoCalc's focused web application for doing
essential work with low startup, network, CPU, and interface overhead. It is a
recognizable CoCalc experience rather than a separate visual product, a
crippled demo, or a preview of the full frontend.

The defining distinction is the interaction model:

> Essential presents one project, file, or task at a time. Browser tabs provide
> concurrency. Full CoCalc provides integrated multi-project, multi-document
> workspace orchestration.

Full CoCalc is intentionally closer to a desktop environment or tiled window
manager: several projects can be open together, each project can contain many
open documents and applications, and the surrounding UI coordinates all of
that state. Essential is intentionally a conventional focused web application.
Its URL identifies the current project, file, or task; browser history handles
navigation; and ordinary browser tabs or windows provide parallel work.

This boundary is especially important on phones, tablets, low-memory devices,
and constrained networks. A small screen naturally demands one focused task,
and opening another browser tab is preferable to reproducing a desktop window
manager inside it. It also makes fast page loading a product requirement rather
than a cosmetic optimization: switching projects or files must be cheap enough
that users can rely on browser navigation for concurrency.

The application is served at `/essential/projects`. Project files use clean,
shareable paths such as
`/essential/projects/<project-id>/files/home/user/README.md`; a trailing slash
denotes a directory. Historical `/static/ultralite.html#/...` links remain
compatible and are converted to the clean route when opened.

## Product Test

Every proposed surface and dependency must answer these questions:

> Is this essential to a CoCalc user completing real work?

> Can it be presented as one focused, URL-addressable workflow without loading
> or recreating the full workspace orchestrator?

If the answer to the first question is no, it does not belong here. If the
answer to the second is no, the workflow belongs in Full CoCalc or must be
redesigned before it belongs in Essential. Essential does not mean the smallest
possible implementation or a short fixed feature list. It means the smallest
coherent CoCalc that remains fast, reliable, understandable, and capable of
serious work. A larger lazy-loaded component is correct when it provides
materially better capability or correctness without affecting users who do not
invoke it.

Essential should support the common path for starting, doing, collaborating
on, managing, and recovering work. Full CoCalc provides specialized creation
tools, simultaneous multi-surface workflows, and advanced control. This avoids
both extremes: a lightweight frontend that cannot complete real work and a
second implementation of the entire desktop frontend.

Essential is also a discovery shell for CoCalc's backend. It should make
project files, terminals, Codex, notebooks, VMs, app servers, documentation,
and the `cocalc` CLI easy to find and use without recreating the full desktop
environment.

## Navigation And Concurrency

Essential owns one primary context per browser tab. A route should be
shareable, reloadable, and meaningful without reconstructing hidden workspace
state. For example:

- a terminal route opens one retained project terminal; users who need several
  shell sessions can use `tmux`, open another browser tab, or use Full CoCalc;
- a file route opens one file, rather than adding it to an application-level
  tab strip;
- a project route replaces the current project context, rather than keeping
  several projects mounted in one page; and
- Recent provides lightweight return navigation, not another persistent
  workspace model.

Do not add application-level tabs, panes, virtual desktops, or background
mounted project surfaces merely to imitate Full CoCalc. Independent browser
tabs must remain safe and useful, including when they show different projects
or files. Cross-surface actions should navigate to a stable route, open a new
browser tab when parallel context is genuinely useful, or link to Full CoCalc
when integrated orchestration is the feature.

## Essential Product Scope

### Chat

Chat is the most important surface by a wide margin. The primary workflow is
working with Codex, including long-running sessions, recent activity, sending
guidance, continuing, interrupting, and recovering a live turn. Human chat is
also essential.

The interface is recent-message-first. It initially transfers and renders a
bounded tail, keeps the composer available at the bottom, follows new output
when the reader is already near the end, and makes loading older history an
explicit action. Markdown, code, links, and mathematical notation must render
safely without loading the full Slate editor.

### Files

Users can browse directories and view or edit ordinary text, source code, and
Markdown. Editing includes syntax highlighting, search, line numbers,
indentation, undo, keyboard save, wrapping control, and conflict-safe explicit
save. It deliberately excludes collaborative rich editing, IDE registries,
language servers, and sophisticated project-wide search.

Dotfiles are hidden by default and can be revealed with an account-scoped
browser preference. A bounded, account-scoped Recent index is also maintained
in local storage so users can return to files without loading project activity
streams or adding a network request.

Read-only views remain very small. CodeMirror 6 is loaded only after the user
chooses Edit, and only the selected language parser is loaded. Responsiveness
on real source files matters more than minimizing an explicitly requested,
cacheable editor chunk.

An open file uses one direct, non-polling project-host watch that is closed on
navigation. Read-only content reloads after an external change. Active editors
retain their draft and show a changed-on-disk warning; optimistic saves remain
the final protection against overwriting a newer version.

Reconciliation is explicit. **Merge disk changes** performs a conservative
three-way merge from the version originally opened, the current draft, and the
new disk version. A clean merge advances the disk baseline but remains an
unsaved draft for review. Overlapping edits never choose a winner or insert
conflict markers: the draft remains byte-for-byte unchanged and the user can
discard it or open Full CoCalc to resolve the conflict.

CodeMirror edits are composed from its operation log and checkpointed after a
short idle period, at a bounded maximum interval during continuous editing, and
on explicit save. The project host records those exact patches in the ordinary
Patchflow document with the authenticated account as author, then writes the
accepted merged value to disk. This preserves full TimeTravel history without
loading history, collaboration, or diff machinery in the Essential browser.

PDF files may use the browser's native viewer. Complete LaTeX authoring and
build management remain in full CoCalc.

### Terminal

The terminal is essential because it exposes nearly every command-line tool,
build system, remote host, and automation capability available in a project.
Opening Terminal automatically reconnects to its retained shell when the
project is already running. A stopped project is never started without an
explicit confirmation.

Terminal history is bounded by default, with an explicit option to request
more. The client provides reconnect, reset-frame, keyboard, paste, and compact
mobile controls. Terminal traffic flows directly between the browser and the
project host.

### Jupyter

Users can inspect notebooks, including mathematics, source, ordinary outputs,
images, and plots, and perform basic cell editing and execution. The essential
surface supports save, run, run-all, interrupt, and live-run recovery.

Markdown cells remain rendered until the user explicitly edits or
double-clicks them. Stored image outputs are fetched lazily from the notebook's
project-scoped AKV store over the direct project-host connection; this does not
load the full Jupyter frontend or proxy notebook data through the hub.

A project-host scan provides a recent-notebook index without starting project
compute. Its bounded result is cached per project for the browser session and
is rescanned only when the user explicitly refreshes it. Notebook cells use
the same lazy CodeMirror 6 foundation as file editing. `Shift+Enter` runs and
advances (inserting a code cell at the end), `Alt+Enter` runs and inserts below,
and `Ctrl+Enter` runs in place.

Notebook checkpoints use exact CodeMirror source patches plus the structural,
metadata, and output delta from the notebook opened by the client. The project
host applies only that delta to the live canonical notebook, preserving newer
RTC changes rather than replacing the document wholesale. Standard CoCalc and
instructor TimeTravel therefore see Essential edits, including nbgrader
metadata, even though Essential does not download the history viewer.

External notebook edits use stable cell ids for an explicit three-way merge.
Independent cell edits, and independent source/output/metadata changes within a
cell, merge cleanly. Concurrent source edits to the same cell are treated as
unsafe and retain the local notebook unchanged. This is the expected path when
a student edits one cell while an instructor or Codex changes another through
side chat.

Arbitrary HTML, JavaScript, widgets, JupyterLab plugins, and broad rich-output
registries are intentionally omitted. Users can launch JupyterLab when they
need that environment.

### Virtual Machines

Existing dedicated VMs are a core path to substantial CPU, memory, GPU,
Windows, and architecture-specific work. Essential frontend provides clear
status, cost context, connection details, and safe start/stop controls.
Creation, deletion, funding, disk management, and advanced configuration stay
in full CoCalc unless a future workflow proves essential.

### Apps

Users can discover and launch the essential project app servers, initially
JupyterLab and VS Code. Merely viewing the Apps surface does not start project
compute. App-launcher configuration and the full application catalog are out
of scope.

### Projects

Users can search and paginate their project list, open a project, and see the
small amount of state needed to choose correctly. The project shell exposes
only implemented essential surfaces.

Minimal project lifecycle and settings are essential: start, stop, restart,
project title and description, and a compact view of resource/access state.
Full project settings, collaborators administration, quotas, project-host
selection, logs, process management, backups, and snapshots remain in full
CoCalc.

### Notifications

Account notifications are essential when they require action or explain why
work is blocked. The current surface loads the lightweight account projection
only when opened. Any future unread indicator must be event-driven rather than
permanent polling. Advanced notification preferences remain in full account
settings.

### CLI Discovery

The client exposes concise, copyable `cocalc` commands for the current project
and links to the relevant terminal workflow. It is command discovery, not a
second embedded automation system.

### Appearance

Essential follows the operating-system light or dark preference by default and
keeps an explicit System/Light/Dark control in the shared upper-right bar. An
explicit choice is stored only in the browser and causes no network request or
polling. Page chrome, Markdown, CodeMirror, and a connected xterm update in
place, without reloading documents or reconnecting terminal sessions.

Theme colors are semantic CSS variables rather than separate component trees.
Images and scientific output retain a neutral light canvas when their pixels
assume one, while the surrounding notebook follows the selected appearance.

## Product Boundaries

Essential is not forbidden from supporting a capability merely because Full
CoCalc already has a sophisticated interface for it. Course management,
collaborators, secrets, SSH keys, account settings, human chat, and TimeTravel
can have focused Essential workflows when they are important to completing,
managing, or recovering real work. Those workflows should use narrow backend
operations and simple pages rather than porting the full frontend's desktop UI.

Some capabilities remain Full CoCalc concerns by definition or by deliberate
product choice:

- application-level workspace management, tiled panes, and many simultaneous
  editor tabs;
- administrative and project-host operator interfaces;
- app-launcher configuration and broad plugin registries;
- specialized creation environments such as whiteboards and slides;
- advanced process, activity-log, backup, snapshot, and project-wide search
  interfaces; and
- any workflow whose value comes primarily from coordinating several live
  surfaces in one browser tab.

Essential may still expose a focused read, status, recovery, or handoff path
for an advanced capability without absorbing its full management UI. Missing
workflows should link clearly to Full CoCalc rather than presenting inert
placeholders. This boundary can evolve, but the one-context-per-browser-tab
model and performance contract are permanent constraints.

## Architecture

The initial shell uses the same-origin signed-in cookie. Account control-plane
state is resolved through the account's authoritative home bay. Project
ownership and host routing are explicit.

After project selection, steady-state files, terminal, Jupyter, chat, Codex,
and app-server traffic flows directly between the browser and the project
host. The hub authorizes and routes access but does not proxy project data.
Mobile and agent clients should share the same bounded project-host data-plane
APIs through headless protocol packages; they must not import this React UI.
Interactive chat uses the product-neutral `project-chat-session` service from
`@cocalc/chat-client`, which owns bounded snapshots, disposable server
sessions, and reconnection semantics shared with future mobile and agent
clients.
The conservative text and notebook merge functions likewise live in
`@cocalc/util` and operate only on strings and serializable notebook values, so
the React Native client can use exactly the same conflict semantics without a
browser or DOM dependency.

Project-host bearer credentials stay in memory. File access is confined to the
authorized project namespace, transfers and rendering are bounded, and writes
use optimistic conflict detection. Untrusted chat and notebook content is not
inserted as arbitrary HTML or executed.

Edit-journal batches carry a browser-session journal id and monotonic sequence,
making retries idempotent. The project-host service rechecks project
collaboration, serializes writes per document, bounds patch and notebook sizes,
and rejects stale disk baselines. It does not poll, proxy through the hub, or
introduce a second history store.

The client checks journal-service availability once per project-host connection
and caches the result. During a rolling deployment, an older host safely falls
back to the existing optimistic disk write rather than making editing
unavailable; a refreshed connection uses Patchflow as soon as the host supports
it.

## Performance Contract

- The signed-in shell, project list, and read-only file listing never load
  CodeMirror, xterm, notebook execution, chat rendering, or optional language
  grammars.
- Optional surfaces load only after explicit navigation or action.
- There is no permanent polling for account, project, file, billing, presence,
  notification, or VM state.
- Bounded polling is permitted only for a visible in-progress operation and
  stops on completion, timeout, navigation, or unmount.
- Shared chunks count against every route that loads them.
- Route budgets measure Brotli bytes, request count, parse time, main-thread
  work, heap use, and direct project data separately.
- Canonical release evidence uses a cold cache at 1.4 Mbps down, 750 Kbps up,
  150 ms added latency, plus a separate 4x CPU run.

The editor budget counts the editor core and the largest single dynamically
selected language parser, not all mutually exclusive parsers. Read-only code
continues to use deferred Prism highlighting. The editor must remain absent
until Edit is requested.

## Dependency Rules

The essential application may use React, narrowly imported CoCalc protocol
clients, browser primitives, Prism for read-only code, CodeMirror 6 for lazy
editing, xterm.js for lazy terminals, markdown-it for chat and Markdown, and
lazy KaTeX for mathematics.

It must not import `@cocalc/frontend`, Ant Design, Redux, Immutable.js, jQuery,
Slate, ProseMirror, Monaco, Ace, JupyterLab packages, the full editor registry,
the full internationalization runtime, third-party fonts, or remote UI assets.
New dependencies require a measured route-level cost and a security review.

## Build And Release

`@cocalc/essential-frontend` owns application source, styles, package-local
tests, accessibility behavior, and its direct dependencies. `@cocalc/static`
owns the small browser entry, Rspack compilation, HTML generation, deployment,
and aggregate bundle-graph enforcement.

Run package validation with:

```sh
pnpm --filter @cocalc/essential-frontend build
pnpm --filter @cocalc/essential-frontend test
```

Run production graph and route-budget validation from `src/packages/static`:

```sh
pnpm check-ultralite-budgets
```

The historical `ultralite` chunk and telemetry names are retained until a
coordinated URL and observability migration is justified.
