/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  BuildDocumentIdentity,
  DocumentBuildCapabilities,
  DocumentBuildRequest,
  DocumentBuildSnapshot,
} from "@cocalc/app-document-build";
import LRU from "lru-cache";
import { uuid } from "@cocalc/util/misc";

const TERMINAL_STATES = new Set([
  "succeeded",
  "failed",
  "canceled",
  "timed_out",
]);

export type DocumentBuildExecutionResult = Pick<
  DocumentBuildSnapshot,
  "stages" | "diagnostics" | "dependencies" | "artifacts"
> & {
  state: "succeeded" | "failed" | "canceled" | "timed_out";
  exit_code: number;
  error?: string;
};

export interface DocumentBuildExecutionControl {
  signal: AbortSignal;
  update(
    patch: Partial<
      Pick<
        DocumentBuildSnapshot,
        "stages" | "diagnostics" | "dependencies" | "artifacts" | "error"
      >
    >,
  ): void;
  setCancelActive(cancel: (() => Promise<void>) | undefined): void;
}

export interface DocumentBuildManagerOptions {
  capabilities: () => DocumentBuildCapabilities;
  execute: (
    request: DocumentBuildRequest,
    identity: BuildDocumentIdentity,
    control: DocumentBuildExecutionControl,
  ) => Promise<DocumentBuildExecutionResult>;
  resolveIdentity: (path: string) => BuildDocumentIdentity;
  publish?: (snapshot: DocumentBuildSnapshot) => void;
  maxActive?: number;
  maxQueued?: number;
  completedMax?: number;
  completedTtlMs?: number;
  defaultBuildTimeoutMs?: number;
  maximumBuildTimeoutMs?: number;
}

interface ActiveBuild {
  abort: AbortController;
  cancelActive?: () => Promise<void>;
  request: DocumentBuildRequest;
  snapshot: DocumentBuildSnapshot;
  timedOut: boolean;
}

export class DocumentBuildManager {
  private readonly active = new Map<string, ActiveBuild>();
  private readonly completed: LRU<string, DocumentBuildSnapshot>;
  private readonly generations = new Map<string, string>();
  private readonly queue: string[] = [];
  private readonly resources = new Set<string>();
  private running = 0;

  constructor(private readonly options: DocumentBuildManagerOptions) {
    this.completed = new LRU({
      max: options.completedMax ?? 100,
      ttl: options.completedTtlMs ?? 60 * 60_000,
      dispose: (_snapshot, buildId) => {
        for (const [key, mappedBuildId] of this.generations) {
          if (mappedBuildId === buildId) this.generations.delete(key);
        }
      },
    });
  }

  capabilities = (): DocumentBuildCapabilities => this.options.capabilities();

  start = (request: DocumentBuildRequest): DocumentBuildSnapshot => {
    if (request == null || typeof request.path !== "string") {
      throw new Error("document build path must be a string");
    }
    if (
      request.expected_source_hash != null &&
      !Number.isSafeInteger(request.expected_source_hash)
    ) {
      throw new Error("expected_source_hash must be a safe integer");
    }
    if (
      request.generation != null &&
      (typeof request.generation !== "string" ||
        request.generation.length === 0 ||
        request.generation.length > 4096)
    ) {
      throw new Error(
        "generation must be a nonempty string of at most 4096 characters",
      );
    }
    const identity = this.options.resolveIdentity(request.path);
    const build_timeout_ms = this.validateBuildTimeout(
      request.build_timeout_ms,
    );
    const generationKey = this.generationKey(
      identity,
      request,
      build_timeout_ms,
    );
    if (generationKey != null) {
      const existingId = this.generations.get(generationKey);
      if (existingId != null) {
        const active = this.active.get(existingId)?.snapshot;
        if (active != null) return this.clone(active);
        const completed = this.completed.get(existingId);
        if (!request.force && completed != null) return this.clone(completed);
        this.generations.delete(generationKey);
      }
    }
    if (this.queue.length >= (this.options.maxQueued ?? 100)) {
      throw new Error("document build queue is full");
    }

    const build_id = uuid();
    const snapshot: DocumentBuildSnapshot = {
      build_id,
      request_id: request.request_id,
      generation: request.generation,
      identity,
      state: "queued",
      seq: 1,
      submitted_at: Date.now(),
      build_timeout_ms,
      force: request.force === true,
      stages: [],
      diagnostics: [],
      dependencies: [],
      artifacts: [],
    };
    this.active.set(build_id, {
      abort: new AbortController(),
      request: {
        ...request,
        path: identity.logical_path,
        build_id,
        submitted_at: snapshot.submitted_at,
        build_timeout_ms,
      },
      snapshot,
      timedOut: false,
    });
    if (generationKey != null) this.generations.set(generationKey, build_id);
    this.queue.push(build_id);
    this.publish(snapshot);
    this.pump();
    return this.clone(snapshot);
  };

  get = (build_id: string): DocumentBuildSnapshot => {
    const snapshot = this.find(build_id);
    if (snapshot == null) {
      throw new Error(`document build '${build_id}' does not exist`);
    }
    return this.clone(snapshot);
  };

  getActive = (query: { path?: string } = {}): DocumentBuildSnapshot[] => {
    let queryIdentity: BuildDocumentIdentity | undefined;
    if (query.path != null) {
      queryIdentity = this.options.resolveIdentity(query.path);
    }
    return [...this.active.values()]
      .map(({ snapshot }) => snapshot)
      .filter(
        (snapshot) =>
          !TERMINAL_STATES.has(snapshot.state) &&
          (queryIdentity == null ||
            snapshot.identity.logical_path === queryIdentity.logical_path ||
            snapshot.identity.working_path === queryIdentity.logical_path ||
            snapshot.identity.resource_key === queryIdentity.resource_key),
      )
      .sort((a, b) => a.submitted_at - b.submitted_at)
      .map((snapshot) => this.clone(snapshot));
  };

  getRecent = (
    query: { path?: string; limit?: number } = {},
  ): DocumentBuildSnapshot[] => {
    const limit = query.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
      throw new Error("document build recent limit must be between 1 and 100");
    }
    let queryIdentity: BuildDocumentIdentity | undefined;
    if (query.path != null) {
      queryIdentity = this.options.resolveIdentity(query.path);
    }
    return [...this.completed.values()]
      .filter(
        (snapshot) =>
          queryIdentity == null ||
          snapshot.identity.logical_path === queryIdentity.logical_path ||
          snapshot.identity.working_path === queryIdentity.logical_path ||
          snapshot.identity.resource_key === queryIdentity.resource_key,
      )
      .sort((a, b) => b.submitted_at - a.submitted_at)
      .slice(0, limit)
      .map((snapshot) => this.clone(snapshot));
  };

  cancel = async (build_id: string): Promise<DocumentBuildSnapshot> => {
    const build = this.active.get(build_id);
    if (build == null) {
      const completed = this.completed.get(build_id);
      if (completed == null) {
        throw new Error(`document build '${build_id}' does not exist`);
      }
      return this.clone(completed);
    }
    if (TERMINAL_STATES.has(build.snapshot.state)) {
      return this.clone(build.snapshot);
    }
    build.abort.abort();
    if (build.snapshot.state === "queued") {
      const i = this.queue.indexOf(build_id);
      if (i >= 0) this.queue.splice(i, 1);
      this.finish(build, { state: "canceled", exit_code: 130 });
      this.pump();
      return this.get(build_id);
    }
    try {
      await build.cancelActive?.().catch(() => undefined);
    } finally {
      this.finish(build, {
        state: "canceled",
        exit_code: 130,
        stages: this.terminalStages(build.snapshot, "canceled", 130),
      });
    }
    return this.get(build_id);
  };

  private validateBuildTimeout(value: number | undefined): number {
    const timeout = value ?? this.options.defaultBuildTimeoutMs ?? 15 * 60_000;
    if (!Number.isSafeInteger(timeout) || timeout <= 0) {
      throw new Error("build_timeout_ms must be a positive integer");
    }
    const maximum = this.options.maximumBuildTimeoutMs ?? 24 * 60 * 60_000;
    if (timeout > maximum) {
      throw new Error(`build_timeout_ms must not exceed ${maximum}`);
    }
    return timeout;
  }

  private generationKey(
    identity: BuildDocumentIdentity,
    request: DocumentBuildRequest,
    buildTimeoutMs: number,
  ): string | undefined {
    if (request.generation == null) return;
    return JSON.stringify([
      identity.kind,
      identity.logical_path,
      request.generation,
      request.expected_source_hash ?? null,
      request.output_directory === undefined
        ? { mode: "default" }
        : { mode: "explicit", value: request.output_directory },
      buildTimeoutMs,
      request.force === true,
    ]);
  }

  private pump(): void {
    const maxActive = this.options.maxActive ?? 2;
    while (this.running < maxActive) {
      const index = this.queue.findIndex((build_id) => {
        const build = this.active.get(build_id);
        return (
          build != null &&
          !this.resources.has(build.snapshot.identity.resource_key)
        );
      });
      if (index < 0) return;
      const [build_id] = this.queue.splice(index, 1);
      const build = this.active.get(build_id);
      if (build == null) continue;
      this.running += 1;
      this.resources.add(build.snapshot.identity.resource_key);
      void this.run(build).finally(() => {
        this.running -= 1;
        this.resources.delete(build.snapshot.identity.resource_key);
        this.pump();
      });
    }
  }

  private async run(build: ActiveBuild): Promise<void> {
    const started_at = Date.now();
    this.update(build, {
      state: "running",
      started_at,
      deadline_at: started_at + build.snapshot.build_timeout_ms,
    });
    const timer = setTimeout(() => {
      build.timedOut = true;
      build.abort.abort();
      void build.cancelActive?.().catch(() => {});
      this.finish(build, {
        state: "timed_out",
        exit_code: 124,
        stages: this.terminalStages(build.snapshot, "timed_out", 124),
      });
    }, build.snapshot.build_timeout_ms);
    try {
      const result = await this.options.execute(
        build.request,
        build.snapshot.identity,
        {
          signal: build.abort.signal,
          update: (patch) => this.update(build, patch),
          setCancelActive: (cancel) => {
            build.cancelActive = cancel;
          },
        },
      );
      if (build.timedOut) {
        this.finish(build, { ...result, state: "timed_out", exit_code: 124 });
      } else if (build.abort.signal.aborted) {
        this.finish(build, { ...result, state: "canceled", exit_code: 130 });
      } else {
        this.finish(build, result);
      }
    } catch (err) {
      const state = build.timedOut
        ? "timed_out"
        : build.abort.signal.aborted
          ? "canceled"
          : "failed";
      this.finish(build, {
        state,
        exit_code: state === "timed_out" ? 124 : state === "canceled" ? 130 : 1,
        error: `${err}`,
      });
    } finally {
      clearTimeout(timer);
      build.cancelActive = undefined;
    }
  }

  private update(
    build: ActiveBuild,
    patch: Partial<DocumentBuildSnapshot>,
  ): void {
    if (TERMINAL_STATES.has(build.snapshot.state)) return;
    build.snapshot = {
      ...build.snapshot,
      ...patch,
      build_id: build.snapshot.build_id,
      identity: build.snapshot.identity,
      seq: build.snapshot.seq + 1,
    };
    this.active.set(build.snapshot.build_id, build);
    this.publish(build.snapshot);
  }

  private finish(
    build: ActiveBuild,
    patch: Partial<DocumentBuildSnapshot> & {
      state: "succeeded" | "failed" | "canceled" | "timed_out";
      exit_code: number;
    },
  ): void {
    if (TERMINAL_STATES.has(build.snapshot.state)) return;
    this.update(build, { ...patch, ended_at: Date.now() });
    const snapshot = build.snapshot;
    this.active.delete(snapshot.build_id);
    this.completed.set(snapshot.build_id, snapshot);
  }

  private find(build_id: string): DocumentBuildSnapshot | undefined {
    return this.active.get(build_id)?.snapshot ?? this.completed.get(build_id);
  }

  private terminalStages(
    snapshot: DocumentBuildSnapshot,
    state: "canceled" | "timed_out",
    exit_code: number,
  ): DocumentBuildSnapshot["stages"] {
    const now = Date.now();
    return snapshot.stages.map((stage) =>
      stage.state === "running"
        ? { ...stage, state, exit_code, ended_at: now }
        : stage,
    );
  }

  private publish(snapshot: DocumentBuildSnapshot): void {
    this.options.publish?.(this.clone(snapshot));
  }

  private clone(snapshot: DocumentBuildSnapshot): DocumentBuildSnapshot {
    return structuredClone(snapshot);
  }
}
