# CoCalc Essential Frontend

`@cocalc/essential-frontend` is CoCalc's focused web application for doing
essential work with low startup, network, CPU, and interface overhead. It is a
recognizable subset of CoCalc rather than a separate visual product or a
preview of the full frontend.

The application is currently served at `/static/ultralite.html`. That URL is a
deployment detail retained for compatibility; `essential-frontend` is the
application and package name.

## Product Test

Every proposed surface and dependency must answer this question:

> Is this essential to a CoCalc user completing real work?

If the answer is no, it does not belong here. Essential does not mean the
smallest possible implementation. It means the smallest coherent CoCalc that
remains fast, reliable, understandable, and capable of serious work. A larger
lazy-loaded component is correct when it provides materially better
responsiveness or correctness without affecting users who do not invoke it.

This is also a discovery shell for CoCalc's backend. It should make project
files, terminals, Codex, notebooks, VMs, app servers, and the `cocalc` CLI easy
to find and use without recreating the full desktop environment.

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

Read-only views remain very small. CodeMirror 6 is loaded only after the user
chooses Edit, and only the selected language parser is loaded. Responsiveness
on real source files matters more than minimizing an explicitly requested,
cacheable editor chunk.

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

## Explicitly Out Of Scope

- course creation and instructor course management;
- administrative interfaces;
- full account settings and billing management;
- documentation browsing;
- workspace management and many simultaneous editor tabs;
- app-launcher configuration;
- complete LaTeX editing and build management;
- whiteboards, slides, tasks, and specialized editors;
- full project settings and collaborator administration;
- project-host management;
- process-manager and project activity-log interfaces;
- sophisticated full-text search and project-wide file finding; and
- backup and snapshot management.

These remain available through the clearly visible Open Full CoCalc action.
Their exclusion is intentional, not an invitation to add inert placeholders.

## Architecture

The initial shell uses the same-origin signed-in cookie. Account control-plane
state is resolved through the account's authoritative home bay. Project
ownership and host routing are explicit.

After project selection, steady-state files, terminal, Jupyter, chat, Codex,
and app-server traffic flows directly between the browser and the project
host. The hub authorizes and routes access but does not proxy project data.
Mobile and agent clients should share the same bounded project-host data-plane
APIs through headless protocol packages; they must not import this React UI.

Project-host bearer credentials stay in memory. File access is confined to the
authorized project namespace, transfers and rendering are bounded, and writes
use optimistic conflict detection. Untrusted chat and notebook content is not
inserted as arbitrary HTML or executed.

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
