/*
 * Backend exec-stream functionality for streaming code execution.
 * Core streaming logic that can be used by different services.
 */

import { unreachable } from "@cocalc/util/misc";
import type {
  ExecuteCodeOutput,
  ExecuteCodeOutputAsync,
  ExecuteCodeOptions,
  ExecuteCodeStats,
  ExecuteCodeStreamEvent,
} from "@cocalc/util/types/execute-code";
import { attachToAsyncJob, executeCode } from "./execute-code";
import getLogger from "./logger";
import { abspath } from "./misc_node";

export type StreamEvent = {
  type?: "job" | ExecuteCodeStreamEvent["type"];
  data?: ExecuteCodeStreamEvent["data"];
  error?: string;
};

const logger = getLogger("backend:exec-stream");

const MONITOR_STATS_LENGTH_MAX = 100; // Max stats entries

function truncStats(stats: ExecuteCodeStats): ExecuteCodeStats {
  return stats.slice(stats.length - MONITOR_STATS_LENGTH_MAX);
}

export interface ExecuteStreamOptions {
  command?: string;
  args?: string[];
  path?: string;
  bash?: boolean;
  env?: { [key: string]: string };
  timeout?: number;
  max_output?: number;
  aggregate?: ExecuteCodeOptions["aggregate"];
  job_key?: string;
  verbose?: boolean;
  project_id?: string;
  debug?: string;
  stream: (event: StreamEvent | null) => void;
  waitForCompletion?: boolean;
}

export async function executeStream(
  options: ExecuteStreamOptions,
): Promise<ExecuteCodeOutput | undefined> {
  const { stream, debug, project_id, waitForCompletion, ...opts } = options;

  // Log debug message for debugging purposes
  if (debug) {
    logger.debug(`executeStream: ${debug}`);
  }

  let job: ExecuteCodeOutput | undefined;

  try {
    let done = false;
    let stats: ExecuteCodeStats = [];

    let unsubscribe = () => {};
    const streamCB = (event: ExecuteCodeStreamEvent) => {
      if (done) {
        logger.debug(
          `executeStream: ignoring event type=${event.type} because stream is done`,
        );
        return;
      }

      logger.debug(`executeStream: received event type=${event.type}`);

      switch (event.type) {
        case "stdout":
          stream({
            type: "stdout",
            data: event.data,
          });
          break;

        case "stderr":
          stream({
            type: "stderr",
            data: event.data,
          });
          break;

        case "stats":
          // Stats are accumulated in the stats array for the final result
          if (
            event.data &&
            typeof event.data === "object" &&
            "timestamp" in event.data
          ) {
            stats.push(event.data as ExecuteCodeStats[0]);
            // Keep stats array bounded
            if (stats.length > MONITOR_STATS_LENGTH_MAX) {
              stats.splice(0, stats.length - MONITOR_STATS_LENGTH_MAX);
            }
            stream({
              type: "stats",
              data: event.data,
            });
          }
          break;

        case "done":
          logger.debug(`executeStream: processing done event`);
          const result: ExecuteCodeOutputAsync = {
            ...(event.data as ExecuteCodeOutputAsync),
            // Do not mutate the shared event/cache object for other subscribers.
            stats: truncStats(stats),
          };
          stream({
            type: "done",
            data: result,
          });
          done = true;
          unsubscribe();
          stream(null); // End the stream
          break;

        case "error":
          logger.debug(`executeStream: processing error event`);
          stream({ error: event.data as string });
          done = true;
          unsubscribe();
          stream(null);
          break;

        default:
          unreachable(event.type);
      }
    };

    // Atomically start or join the authoritative async job.
    job = await executeCode({
      command: opts.command || "",
      path: abspath(opts.path ?? ""),
      ...opts,
      async_call: true, // Force async mode for streaming
    });

    if (job?.type !== "async") {
      stream({ error: "Failed to create async job for streaming" });
      stream(null);
      return undefined;
    }

    // Subscribe before taking the snapshot, so output cannot fall into a gap
    // between replay and live delivery.
    const attached = attachToAsyncJob(job.job_id, streamCB);
    unsubscribe = attached.unsubscribe;
    const initialJobInfo = attached.output;
    stats = [...(initialJobInfo.stats ?? [])];

    stream({
      type: "job",
      data: initialJobInfo,
    });

    // If job already completed, send done event immediately
    if (initialJobInfo.status !== "running") {
      logger.debug(
        `executeStream: job ${job.job_id} already finished, sending done event`,
      );
      stream({
        type: "done",
        data: initialJobInfo,
      });
      done = true;
      stream(null);
      return initialJobInfo;
    }

    // Stats monitoring is now handled by execute-code.ts via streamCB
  } catch (err) {
    stream({ error: `${err}` });
    stream(null); // End the stream
    return undefined;
  }

  // Return the job object so caller can wait for completion if desired
  return job;
}
