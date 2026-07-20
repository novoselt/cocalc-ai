# Bootstrap Python Publisher

`bootstrap.py` is served to project hosts during bootstrap. It is now published
to the software bucket so updates don't require rebuilding the hub bundle.

Preferred deploy path (from repo root):

```
cocalc software deploy --build host-bootstrap:<tag> <profile>
cocalc software deploy --build --rollout --bootstrap-scope helpers host-bootstrap:<tag> <profile>
```

This records `bootstrap.py` as an immutable software artifact, publishes the
mutable `software/bootstrap/latest/bootstrap.py` pointer, writes deployment
history, and reconciles online hosts.

The reconcile scope is mandatory:

- `helpers` atomically updates privileged host helpers and their sudo policy
  without restarting project-host, Conat, or ACP services.
- `full` runs the complete bootstrap reconcile and restarts project-host. Use
  it only when the changed bootstrap code requires full host convergence.

Low-level publish fallback:

```
pnpm --dir src/packages/server publish:bootstrap
```

Required env:

- `COCALC_R2_ACCOUNT_ID`
- `COCALC_R2_ACCESS_KEY_ID`
- `COCALC_R2_SECRET_ACCESS_KEY`
- `COCALC_R2_BUCKET`
- `COCALC_R2_PUBLIC_BASE_URL` (e.g., `https://software.cocalc.ai`)

Optional:

- `COCALC_BOOTSTRAP_SELECTOR` (default: `latest`)
- `COCALC_BOOTSTRAP_CACHE_CONTROL`

Publishes to:
`$COCALC_R2_PUBLIC_BASE_URL/software/bootstrap/<selector>/bootstrap.py`
and `bootstrap.py.sha256`.
