/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  BuildStageEvent,
  BuildStageResult,
  BuildStageSpec,
  DocumentBuildRuntime,
  SavedBuildConfig,
} from "@cocalc/app-document-build";
import { cancelAsyncJob, executeCode } from "@cocalc/backend/execute-code";
import { from_str } from "@cocalc/sync/editor/db/doc";
import { aux_file } from "@cocalc/util/misc";
import type {
  ExecuteCodeOutputAsync,
  ExecuteCodeAggregate,
  ExecuteCodeStats,
  ExecuteCodeStreamEvent,
} from "@cocalc/util/types/execute-code";
import { createHash } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  open,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { documentProcessPath } from "./paths";

const MAX_STAGE_OUTPUT = 512 * 1024;
const STREAM_UPDATE_INTERVAL_MS = 250;
const TRUNCATED_OUTPUT_MARKER = "\n... document build output truncated ...\n";

function appendBounded(current: string, chunk: string): string {
  const next = `${current}${chunk}`;
  if (next.length <= MAX_STAGE_OUTPUT) return next;
  const available = MAX_STAGE_OUTPUT - TRUNCATED_OUTPUT_MARKER.length;
  const head = Math.floor(available / 2);
  const tail = available - head;
  return `${next.slice(0, head)}${TRUNCATED_OUTPUT_MARKER}${next.slice(-tail)}`;
}

export function documentBuildStageJobKey(stage: BuildStageSpec): string {
  return `${stage.job_key}:${stage.stage_id}`;
}

export function documentBuildStageAggregate(
  stage: BuildStageSpec,
): ExecuteCodeAggregate | undefined {
  return stage.aggregate_key == null
    ? undefined
    : { value: stage.aggregate_key };
}

export class ProjectDocumentBuildRuntime implements DocumentBuildRuntime {
  constructor(
    private readonly options: {
      build_id: string;
      signal: AbortSignal;
      setCancelActive: (cancel: (() => Promise<void>) | undefined) => void;
      env?: Readonly<Record<string, string | undefined>>;
    },
  ) {}

  private processPath(projectPath: string): string {
    return documentProcessPath(projectPath, this.options.env);
  }

  private async openRegularFile(
    projectPath: string,
    processPath = this.processPath(projectPath),
  ): Promise<FileHandle> {
    this.options.signal.throwIfAborted();
    const handle = await open(
      processPath,
      constants.O_RDONLY | constants.O_NONBLOCK,
    );
    try {
      const info = await handle.stat();
      this.options.signal.throwIfAborted();
      if (!info.isFile()) {
        throw new Error(
          `document build input is not a regular file: ${projectPath}`,
        );
      }
      return handle;
    } catch (err) {
      await handle.close().catch(() => undefined);
      throw err;
    }
  }

  private async readRegularText(projectPath: string): Promise<string> {
    const handle = await this.openRegularFile(projectPath);
    try {
      return await handle.readFile({
        encoding: "utf8",
        signal: this.options.signal,
      });
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  readText = async (projectPath: string): Promise<string> => {
    return await this.readRegularText(projectPath);
  };

  readBuildConfig = async (
    projectPath: string,
  ): Promise<SavedBuildConfig | undefined> => {
    const configPath = aux_file(projectPath, "syncdb");
    let content: string;
    try {
      content = await this.readRegularText(configPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    try {
      for (const line of content.split("\n")) {
        if (line.trim()) JSON.parse(line);
      }
      const document = from_str(content, ["key"]);
      const row = document.get_one({ key: "build_command" });
      let value = row?.get?.("value") ?? row?.value;
      if (typeof value?.toJS === "function") value = value.toJS();
      if (value == null) return;
      if (
        typeof value !== "string" &&
        !(
          Array.isArray(value) &&
          value.every((entry) => typeof entry === "string")
        )
      ) {
        throw new Error("build_command must be a string or string array");
      }
      return { build_command: value };
    } catch (err) {
      throw new Error(`invalid saved LaTeX build configuration: ${err}`);
    }
  };

  exists = async (projectPath: string): Promise<boolean> => {
    this.options.signal.throwIfAborted();
    try {
      await access(this.processPath(projectPath));
      this.options.signal.throwIfAborted();
      return true;
    } catch {
      this.options.signal.throwIfAborted();
      return false;
    }
  };

  hash = async (projectPath: string): Promise<string> => {
    const hash = createHash("sha256");
    const handle = await this.openRegularFile(projectPath);
    try {
      const stream = handle.createReadStream({
        autoClose: false,
        signal: this.options.signal,
      });
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("error", reject);
        stream.on("end", resolve);
      });
    } finally {
      await handle.close().catch(() => undefined);
    }
    return hash.digest("hex");
  };

  copy = async (source: string, destination: string): Promise<void> => {
    this.options.signal.throwIfAborted();
    const target = this.processPath(destination);
    const normalizedSource = path.resolve(source);
    const sourceIsTmp =
      normalizedSource === "/tmp" || normalizedSource.startsWith("/tmp/");
    const sourceHandle = await this.openRegularFile(
      source,
      sourceIsTmp ? normalizedSource : this.processPath(source),
    );
    await mkdir(path.dirname(target), { recursive: true });
    const temporaryTarget = `${target}.document-build-${this.options.build_id}.tmp`;
    try {
      await pipeline(
        sourceHandle.createReadStream({ autoClose: false }),
        createWriteStream(temporaryTarget),
        { signal: this.options.signal },
      );
      await rename(temporaryTarget, target);
    } catch (err) {
      await unlink(temporaryTarget).catch(() => undefined);
      throw err;
    } finally {
      await sourceHandle.close().catch(() => undefined);
    }
  };

  execute = async (
    stage: BuildStageSpec,
    onEvent: (event: BuildStageEvent) => void,
  ): Promise<BuildStageResult> => {
    const started_at = Date.now();
    let current: BuildStageResult = {
      ...stage,
      state: "running",
      started_at,
      stdout: "",
      stderr: "",
    };
    if (this.options.signal.aborted) {
      return {
        ...current,
        state: "canceled",
        ended_at: Date.now(),
        exit_code: 130,
        stderr: "Document build was canceled.",
      };
    }
    let streamUpdateTimer: ReturnType<typeof setTimeout> | undefined;
    let lastStreamUpdateAt = 0;
    const emitCurrent = (): void => {
      lastStreamUpdateAt = Date.now();
      onEvent({ type: "updated", stage: structuredClone(current) });
    };
    const update = (patch: Partial<BuildStageResult>): void => {
      current = { ...current, ...patch };
      emitCurrent();
    };
    const updateStream = (patch: Partial<BuildStageResult>): void => {
      current = { ...current, ...patch };
      if (streamUpdateTimer != null) return;
      const delay = Math.max(
        0,
        STREAM_UPDATE_INTERVAL_MS - (Date.now() - lastStreamUpdateAt),
      );
      streamUpdateTimer = setTimeout(() => {
        streamUpdateTimer = undefined;
        emitCurrent();
      }, delay);
    };
    const streamCB = (event: ExecuteCodeStreamEvent): void => {
      if (event.type === "stdout" && typeof event.data === "string") {
        updateStream({ stdout: appendBounded(current.stdout, event.data) });
      } else if (event.type === "stderr" && typeof event.data === "string") {
        updateStream({ stderr: appendBounded(current.stderr, event.data) });
      } else if (
        event.type === "stats" &&
        event.data != null &&
        typeof event.data === "object" &&
        !Array.isArray(event.data)
      ) {
        updateStream({
          stats: [
            ...(current.stats ?? []),
            event.data as ExecuteCodeStats[number],
          ].slice(-100),
        });
      }
    };

    let started: ExecuteCodeOutputAsync;
    let abort: (() => void) | undefined;
    try {
      const output = await executeCode({
        command: stage.command,
        args: stage.args,
        bash: stage.bash,
        path: stage.cwd,
        env: stage.env,
        timeout: stage.timeout_s,
        err_on_exit: false,
        max_output: MAX_STAGE_OUTPUT,
        async_call: true,
        job_group: `document-build:${this.options.build_id}`,
        // A pipeline may run the same logical tool several times. Aggregation
        // is valid per stage instance, never across the LaTeX reruns that
        // follow SageTeX or PythonTeX.
        job_key: documentBuildStageJobKey(stage),
        // Document generations and source hashes are opaque identities, not
        // ordered revisions. Object aggregates require an exact match.
        aggregate: documentBuildStageAggregate(stage),
        streamCB,
      });
      if (output.type !== "async") {
        throw new Error("document build stage did not start asynchronously");
      }
      started = output;
      update({ job_id: started.job_id });
      let cancelPromise: Promise<void> | undefined;
      const cancel = async (): Promise<void> => {
        cancelPromise ??= cancelAsyncJob(started.job_id).then(() => undefined);
        await cancelPromise;
      };
      this.options.setCancelActive(cancel);
      abort = () => void cancel().catch(() => {});
      this.options.signal.addEventListener("abort", abort, { once: true });
      if (this.options.signal.aborted) await cancel();
      const finished = await executeCode({
        async_get: started.job_id,
        async_await: true,
        async_stats: true,
      });
      if (finished.type !== "async") {
        throw new Error("document build stage returned an invalid result");
      }
      const state =
        finished.status === "killed"
          ? "canceled"
          : finished.exit_code === 0
            ? "succeeded"
            : finished.exit_code === 124
              ? "timed_out"
              : "failed";
      current = {
        ...current,
        state,
        ended_at: Date.now(),
        exit_code: finished.exit_code,
        stdout: appendBounded("", finished.stdout ?? current.stdout),
        stderr: appendBounded("", finished.stderr ?? current.stderr),
        stats: finished.stats?.slice(-100),
        job_id: finished.job_id,
      };
      return current;
    } catch (err) {
      const canceled = this.options.signal.aborted;
      return {
        ...current,
        state: canceled ? "canceled" : "failed",
        ended_at: Date.now(),
        exit_code: canceled ? 130 : 1,
        error: `${err}`,
        stderr: current.stderr || `${err}`,
      };
    } finally {
      if (streamUpdateTimer != null) clearTimeout(streamUpdateTimer);
      if (abort != null) {
        this.options.signal.removeEventListener("abort", abort);
      }
      this.options.setCancelActive(undefined);
    }
  };
}
