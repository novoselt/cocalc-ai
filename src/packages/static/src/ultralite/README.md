# CoCalc Ultralite

Ultralite is an experimental, separately built CoCalc client for constrained
networks and devices. It is available at `/static/ultralite.html` and does not
replace or share an entrypoint with the full application.

## Product boundary

The first usable version provides:

- a paginated project list and project dashboard;
- direct project-host directory listings and bounded file reads;
- safe, read-only text and Jupyter notebook views;
- existing Codex chat sessions with send and interrupt controls; and
- explicit links back to the full CoCalc application.

It deliberately omits editing, notebook execution, terminals, collaboration
presence, automatic file updates, and background polling. Opening Codex chat
may briefly poll while starting a stopped project; ordinary file browsing does
not start project compute.

## Architecture and security

The HTML shell and initial React entrypoint are static assets. Authentication is
bootstrapped from the existing same-origin CoCalc cookie. The client then opens
an account-home-bay Conat connection for project metadata and obtains scoped,
direct project-host connections for files and chat. Project file data does not
flow through the hub.

File paths are confined to `/home/user`. Text and notebook reads have hard size
limits, binary files are not downloaded, and notebook HTML output is omitted
instead of inserted into the DOM. Chat and file surfaces are separate lazy
chunks, loaded only when their routes are opened.

## Bundle constraints

Run `pnpm check-ultralite-budgets` from `src/packages/static` after a production
analysis build. The check enforces cumulative Brotli budgets for the shell,
projects, file/Jupyter, and Codex chat surfaces. It also rejects accidental
imports of the full frontend, Ant Design, Redux, Immutable, Slate, CodeMirror,
JupyterLab, and jQuery.
