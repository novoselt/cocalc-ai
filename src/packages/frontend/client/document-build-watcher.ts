/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { DocumentBuildSnapshot } from "@cocalc/app-document-build";
import type {
  Client as ConatClient,
  Subscription,
} from "@cocalc/conat/core/client";
import { documentBuildEventsSubject } from "@cocalc/conat/project/document-build";
import type { ProjectApi } from "@cocalc/conat/project/api";
import { Set as ImmutableSet } from "immutable";
import { EventEmitter } from "events";

export type DocumentBuildApi = ProjectApi["documentBuild"];

export function documentBuildApi(projectApi: ProjectApi): DocumentBuildApi {
  return projectApi.documentBuild;
}

const DOCUMENT_BUILD_SERVICE_UNAVAILABLE =
  /(?:no responders|unknown (?:service|method)|documentBuild is not a function|document-build[^\n]*(?:not found|unavailable)|request timed out|Cannot convert undefined or null to object)/i;

export function formatDocumentBuildError(err: unknown): string {
  const message = `${err}`;
  if (!DOCUMENT_BUILD_SERVICE_UNAVAILABLE.test(message)) return message;
  return (
    "This project must be restarted before document builds can run. " +
    "Restart the project, then try again.\n\n" +
    message
  );
}

export function isDocumentBuildActive(
  snapshot: DocumentBuildSnapshot,
): boolean {
  return snapshot.state === "queued" || snapshot.state === "running";
}

function comparablePath(path: string): string {
  return path.replace(/^\/home\/user\/?/, "").replace(/^\.\//, "");
}

function snapshotFromEvent(value: unknown): DocumentBuildSnapshot | undefined {
  const event = value as
    | DocumentBuildSnapshot
    | { snapshot?: DocumentBuildSnapshot }
    | undefined;
  const snapshot =
    event != null && "snapshot" in event
      ? event.snapshot
      : (event as DocumentBuildSnapshot | undefined);
  if (
    typeof snapshot?.build_id !== "string" ||
    typeof snapshot?.seq !== "number" ||
    typeof snapshot?.identity?.logical_path !== "string"
  ) {
    return undefined;
  }
  return snapshot;
}

function missingBuildError(err: unknown): boolean {
  return /(?:does not exist|not found)/i.test(`${err}`);
}

function aggregateStageOutput(
  snapshot: DocumentBuildSnapshot,
  field: "stdout" | "stderr",
): string {
  return snapshot.stages
    .map((stage) => stage[field]?.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function documentBuildSnapshotToEditorState(
  snapshot: DocumentBuildSnapshot,
): Record<string, unknown> {
  const building = isDocumentBuildActive(snapshot);
  const stdout = aggregateStageOutput(snapshot, "stdout");
  const diagnosticErrors = snapshot.diagnostics
    .filter(({ level }) => level === "error")
    .map(({ message }) => message);
  const stageStderr = aggregateStageOutput(snapshot, "stderr");
  const stderr = [
    stageStderr,
    snapshot.error,
    ...diagnosticErrors.filter((message) => !stageStderr.includes(message)),
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
  const stage =
    snapshot.stages.find(({ state }) => state === "running") ??
    snapshot.stages.at(-1);
  const stats = snapshot.stages.flatMap(({ stats }) => stats ?? []);
  const failed =
    snapshot.state === "failed" ||
    snapshot.state === "canceled" ||
    snapshot.state === "timed_out";
  const state: Record<string, unknown> = {
    building,
    build_err: stderr,
    build_exit: snapshot.exit_code ?? (failed ? 1 : 0),
    build_log: stdout,
    job_info: {
      type: "async",
      job_id: snapshot.build_id,
      status: building
        ? "running"
        : snapshot.state === "canceled"
          ? "killed"
          : "completed",
      start: snapshot.started_at ?? snapshot.submitted_at,
      stdout,
      stderr,
      exit_code: snapshot.exit_code ?? (failed ? 1 : 0),
      stats,
    },
  };
  if (stage != null) {
    state.build_command = {
      command: stage.command,
      args: stage.args ?? [],
    };
  }
  if (!building && snapshot.artifacts.length > 0) {
    state.derived_file_types = ImmutableSet(
      snapshot.artifacts.map(({ type }) =>
        type === "notebook-html" ? "nb.html" : type,
      ),
    );
  }
  return state;
}

export class DocumentBuildWatcher extends EventEmitter {
  private readonly activeBuilds = new Map<string, DocumentBuildSnapshot>();
  private client?: ConatClient;
  private closed = false;
  private readonly lastSeq = new Map<string, number>();
  private pollInProgress = false;
  private pollTimer?: ReturnType<typeof setInterval>;
  private subscription?: Subscription;

  constructor(
    private readonly options: {
      getApi: () => DocumentBuildApi;
      getClient: () => Promise<ConatClient>;
      path: string;
      poll_ms?: number;
      project_id: string;
    },
  ) {
    super();
    void this.start();
  }

  close = (): void => {
    if (this.closed) return;
    this.closed = true;
    this.client?.off("connected", this.refresh);
    this.subscription?.close();
    if (this.pollTimer != null) clearInterval(this.pollTimer);
    this.removeAllListeners();
  };

  track = (snapshot: DocumentBuildSnapshot): void => {
    this.processSnapshot(snapshot);
  };

  hasActiveBuilds = (): boolean => this.activeBuilds.size > 0;

  latestActiveBuildSnapshot = (): DocumentBuildSnapshot | undefined =>
    [...this.activeBuilds.values()].sort((a, b) => {
      const stateOrder = (snapshot: DocumentBuildSnapshot) =>
        snapshot.state === "running" ? 1 : 0;
      return (
        stateOrder(b) - stateOrder(a) ||
        b.submitted_at - a.submitted_at ||
        b.seq - a.seq
      );
    })[0];

  latestActiveBuildId = (): string | undefined =>
    this.latestActiveBuildSnapshot()?.build_id;

  private start = async (): Promise<void> => {
    try {
      const client = await this.options.getClient();
      if (this.closed) return;
      this.client = client;
      this.subscription = await client.subscribe(
        documentBuildEventsSubject(this.options),
      );
      if (this.closed) {
        this.subscription.close();
        return;
      }
      client.on("connected", this.refresh);
      void this.consume(this.subscription);
      await this.refresh();
    } catch (err) {
      this.emitWatchError(err);
    }
  };

  private consume = async (subscription: Subscription): Promise<void> => {
    try {
      for await (const message of subscription) {
        if (this.closed) return;
        const snapshot = snapshotFromEvent(message.data);
        if (snapshot == null || !this.matches(snapshot)) continue;
        const previous = this.lastSeq.get(snapshot.build_id);
        if (previous != null && snapshot.seq > previous + 1) {
          await this.refreshBuild(snapshot.build_id);
        } else {
          this.processSnapshot(snapshot);
        }
      }
    } catch (err) {
      this.emitWatchError(err);
    }
  };

  private matches(snapshot: DocumentBuildSnapshot): boolean {
    return (
      comparablePath(snapshot.identity.logical_path) ===
      comparablePath(this.options.path)
    );
  }

  private processSnapshot(snapshot: DocumentBuildSnapshot): void {
    if (!this.matches(snapshot)) return;
    if (snapshot.seq <= (this.lastSeq.get(snapshot.build_id) ?? -1)) return;
    this.lastSeq.set(snapshot.build_id, snapshot.seq);
    if (isDocumentBuildActive(snapshot)) {
      this.activeBuilds.set(snapshot.build_id, snapshot);
    } else {
      this.activeBuilds.delete(snapshot.build_id);
    }
    this.updatePolling();
    this.emit("active-change", this.latestActiveBuildSnapshot());
    this.emit("snapshot", snapshot);
  }

  private updatePolling(): void {
    if (this.closed || this.activeBuilds.size === 0) {
      if (this.pollTimer != null) {
        clearInterval(this.pollTimer);
        this.pollTimer = undefined;
      }
      return;
    }
    if (this.pollTimer != null) return;
    this.pollTimer = setInterval(
      () => void this.refreshKnownActive(),
      this.options.poll_ms ?? 1_000,
    );
  }

  private refreshKnownActive = async (): Promise<void> => {
    if (this.closed || this.pollInProgress) return;
    this.pollInProgress = true;
    try {
      await Promise.all(
        [...this.activeBuilds.keys()].map(async (build_id) => {
          await this.refreshBuild(build_id);
        }),
      );
    } finally {
      this.pollInProgress = false;
    }
  };

  private refreshBuild = async (build_id: string): Promise<void> => {
    try {
      this.processSnapshot(await this.options.getApi().get(build_id));
    } catch (err) {
      if (missingBuildError(err)) {
        this.activeBuilds.delete(build_id);
        this.updatePolling();
        this.emit("active-change", this.latestActiveBuildSnapshot());
        return;
      }
      this.emitWatchError(err);
    }
  };

  private refreshActive = async (): Promise<void> => {
    if (this.closed) return;
    try {
      const snapshots = await this.options.getApi().getActive({
        path: this.options.path,
      });
      for (const snapshot of snapshots) this.processSnapshot(snapshot);
    } catch (err) {
      this.emitWatchError(err);
    }
  };

  private refreshRecent = async (): Promise<void> => {
    if (this.closed) return;
    try {
      const snapshots = await this.options.getApi().getRecent({
        path: this.options.path,
        limit: 100,
      });
      const matching = snapshots.filter((snapshot) => this.matches(snapshot));
      const newest = matching[0];
      const latestSuccess = matching.find(({ state }) => state === "succeeded");
      const selected = [latestSuccess, newest]
        .filter(
          (snapshot, index, values): snapshot is DocumentBuildSnapshot =>
            snapshot != null &&
            values.findIndex(
              (candidate) => candidate?.build_id === snapshot.build_id,
            ) === index,
        )
        .sort((a, b) => a.submitted_at - b.submitted_at);
      for (const snapshot of selected) this.processSnapshot(snapshot);
    } catch (err) {
      this.emitWatchError(err);
    }
  };

  private refresh = async (): Promise<void> => {
    if (this.closed) return;
    // getActive cannot report a build that became terminal while disconnected.
    // Repair known active IDs first, then discover builds started by other clients.
    await this.refreshKnownActive();
    await this.refreshActive();
    await this.refreshRecent();
  };

  private emitWatchError(err: unknown): void {
    if (!this.closed) this.emit("watch-error", err);
  }
}
