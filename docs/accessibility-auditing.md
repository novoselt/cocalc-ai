# Automated accessibility auditing

CoCalc's local audit runner launches a dedicated system Chromium browser and
runs Lighthouse's accessibility category against a checked-in page matrix. It
supports both public landing pages and authenticated application pages.

## Run the audit

Start the local hub/launchpad stack, then run:

```bash
pnpm -C src accessibility:audit
```

The default matrix covers 30 stable routes across landing and product pages,
feature documentation, support and news, account preferences, project files,
and project settings. The runner reads the active hub development environment,
issues a local impersonation login URL, starts an isolated Chromium profile,
and audits every route in `src/scripts/accessibility/pages.json`. Reports are
written under `src/.local/accessibility/<timestamp>/`:

- `summary.md` gives the score and threshold for each page.
- `summary.json` is suitable for scripts and CI artifacts.
- `<page>.html` is the full interactive Lighthouse report.
- `<page>.json` contains complete machine-readable audit evidence.

Run only public pages without any authentication:

```bash
pnpm -C src accessibility:audit:public
```

An explicit public URL does not require a running local development stack:

```bash
pnpm -C src accessibility:audit:public -- \
  --base-url https://cocalc.ai
```

Run a subset or override the site and project:

```bash
pnpm -C src accessibility:audit -- \
  --base-url https://lite1b.cocalc.ai \
  --project-id aab0ea4c-40f2-4163-a109-a66f699698f3 \
  --pages landing,project-files
```

Use `--no-fail` for exploratory audits. The default command exits nonzero when
a page errors or falls below its configured minimum score.

## Add or tighten coverage

Edit `src/scripts/accessibility/pages.json`. Each entry defines:

- a stable page id and title;
- a route, with optional `{project_id}` interpolation;
- whether account authentication is required;
- a readiness selector and short settling delay;
- the minimum accepted Lighthouse accessibility score.

Once a page reaches a higher score, raise its threshold in the matrix. This
turns future accessibility regressions into deterministic test failures while
retaining the full Lighthouse evidence needed to fix them.

Prefer representative, stable routes over pages whose useful state depends on
ephemeral production data. For stateful editors or dialogs, first add
deterministic setup and a readiness selector, then include the route in the
matrix.

For a non-local authenticated site, pass an explicit one-time login URL with
`--login-url`. The runner intentionally does not accept passwords or persist
the temporary browser profile by default.
