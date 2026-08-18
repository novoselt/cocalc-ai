/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  Client as ConatClient,
  Subscription,
} from "@cocalc/conat/core/client";
import {
  execJobEventsSubject,
  execJobSnapshotSubject,
} from "@cocalc/conat/project/exec-jobs";
import type {
  ExecuteCodeJobGroupEvent,
  ExecuteCodeJobGroupSnapshot,
  ExecuteCodeOutputAsync,
} from "@cocalc/util/types/execute-code";
import { EventEmitter } from "events";
import LRU from "lru-cache";

export class ExecJobGroupWatcher extends EventEmitter {
  private announcedJobs = new LRU<string, true>({ max: 1000 });
  private client?: ConatClient;
  private closed = false;
  private lastSeq = new LRU<string, number>({ max: 1000 });
  private subscription?: Subscription;

  constructor(
    private readonly options: {
      getClient: () => Promise<ConatClient>;
      job_group: string;
      project_id: string;
    },
  ) {
    super();
    void this.start();
  }

  close = (): void => {
    if (this.closed) return;
    this.closed = true;
    this.client?.off("connected", this.refreshSnapshot);
    this.subscription?.close();
    this.removeAllListeners();
  };

  private start = async (): Promise<void> => {
    try {
      const client = await this.options.getClient();
      if (this.closed) return;
      this.client = client;
      this.subscription = await client.subscribe(
        execJobEventsSubject(this.options),
      );
      if (this.closed) {
        this.subscription.close();
        return;
      }
      client.on("connected", this.refreshSnapshot);
      void this.consume(this.subscription);
      await this.refreshSnapshot();
    } catch (err) {
      if (!this.closed) this.emit("watch-error", err);
    }
  };

  private consume = async (subscription: Subscription): Promise<void> => {
    try {
      for await (const mesg of subscription) {
        if (this.closed) return;
        this.processEvent(mesg.data);
      }
    } catch (err) {
      if (!this.closed) this.emit("watch-error", err);
    }
  };

  private refreshSnapshot = async (): Promise<void> => {
    const client = this.client;
    if (this.closed || client == null) return;
    try {
      const response = await client.request(
        execJobSnapshotSubject(this.options),
        { job_group: this.options.job_group },
        { timeout: 2000 },
      );
      if (this.closed || response.data?.error) return;
      const snapshots = response.data?.snapshots;
      if (!Array.isArray(snapshots)) return;
      for (const snapshot of snapshots) this.processSnapshot(snapshot);
    } catch {
      // Older project runtimes do not provide this optional service.
    }
  };

  private processSnapshot(snapshot: ExecuteCodeJobGroupSnapshot): void {
    const { output, seq } = snapshot ?? ({} as ExecuteCodeJobGroupSnapshot);
    if (
      output?.type !== "async" ||
      output.job_group !== this.options.job_group ||
      typeof output.job_id !== "string" ||
      typeof seq !== "number"
    ) {
      return;
    }
    const previous = this.lastSeq.get(output.job_id) ?? -1;
    if (seq > previous) this.lastSeq.set(output.job_id, seq);
    if (this.announcedJobs.has(output.job_id)) return;
    this.announceJob(output, seq);
  }

  private processEvent(event: ExecuteCodeJobGroupEvent): void {
    if (
      event?.job_group !== this.options.job_group ||
      typeof event.job_id !== "string" ||
      typeof event.seq !== "number" ||
      event.seq <= (this.lastSeq.get(event.job_id) ?? -1)
    ) {
      return;
    }
    this.lastSeq.set(event.job_id, event.seq);
    this.emit("change", event);
    if (event.type === "job") {
      const output = event.data as ExecuteCodeOutputAsync;
      if (output?.type === "async" && !this.announcedJobs.has(event.job_id)) {
        this.announceJob(output, event.seq, false);
      }
    }
  }

  private announceJob(
    output: ExecuteCodeOutputAsync,
    seq: number,
    emitChange = true,
  ): void {
    this.announcedJobs.set(output.job_id, true);
    if (emitChange) {
      this.emit("change", {
        aggregate: output.aggregate,
        data: output,
        job_group: this.options.job_group,
        job_id: output.job_id,
        job_key: output.job_key,
        seq,
        type: "job",
      } satisfies ExecuteCodeJobGroupEvent);
    }
    this.emit("job", output);
  }
}
