/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import type { FilesystemClient } from "@cocalc/conat/files/fs";
import type { AccountProjectListWindowRow } from "@cocalc/conat/hub/api/projects";
import {
  jupyterClient,
  type JupyterClient,
  type OutputMessage,
} from "@cocalc/conat/project/jupyter/run-code";
import {
  openJupyterLiveRunStore,
  type JupyterLiveRunSnapshot,
} from "@cocalc/conat/project/jupyter/live-run";
import { syncdbPath } from "@cocalc/util/jupyter/names";
import { useEffect, useRef, useState, type RefCallback } from "react";
import CodeMirrorEditor, {
  type CodeMirrorEditorHandle,
  type CodeMirrorShortcut,
} from "./codemirror-editor";
import type { UltraliteSession } from "./session";
import {
  NotebookOutputView,
  parseNotebook,
  sourceText,
  type NotebookCell,
  type NotebookDocument,
  type NotebookOutput,
} from "./notebook-view";
import { InlineAlert, LoadingState } from "./ui";
import { ULTRALITE_BEFORE_NAVIGATE } from "./routes";
import {
  recordUltraliteFailure,
  recordUltraliteOutcome,
  recordUltraliteSurfaceReady,
} from "./telemetry";
import type { UltraliteLanguage } from "./prism-languages";

const MAX_OUTPUT_TEXT = 100_000;
const MAX_OUTPUT_IMAGE = 7 * 1024 * 1024;

function cloneNotebook(notebook: NotebookDocument): NotebookDocument {
  return JSON.parse(JSON.stringify(notebook));
}

function normalizeNotebook(notebook: NotebookDocument): NotebookDocument {
  const value = cloneNotebook(notebook);
  value.nbformat ??= 4;
  value.nbformat_minor ??= 5;
  value.metadata ??= {};
  value.cells = value.cells.map((cell) => ({
    ...cell,
    id: cell.id || crypto.randomUUID(),
    metadata: cell.metadata ?? {},
    outputs: cell.cell_type === "code" ? (cell.outputs ?? []) : undefined,
    source: sourceText(cell.source),
  }));
  return value;
}

function serializeNotebook(notebook: NotebookDocument): string {
  return `${JSON.stringify(notebook, null, 1)}\n`;
}

function boundedText(value: unknown): string {
  const text = Array.isArray(value) ? value.join("") : `${value ?? ""}`;
  return text.length <= MAX_OUTPUT_TEXT
    ? text
    : `${text.slice(0, MAX_OUTPUT_TEXT)}\n[output truncated]`;
}

function boundedData(value: unknown): Record<string, string> | undefined {
  if (value == null || typeof value !== "object") return;
  const data = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  if (data["text/plain"] != null) {
    result["text/plain"] = boundedText(data["text/plain"]);
  }
  for (const mime of ["image/png", "image/jpeg"] as const) {
    const image = `${data[mime] ?? ""}`.replace(/\s/g, "");
    if (image && image.length <= MAX_OUTPUT_IMAGE) result[mime] = image;
  }
  if (data["text/html"] != null || data["application/javascript"] != null) {
    result["text/html"] = "[unsafe rich output omitted]";
  }
  return Object.keys(result).length ? result : undefined;
}

export function notebookOutputFromMessage(
  message: OutputMessage,
): NotebookOutput | undefined {
  const content = message.content ?? {};
  switch (message.msg_type) {
    case "stream":
      return {
        output_type: "stream",
        name: `${content.name ?? "stdout"}`,
        text: boundedText(content.text),
      };
    case "error":
      return {
        output_type: "error",
        ename: `${content.ename ?? "Error"}`,
        evalue: boundedText(content.evalue),
        traceback: Array.isArray(content.traceback)
          ? content.traceback.map(boundedText)
          : [],
      };
    case "display_data":
    case "execute_result":
      return {
        output_type: message.msg_type,
        data: boundedData(content.data),
        execution_count:
          typeof content.execution_count === "number"
            ? content.execution_count
            : null,
        metadata:
          content.metadata && typeof content.metadata === "object"
            ? content.metadata
            : {},
      };
    default:
      return;
  }
}

function asText(value: string | Uint8Array): string {
  return typeof value === "string" ? value : new TextDecoder().decode(value);
}

function cellInput(cell: NotebookCell): string {
  return sourceText(cell.source);
}

function newNotebookCell(
  cellType: "code" | "markdown" | "raw" = "code",
): NotebookCell {
  return {
    cell_type: cellType,
    id: crypto.randomUUID(),
    metadata: {},
    outputs: cellType === "code" ? [] : undefined,
    source: "",
  };
}

export function insertNotebookCellBelow(
  notebook: NotebookDocument,
  index: number,
  cellType: "code" | "markdown" | "raw" = "code",
): { cellId: string; notebook: NotebookDocument } {
  const cell = newNotebookCell(cellType);
  const cells = [...notebook.cells];
  cells.splice(Math.min(index + 1, cells.length), 0, cell);
  return { cellId: cell.id!, notebook: { ...notebook, cells } };
}

function notebookCodeLanguage(
  notebook: NotebookDocument,
): UltraliteLanguage | undefined {
  const metadata = notebook.metadata ?? {};
  const value = `${
    metadata.language_info?.name ?? metadata.kernelspec?.language ?? ""
  }`.toLowerCase();
  if (value.includes("python")) return "python";
  if (value.includes("typescript")) return "typescript";
  if (value.includes("javascript") || value === "node") return "javascript";
  if (value === "go" || value === "golang") return "go";
  if (value === "rust") return "rust";
  if (value === "bash" || value === "shell" || value === "sh") return "bash";
  if (value === "sql") return "sql";
  return;
}

function NotebookCellEditor({
  autoFocus,
  cell,
  editorRef,
  index,
  language,
  onChange,
  onSave,
  path,
  readOnly,
  shortcuts,
}: {
  autoFocus: boolean;
  cell: NotebookCell;
  editorRef: RefCallback<CodeMirrorEditorHandle>;
  index: number;
  language?: UltraliteLanguage;
  onChange: (value: string) => void;
  onSave: () => void;
  path: string;
  readOnly: boolean;
  shortcuts: CodeMirrorShortcut[];
}) {
  // CodeMirror owns the live draft. Parent updates must not reset its history.
  const [initialValue] = useState(() => cellInput(cell));
  return (
    <CodeMirrorEditor
      ariaLabel={`Source for cell ${index + 1}`}
      autoFocus={autoFocus}
      className="ul-notebook-cm"
      initialValue={initialValue}
      language={cell.cell_type === "markdown" ? "markdown" : language}
      onChange={onChange}
      onCursorChange={() => undefined}
      onDirtyChange={() => undefined}
      onLanguageError={() => undefined}
      onSave={onSave}
      path={`${path}#${cell.id ?? index}`}
      readOnly={readOnly}
      ref={editorRef}
      shortcuts={shortcuts}
      spellCheck={cell.cell_type === "markdown"}
      wrap={cell.cell_type !== "code"}
    />
  );
}

export default function NotebookEditor({
  baseContents: initialBase,
  filesystem,
  notebook: initialNotebook,
  onDirtyChange,
  onSaved,
  path,
  project,
  readOnly,
  session,
}: {
  baseContents: string;
  filesystem: FilesystemClient;
  notebook: NotebookDocument;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: (notebook: NotebookDocument, contents: string) => void;
  path: string;
  project: AccountProjectListWindowRow;
  readOnly: boolean;
  session: UltraliteSession;
}) {
  const [notebook, setNotebook] = useState(() =>
    cloneNotebook(initialNotebook),
  );
  const [baseContents, setBaseContents] = useState(initialBase);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [runningCell, setRunningCell] = useState<string>();
  const [kernelStatus, setKernelStatus] = useState("not started");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [editorEpoch, setEditorEpoch] = useState(0);
  const jupyter = useRef<JupyterClient | undefined>(undefined);
  const cellEditors = useRef(new Map<string, CodeMirrorEditorHandle>());
  const completedLiveRunIds = useRef(new Set<string>());
  const directRunId = useRef<string | undefined>(undefined);
  const dirtyRef = useRef(dirty);
  const processLiveRuns = useRef<() => void>(() => undefined);
  const projectApi = useRef<
    Awaited<ReturnType<UltraliteSession["openProjectApi"]>>["api"] | undefined
  >(undefined);
  dirtyRef.current = dirty;

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const beforeNavigate = (event: Event) => {
      if (dirty && !window.confirm("Discard unsaved notebook changes?")) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener(ULTRALITE_BEFORE_NAVIGATE, beforeNavigate);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener(ULTRALITE_BEFORE_NAVIGATE, beforeNavigate);
    };
  }, [dirty]);

  useEffect(
    () => () => {
      jupyter.current?.close();
    },
    [],
  );

  useEffect(() => recordUltraliteSurfaceReady("notebook_execute"), []);

  const updateCell = (index: number, patch: Partial<NotebookCell>) => {
    setNotebook((current) => ({
      ...current,
      cells: current.cells.map((cell, i) =>
        i === index ? { ...cell, ...patch } : cell,
      ),
    }));
    setDirty(true);
    setNotice(undefined);
  };

  const saveCandidate = async (candidate: NotebookDocument) => {
    const contents = serializeNotebook(candidate);
    await filesystem.writeFileIfUnchanged(path, contents, baseContents, true);
    setBaseContents(contents);
    setNotebook(candidate);
    setDirty(false);
    setConflict(false);
    onSaved?.(candidate, contents);
    return contents;
  };

  const save = async () => {
    if (readOnly || saving || running || !dirty) return;
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await saveCandidate(normalizeNotebook(notebook));
      setNotice("Notebook saved.");
      recordUltraliteOutcome("notebook_execute", "file_save");
    } catch (err: any) {
      recordUltraliteFailure("notebook_execute", err);
      if (err?.code === "ETAG_MISMATCH") {
        setConflict(true);
        recordUltraliteOutcome("notebook_execute", "save_conflict");
      }
      setError(
        err?.code === "ETAG_MISMATCH"
          ? "This notebook changed on the server. Your draft was not written; reload it or resolve the conflict in full CoCalc."
          : err instanceof Error
            ? err.message
            : `${err}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const applyMessages = (messages: OutputMessage[]) => {
    const started = messages.find(
      (message) =>
        message.id &&
        (message.lifecycle === "cell_start" ||
          message.msg_type === "cell_start"),
    );
    if (started?.id) setRunningCell(started.id);
    setNotebook((current) => {
      const cells = current.cells.map((cell) => ({ ...cell }));
      for (const message of messages) {
        if (!message.id) continue;
        const index = cells.findIndex(({ id }) => id === message.id);
        if (index < 0) continue;
        const cell = { ...cells[index] };
        if (
          message.lifecycle === "cell_start" ||
          message.msg_type === "cell_start"
        ) {
          cell.outputs = [];
        }
        if (message.msg_type === "clear_output") cell.outputs = [];
        if (
          (message.msg_type === "execute_input" ||
            message.msg_type === "execute_reply") &&
          typeof message.content?.execution_count === "number"
        ) {
          cell.execution_count = message.content.execution_count;
        }
        const output = notebookOutputFromMessage(message);
        if (output) cell.outputs = [...(cell.outputs ?? []), output];
        cells[index] = cell;
      }
      return { ...current, cells };
    });
  };
  const applyMessagesRef = useRef(applyMessages);
  applyMessagesRef.current = applyMessages;

  useEffect(() => {
    if (!project.host_id) return;
    let disposed = false;
    let store: Awaited<ReturnType<typeof openJupyterLiveRunStore>> | undefined;
    const seenBatchIds = new Set<string>();
    const observedRunIds = new Set<string>();
    let recovering = false;
    let queue = Promise.resolve();

    const reloadSavedNotebook = async () => {
      if (dirtyRef.current) {
        setConflict(true);
        setError(
          "Notebook execution finished elsewhere while this draft had unsaved changes. The draft was not overwritten; reload or resolve it in full CoCalc.",
        );
        return;
      }
      const saved = asText(
        (await filesystem.readFile(path, "utf8")) as string | Uint8Array,
      );
      if (disposed) return;
      const savedNotebook = parseNotebook(saved);
      setNotebook(savedNotebook);
      setEditorEpoch((value) => value + 1);
      onSaved?.(savedNotebook, saved);
      setBaseContents(saved);
      setDirty(false);
      setConflict(false);
    };

    const process = async () => {
      if (disposed || !store) return;
      const snapshots = Object.values(
        store.getAll() as Record<string, JupyterLiveRunSnapshot>,
      )
        .filter(
          (snapshot) =>
            snapshot?.path === path &&
            typeof snapshot.run_id === "string" &&
            Array.isArray(snapshot.batches),
        )
        .sort((a, b) => a.updated_at_ms - b.updated_at_ms);
      let hasActiveRun = false;
      for (const snapshot of snapshots) {
        const runId = snapshot.run_id;
        if (
          directRunId.current === runId ||
          completedLiveRunIds.current.has(runId)
        ) {
          continue;
        }
        if (snapshot.done === true && !observedRunIds.has(runId)) continue;
        observedRunIds.add(runId);
        for (const batch of [...snapshot.batches].sort(
          (a, b) => a.seq - b.seq,
        )) {
          if (!batch.id || seenBatchIds.has(batch.id)) continue;
          seenBatchIds.add(batch.id);
          applyMessagesRef.current(batch.mesgs as OutputMessage[]);
        }
        if (snapshot.done === true) {
          completedLiveRunIds.current.add(runId);
          observedRunIds.delete(runId);
          await reloadSavedNotebook();
        } else {
          hasActiveRun = true;
        }
      }
      if (disposed || directRunId.current) return;
      setRunning(hasActiveRun);
      if (hasActiveRun) {
        recovering = true;
        setKernelStatus("reattached to active execution");
      } else if (recovering && observedRunIds.size === 0) {
        recovering = false;
        setRunningCell(undefined);
        setKernelStatus("idle");
      }
    };
    const schedule = () => {
      queue = queue.then(process).catch((err) => {
        if (!disposed) {
          recordUltraliteFailure("notebook_execute", err);
          setError(
            `Unable to recover live notebook execution: ${err instanceof Error ? err.message : err}`,
          );
        }
      });
    };
    processLiveRuns.current = schedule;

    void session
      .openProjectApi(project.project_id, project.host_id)
      .then(async (opened) => {
        if (disposed) return;
        projectApi.current = opened.api;
        store = await openJupyterLiveRunStore({
          client: opened.lease.client,
          project_id: project.project_id,
          path,
        });
        if (disposed) {
          store.close();
          return;
        }
        store.on("change", schedule);
        schedule();
      })
      .catch((err) => {
        if (!disposed) {
          recordUltraliteFailure("notebook_execute", err);
          setError(
            `Live notebook recovery is unavailable: ${err instanceof Error ? err.message : err}`,
          );
        }
      });
    return () => {
      disposed = true;
      processLiveRuns.current = () => undefined;
      store?.removeListener("change", schedule);
      store?.close();
    };
  }, [filesystem, path, project.host_id, project.project_id, session]);

  const focusCell = (cellId?: string) => {
    if (!cellId) return;
    requestAnimationFrame(() => cellEditors.current.get(cellId)?.focus());
  };

  const runCells = async (
    indexes: number[],
    notebookCandidate: NotebookDocument = notebook,
    focusAfterRun?: string,
  ) => {
    if (readOnly || running || saving || !project.host_id) return;
    setRunning(true);
    setError(undefined);
    setNotice(undefined);
    setKernelStatus("checking notebook");
    const runId = crypto.randomUUID();
    let accepted = false;
    let completed = false;
    let detached = false;
    try {
      const latest = asText(
        (await filesystem.readFile(path, "utf8")) as string | Uint8Array,
      );
      if (latest !== baseContents) {
        throw Object.assign(new Error("Notebook changed on the server."), {
          code: "ETAG_MISMATCH",
        });
      }
      const candidate = normalizeNotebook(notebookCandidate);
      const candidateContents = serializeNotebook(candidate);
      if (dirty || candidateContents !== baseContents) {
        await saveCandidate(candidate);
      } else {
        setNotebook(candidate);
      }

      setKernelStatus("starting project");
      await session.ensureProjectRunning(project.project_id, setKernelStatus);
      const opened = await session.openProjectApi(
        project.project_id,
        project.host_id,
      );
      projectApi.current = opened.api;
      const syncPath = syncdbPath(path);
      setKernelStatus("starting kernel");
      await opened.api.jupyter.start(syncPath);
      recordUltraliteSurfaceReady("kernel");
      await opened.api.jupyter.set({ path: syncPath, ipynb: candidate });
      const client = jupyterClient({
        client: opened.lease.client,
        path: syncPath,
        project_id: project.project_id,
      });
      jupyter.current?.close();
      jupyter.current = client;
      await client.socket.waitUntilReady(30_000);
      setKernelStatus("running");
      directRunId.current = runId;
      const inputs = indexes
        .map((index) => candidate.cells[index])
        .filter((cell) => cell?.cell_type === "code")
        .map((cell) => ({ id: cell.id!, input: cellInput(cell) }));
      const iterator = await client.run(inputs, {
        limit: 200,
        noHalt: true,
        run_id: runId,
      });
      accepted = true;
      for await (const messages of iterator) {
        if (
          messages.some(
            ({ lifecycle, msg_type }) =>
              lifecycle === "run_done" || msg_type === "run_done",
          )
        ) {
          completed = true;
        }
        applyMessages(messages);
      }
      if (!completed) {
        detached = true;
        directRunId.current = undefined;
        setKernelStatus("reconnecting to active execution");
        setNotice(
          "The direct execution connection closed. The kernel is still tracked on the project host; this view is reattaching without running cells again.",
        );
        processLiveRuns.current();
        return;
      }
      completedLiveRunIds.current.add(runId);
      setRunningCell(undefined);
      setKernelStatus("saving outputs");
      await opened.api.jupyter.save({
        expectedCellCount: candidate.cells.length,
        expectedCellIdsInOrder: candidate.cells.map(({ id }) => id!),
        path: syncPath,
      });
      const saved = asText(
        (await filesystem.readFile(path, "utf8")) as string | Uint8Array,
      );
      const savedNotebook = parseNotebook(saved);
      setNotebook(savedNotebook);
      setEditorEpoch((value) => value + 1);
      onSaved?.(savedNotebook, saved);
      setBaseContents(saved);
      setDirty(false);
      setKernelStatus("idle");
      setNotice("Execution finished and notebook outputs were saved.");
      recordUltraliteOutcome("notebook_execute", "notebook_execute");
    } catch (err: any) {
      recordUltraliteFailure("notebook_execute", err);
      if (accepted && !completed && err?.code !== "ETAG_MISMATCH") {
        detached = true;
        directRunId.current = undefined;
        setKernelStatus("reconnecting to active execution");
        setNotice(
          "The execution connection was interrupted. CoCalc is reattaching to the existing run and will not submit it again.",
        );
        processLiveRuns.current();
        return;
      }
      if (err?.code === "ETAG_MISMATCH") {
        setConflict(true);
        recordUltraliteOutcome("notebook_execute", "save_conflict");
      }
      setKernelStatus("failed");
      setError(
        err?.code === "ETAG_MISMATCH"
          ? "This notebook changed on the server. Nothing was executed or overwritten; reload before continuing."
          : err instanceof Error
            ? err.message
            : `${err}`,
      );
    } finally {
      if (directRunId.current === runId) directRunId.current = undefined;
      if (!detached) {
        setRunningCell(undefined);
        setRunning(false);
        focusCell(focusAfterRun);
      }
      jupyter.current?.close();
      jupyter.current = undefined;
    }
  };

  const handleCellShortcut = (
    index: number,
    mode: "advance" | "insert" | "stay",
  ) => {
    let candidate = notebook;
    let focusCellId = notebook.cells[index]?.id;
    if (
      mode === "insert" ||
      (mode === "advance" && !notebook.cells[index + 1])
    ) {
      const inserted = insertNotebookCellBelow(notebook, index);
      candidate = inserted.notebook;
      focusCellId = inserted.cellId;
      setNotebook(candidate);
      setDirty(true);
    } else if (mode === "advance") {
      focusCellId = notebook.cells[index + 1]?.id;
    }

    if (notebook.cells[index]?.cell_type === "code") {
      void runCells([index], candidate, focusCellId);
    } else {
      focusCell(focusCellId);
    }
  };

  const interrupt = async () => {
    if (!projectApi.current) return;
    setKernelStatus("interrupting");
    try {
      await projectApi.current.jupyter.signal({
        path: syncdbPath(path),
        signal: "SIGINT",
      });
      setKernelStatus("interrupted");
    } catch (err) {
      recordUltraliteFailure("notebook_execute", err);
      setError(err instanceof Error ? err.message : `${err}`);
    }
  };

  const codeIndexes = notebook.cells
    .map((cell, index) => (cell.cell_type === "code" ? index : -1))
    .filter((index) => index >= 0);
  const codeLanguage = notebookCodeLanguage(notebook);

  return (
    <div>
      <div className="ul-file-view-header">
        <div className="ul-toolbar">
          <button
            className="ul-button"
            disabled={readOnly || !dirty || saving || running || conflict}
            onClick={() => void save()}
            type="button"
          >
            {saving ? "Saving..." : "Save notebook"}
          </button>
          <button
            className="ul-button ul-button-secondary"
            disabled={readOnly || running || conflict || !codeIndexes.length}
            onClick={() => void runCells(codeIndexes)}
            type="button"
          >
            Run all
          </button>
          {running ? (
            <button
              className="ul-button ul-button-danger"
              onClick={() => void interrupt()}
              type="button"
            >
              Interrupt
            </button>
          ) : null}
        </div>
        <span aria-live="polite" className="ul-editor-status">
          Kernel: {kernelStatus}
          {dirty ? " · unsaved" : ""}
        </span>
      </div>
      <InlineAlert kind="info">
        Editing is manual and focused. Opening this view does not start project
        compute; Run explicitly starts the project and kernel.
      </InlineAlert>
      {readOnly ? (
        <InlineAlert kind="warning">
          This notebook is read-only because you are a project viewer or the
          file exceeds the constrained editing limit.
        </InlineAlert>
      ) : null}
      {notice ? <InlineAlert>{notice}</InlineAlert> : null}
      {error ? <InlineAlert kind="error">{error}</InlineAlert> : null}
      {running ? <LoadingState label={`Kernel ${kernelStatus}`} /> : null}
      <div className="ul-notebook">
        {notebook.cells.map((cell, index) => {
          const cellKey = cell.id ?? `cell-${index}`;
          const shortcuts: CodeMirrorShortcut[] = [
            {
              key: "Shift-Enter",
              run: () => handleCellShortcut(index, "advance"),
            },
            {
              key: "Alt-Enter",
              run: () => handleCellShortcut(index, "insert"),
            },
            {
              key: "Ctrl-Enter",
              run: () => handleCellShortcut(index, "stay"),
            },
          ];
          return (
            <section className="ul-cell" key={`${editorEpoch}:${cellKey}`}>
              <div className="ul-cell-toolbar">
                <span className="ul-cell-label">
                  {cell.cell_type || "code"} cell {index + 1}
                  {runningCell === cell.id ? " · running" : ""}
                </span>
                {cell.cell_type === "code" ? (
                  <button
                    className="ul-icon-button"
                    disabled={readOnly || running || conflict}
                    onClick={() => void runCells([index])}
                    type="button"
                  >
                    Run
                  </button>
                ) : null}
                <button
                  aria-label={`Move cell ${index + 1} up`}
                  className="ul-icon-button"
                  disabled={readOnly || index === 0 || running}
                  onClick={() => {
                    const cells = [...notebook.cells];
                    [cells[index - 1], cells[index]] = [
                      cells[index],
                      cells[index - 1],
                    ];
                    setNotebook({ ...notebook, cells });
                    setDirty(true);
                  }}
                  type="button"
                >
                  Up
                </button>
                <button
                  aria-label={`Move cell ${index + 1} down`}
                  className="ul-icon-button"
                  disabled={
                    readOnly || index === notebook.cells.length - 1 || running
                  }
                  onClick={() => {
                    const cells = [...notebook.cells];
                    [cells[index], cells[index + 1]] = [
                      cells[index + 1],
                      cells[index],
                    ];
                    setNotebook({ ...notebook, cells });
                    setDirty(true);
                  }}
                  type="button"
                >
                  Down
                </button>
                <button
                  aria-label={`Delete cell ${index + 1}`}
                  className="ul-icon-button"
                  disabled={readOnly || running}
                  onClick={() => {
                    if (!window.confirm(`Delete cell ${index + 1}?`)) return;
                    setNotebook({
                      ...notebook,
                      cells: notebook.cells.filter((_, i) => i !== index),
                    });
                    setDirty(true);
                  }}
                  type="button"
                >
                  Delete
                </button>
              </div>
              <NotebookCellEditor
                autoFocus={false}
                cell={cell}
                editorRef={(editor) => {
                  if (editor) cellEditors.current.set(cellKey, editor);
                  else cellEditors.current.delete(cellKey);
                }}
                index={index}
                language={codeLanguage}
                onChange={(source) => updateCell(index, { source })}
                onSave={() => void save()}
                path={path}
                readOnly={readOnly || running}
                shortcuts={shortcuts}
              />
              {cell.outputs?.map((output, outputIndex) => (
                <NotebookOutputView
                  index={outputIndex}
                  key={outputIndex}
                  output={output}
                />
              ))}
            </section>
          );
        })}
      </div>
      {!readOnly ? (
        <div className="ul-toolbar ul-notebook-add">
          {(["code", "markdown", "raw"] as const).map((cellType) => (
            <button
              className="ul-button ul-button-secondary"
              disabled={running}
              key={cellType}
              onClick={() => {
                setNotebook({
                  ...notebook,
                  cells: [
                    ...notebook.cells,
                    {
                      ...newNotebookCell(cellType),
                    },
                  ],
                });
                setDirty(true);
              }}
              type="button"
            >
              Add {cellType} cell
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
