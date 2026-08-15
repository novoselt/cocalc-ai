# CoCalc Ultralite

Ultralite is an experimental, separately built CoCalc client for constrained
networks and devices. It is available at `/static/ultralite.html` and does not
replace or share an entrypoint with the full application.

## Product boundary

The first usable version provides:

- a paginated, searchable project list and compact project shell;
- direct project-host directory listings and bounded file reads;
- safe, read-only text and Jupyter notebook views;
- existing Codex chat sessions with send and interrupt controls;
- explicit, on-demand status and start/stop controls for existing dedicated
  VMs;
- explicit, on-demand status and launch controls for JupyterLab and VS Code;
- explicit links back to the full CoCalc application.

It deliberately omits editing, notebook execution, terminals, collaboration
presence, automatic file updates, and background polling. Opening Codex chat,
starting a VM, or starting an app server is an explicit action that may start
compute. Ordinary file browsing and viewing the Apps or VMs page do not start
project compute.

## Architecture and security

The HTML shell and initial React entrypoint are static assets. Authentication is
bootstrapped from the existing same-origin CoCalc cookie. The client then opens
an account-home-bay Conat connection for project metadata and obtains scoped,
direct project-host connections for files and chat. Project file data does not
flow through the hub.

File paths are confined to `/home/user`. Text and notebook reads have hard size
limits, binary files are not downloaded, and notebook HTML output is omitted
instead of inserted into the DOM. Chat and file surfaces are separate lazy
chunks, loaded only when their routes are opened. VM metadata remains an
account control-plane operation. App-server status and launch traffic goes
directly to the owning project host after normal project routing.

## Bundle constraints

Run `pnpm check-ultralite-budgets` from `src/packages/static` after a production
analysis build. The check enforces cumulative Brotli budgets for the shell,
projects, file/Jupyter, Codex chat, VM, and app-server surfaces. It also rejects
accidental imports of the full frontend, Ant Design, Redux, Immutable, Slate,
CodeMirror, Monaco, Ace, ProseMirror, JupyterLab, and jQuery.
