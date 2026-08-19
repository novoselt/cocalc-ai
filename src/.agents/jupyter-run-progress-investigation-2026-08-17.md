# Jupyter "Code" run-progress bar stuck at 0 (2026-08-17)

Branch: `fix-jupyter-run-progress-20260817`, off `main` (`e26dc5f933`).

Six defects, all from the same migration: Jupyter runtime state moved out of the
syncdb into the runtime-state DKO (`packages/jupyter/redux/runtime-state.ts`),
and several producers and triggers were lost along the way without breaking any
type.

## Symptom

The `Code` meter in the notebook status bar stayed at 0 no matter how many cells
were run. It reports "percent of code cells that have been run since the kernel
started".

Reported alongside "the run button does not turn into a stop button", but that
cleared after a browser refresh and is unrelated — the stop button switches on
`cell.get("state")` in `frontend/jupyter/cell-buttonbar.tsx`, a different
consumer. CPU/RAM works throughout; it arrives on its own channel
(`frontend/jupyter/kernel-usage.ts`).

## The mechanism

`updateRunProgress` (`packages/jupyter/redux/actions.ts`) computes the value
from exactly two inputs:

1. `store.get("last_backend_state")` — when the kernel last changed backend
   state. **If null it returns early, leaving the previous value.** If
   `backend_state != "running"` it forces `runProgress: 0`.
2. per-cell `start` / `end` — a cell counts as ran when `start >= last`, at 0.5
   if it has no `end` yet.

## 1. `last_backend_state` had no writer (the actual cause)

Upstream writes it in `project-actions.ts` `set_backend_state`, next to
`backend_state`: `this._set({type: "settings", backend_state,
last_backend_state: Date.now()})`. In cocalc-ai that logic moved into
`kernel/kernel.ts` `setState()`, which wrote only `backend_state` — **the second
field was dropped, and nothing anywhere set it.** It survived in the
`JupyterRuntimeSettings` type and was plumbed into the store, so every read path
looked wired up, and it typechecked because the field is optional.

Consequence: during startup `backend_state != "running"` pins the meter to 0;
once running, `last == null` early-returns forever. Restored in `setState()`;
its existing `if (this._state == state) return;` guard supplies upstream's
`lastSavedBackendState` dedup.

## 2. Nothing on the DKO path recomputed the value

`updateRunProgress()` had exactly two call sites, both `syncdb.on("change")`
handlers in `frontend/jupyter/browser-actions.ts`. Both of its inputs now arrive
over the DKO, and `runtimeStateChange` never recomputed. With #1 alone fixed the
meter would still refresh only when the syncdb incidentally changed, missing
cells that emit no output.

Fixed with a `__runtime_state_change_post_hook()` no-op in the shared actions
class, overridden in `browser-actions.ts` with a debounced `updateRunProgress`.
Follows the existing `__syncdb_change_post_hook` pattern, so the work stays
browser-only (`updateRunProgress` is documented browser-only).

## 3. Clock skew between the two inputs

`last_backend_state` is stamped by the project. Per-cell `start`/`end` were read
from `store.cells` — which optimistic browser rendering overlays with
*browser*-clock values via `set_local_runtime_cell_state`. A browser clock
behind the project's fails `start >= last`, and no later event repairs it. New
in cocalc-ai: upstream has no local optimistic rendering path.

Timestamps now come from the authoritative runtime cell record
(`getRuntimeCell`), so both sides of the comparison are project-stamped. The
store cell is still used for `cell_type`/`input`.

## 4. The settings record could hide its own fields

A DKO keeps a per-key field manifest: `set()` replaces it with
`Object.keys(obj)` (`conat/sync/dko.ts`), and `get()` exposes only listed
fields. The settings record was merged from that filtered view, so a writer
could publish a manifest lacking a field another writer had just set — newly
relevant now that the browser publishes optimistic backend/kernel state while
the project owns `last_backend_state`.

Fixed by reading every settings field through `getField`, which addresses a
path, not the manifest — the same recovery the cell records already use for
their terminal `end` field. `patchRuntimeRecord` was removed with its last
caller, since merging from the filtered view is the unsafe pattern.

**A fixed manifest is the wrong tool here**, and a first attempt that copied the
cell records' approach was worse than the bug: filling unknown fields with null
to publish a complete manifest destroys a concurrent writer's value, because
`getField` sees only the local replica and DKO resolves conflicts in favour of
the local write. The concrete failure is a patch queued before the DKO opens —
`flushPendingRuntimeRecords` writes it verbatim after bootstrap, so a null would
overwrite the project's freshly arrived timestamp and recreate the original bug.
A cell record can use a fixed manifest because one writer owns all three of its
fields; the settings record is shared between the project's kernel and the
browser's optimistic state. So `set_runtime_settings` writes only fields it has
a value for. The resulting manifest may be incomplete, which is harmless: every
settings read goes through `getRuntimeSettingsRecord`, and `getAll()`
reconstructs from paths rather than manifests. Only `DKO.delete()` consults the
manifest, and the settings record is never deleted.

## 5. Trailing-only debounce starved during run-all

A run-all of fast cells never pauses 500ms, so the trailing-only debounce would
not fire until the whole run finished. Added `maxWait`, and `.cancel()` on
close.

## 6. `kernel_error` lost its producer the same way

Found by sweeping the other fields for the #1 pattern. `kernel/kernel.ts`
`setFailed` still emits `kernel_error`, but nothing has listened since the
migration — upstream attaches the listener at kernel construction. Kernel
crashes were silent; the only remaining `set_kernel_error` callers are frontend
dismissal and test paths.

Reattached in `ensureKernelIsReady`, with upstream's delayed clearing: three
seconds of held `running` clears the error, any other transition cancels it.
Upstream hangs that off its project-side `set_backend_state`, which does not
exist here, so it hangs off the kernel's `"state"` event instead.

## Transferable lesson

When a value reads as null, grep for its **writer**, not only its readers. Two
rounds of reading the consumer side produced #2 — real, but secondary — and
missed #1 entirely. The syncdb→DKO migration can leave a field readable,
type-correct and fully plumbed with no producer at all, which nothing in the
type system or the read path reveals.

## Verification

Every fix has a test confirmed to fail without it, checked by reverting the fix
and re-running rather than by inspection. Two of these are easy to get wrong:

- the #6 lifecycle tests pass even with the listener registration missing — the
  test that actually catches the regression is the one asserting the
  subscription itself;
- the #5 debounce needs a browser-actions instance, not the shared class. A
  test that only spies on the base no-op hook proves nothing about `maxWait` or
  `.cancel()`.

Not reproducible on localhost: #3 needs browser and project clocks to differ,
#4 needs concurrent writers, #6 needs a genuinely crashing kernel (e.g.
`import os; os._exit(1)`).

## Not related to the Studio rename

PR #264 (`jupyter-view-naming-20260817`) changes zero files in
`packages/jupyter`, `packages/project`, `packages/conat` or `packages/sync`, and
does not touch `cell-buttonbar.tsx`. Its status-bar work only changes how the
value is displayed.
