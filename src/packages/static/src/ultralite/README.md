# CoCalc Constrained Client

The constrained client is an opt-in, separately built CoCalc web client for
bandwidth- and CPU-constrained devices. It is served at
`/static/ultralite.html` and does not replace or share an entrypoint with the
full application.

## Product Boundary

The implemented client provides:

- a searchable, paginated project list and compact familiar project shell;
- direct project-host directory listings, bounded file reads, and downloads;
- deferred Prism syntax highlighting for a small explicit language set;
- a native-textarea code editor with manual save, revert, keyboard save, and
  hash-bound conflict detection;
- safe read-only Jupyter rendering plus a separately loaded focused editor for
  cell add/delete/move, save, run, run-all, interrupt, and live-run recovery;
- existing Codex session discovery, bounded history, safe links, send,
  interrupt, continue, reconnect, and activity display;
- explicit status and start/stop controls for existing dedicated VMs;
- explicit status and launch controls for JupyterLab and VS Code; and
- a compact CoCalc CLI discovery surface with copyable project-context
  commands.

Creation and advanced management remain in full CoCalc. The constrained
client deliberately omits terminals, realtime filesystem updates, presence,
rich notebook HTML/widgets, broad editor integrations, and background account
polling. Opening files, a notebook, VMs, or Apps does not start project
compute. Running a notebook or starting an app is an explicit action.

## Architecture And Security

The initial shell uses the same-origin signed-in cookie. The first authorized
project window is read from the account's authoritative home bay through the
bounded bootstrap API; the Projects route does not load Conat. After project
selection, the client opens the ordinary home-bay control-plane connection and
scoped direct project-host connections. File, Jupyter, Codex, and app-server
data do not flow through the hub.

Project-host bearer credentials remain in memory. File paths are confined to
`/home/user`; reads and output have hard size limits; HTML, JavaScript,
widgets, iframes, and arbitrary notebook MIME renderers are omitted. Text and
notebook writes use `writeFileIfUnchanged` and never fall back to blind
overwrite. Jupyter reconnect uses the existing ephemeral project-host live-run
store and preserves run identity, so reconnect never resubmits execution.

Telemetry is cookie-authenticated, site-setting gated, content-free, and
server-side allowlisted. It records fixed surfaces, outcomes, browser/network
hints, byte counts, and useful-surface timing. It cannot record project IDs,
paths, filenames, prompts, contents, output, tokens, or credentials.

## Release Evidence

Run the production graph gate from `src/packages/static`:

```sh
pnpm check-ultralite-budgets
```

It writes `dist-prod-measure/ultralite-budget-report.json`, reports raw, gzip,
Brotli, and request counts, enforces cumulative Brotli ceilings, and rejects
imports of the full frontend, Ant Design, Redux, Immutable, jQuery, broad
editors, ProseMirror, and JupyterLab.

The 2026-08-15 implementation measurement is:

| Surface                 |        Raw |      Gzip |    Brotli | Requests |  Hard limit |
| ----------------------- | ---------: | --------: | --------: | -------: | ----------: |
| Shell                   |  233.6 KiB |  73.5 KiB |  69.4 KiB |        1 |      75 KiB |
| Projects                |  239.9 KiB |  76.1 KiB |  71.9 KiB |        2 |     400 KiB |
| Files/read-only Jupyter | 1667.5 KiB | 440.7 KiB | 403.7 KiB |       11 |     425 KiB |
| Syntax code/editor      | 1724.0 KiB | 464.9 KiB | 426.6 KiB |       27 | 450/500 KiB |
| Executable Jupyter      | 1710.9 KiB | 455.5 KiB | 418.1 KiB |       13 |     650 KiB |
| Codex                   | 1938.4 KiB | 512.4 KiB | 472.1 KiB |       15 |     550 KiB |
| VMs                     | 1660.5 KiB | 438.6 KiB | 401.8 KiB |       11 |     450 KiB |
| Apps                    | 1661.4 KiB | 438.6 KiB | 401.7 KiB |       11 |     475 KiB |
| CLI                     | 1658.4 KiB | 437.9 KiB | 401.1 KiB |       11 |     425 KiB |

The canonical Slow 4G harness uses 1.4 Mbps down, 750 Kbps up, 150 ms added
latency, cold and warm cache runs, and optional 4x CPU slowdown:

```sh
pnpm measure:ultralite -- \
  --url https://staging.cocalc.ai \
  --storage-state /path/to/signed-in-state.json \
  --project-id PROJECT_ID \
  --file /home/user/example.py \
  --notebook /home/user/example.ipynb \
  --standard-url https://staging.cocalc.ai \
  --viewport desktop \
  --cpu 1 \
  --assert-slo
```

The report contains useful-surface timing, CDP transfer and request counts,
WebSocket bytes, decoded resource bytes, script/task duration, heap use,
performance marks, errors, and constrained/full-client screenshots. Repeat
with `--viewport narrow --cpu 4`. Accessibility coverage is registered as
`ultralite-projects` and `ultralite-project-files` in the standard audit.
