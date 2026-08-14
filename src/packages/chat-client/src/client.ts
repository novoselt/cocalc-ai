/*
 * This file is part of CoCalc: Copyright © 2026 SageMath, Inc.
 * License: MS-RSL – see LICENSE.md for details
 */

import { CHAT_PRIMARY_KEYS, CHAT_STRING_COLS } from "@cocalc/chat";
import type { Client as ConatClient } from "@cocalc/conat/core/client";
import { immerdb, type ImmerDB } from "@cocalc/conat/sync-doc/immer-db";

import { projectChatRows } from "./messages";
import {
  ChatSendPipeline,
  type ChatSendPipelineOptions,
  type ChatSendTransport,
} from "./send";
import type { ChatSnapshot, HeadlessChatClient } from "./types";

export interface CreateHeadlessChatClientOptions {
  account_id: string;
  project_id: string;
  path: string;
  projectHostClient: ConatClient;
  selected_thread_id?: string;
  readyTimeoutMs?: number;
  idGenerator?: () => string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  sendTransport?: ChatSendTransport;
  ackTimeoutMs?: number;
  ackMaxAttempts?: number;
  ackBackoffMs?: number;
}

export class CoCalcHeadlessChatClient implements HeadlessChatClient {
  private readonly options: CreateHeadlessChatClientOptions;
  private db?: ImmerDB;
  private sendPipeline?: ChatSendPipeline;
  private revision = 0;
  private selectedThreadId?: string;
  private listeners = new Set<(snapshot: ChatSnapshot) => void>();
  private snapshot: ChatSnapshot;
  private readonly onChange = () => this.rebuild();
  private readonly onDisconnected = () => this.updateConnection("disconnected");
  private readonly onConnected = () => this.updateConnection("connected");

  constructor(options: CreateHeadlessChatClientOptions) {
    if (!options.account_id || !options.project_id || !options.path.trim()) {
      throw new Error("account_id, project_id, and chat path are required");
    }
    this.options = options;
    this.selectedThreadId = options.selected_thread_id?.trim() || undefined;
    this.snapshot = {
      revision: 0,
      connection: "closed",
      ready: false,
      project_id: options.project_id,
      path: options.path,
      selected_thread_id: this.selectedThreadId,
      threads: [],
      messages: [],
    };
  }

  async open(): Promise<void> {
    if (this.db?.isReady()) return;
    this.updateConnection("connecting");
    const db = immerdb({
      client: this.options.projectHostClient,
      project_id: this.options.project_id,
      path: this.options.path,
      primary_keys: [...CHAT_PRIMARY_KEYS],
      string_cols: [...CHAT_STRING_COLS],
      change_throttle: 50,
      patch_interval: 50,
      cursors: true,
      persistent: true,
    });
    this.db = db;
    db.on("change", this.onChange);
    this.options.projectHostClient.on("disconnected", this.onDisconnected);
    this.options.projectHostClient.on("connected", this.onConnected);
    try {
      await this.waitUntilReady(db);
      const sendOptions: ChatSendPipelineOptions = {
        account_id: this.options.account_id,
        project_id: this.options.project_id,
        path: this.options.path,
        db,
        acpClient: this.options.projectHostClient,
        idGenerator: this.options.idGenerator,
        now: this.options.now,
        sleep: this.options.sleep,
        transport: this.options.sendTransport,
        ackTimeoutMs: this.options.ackTimeoutMs,
        ackMaxAttempts: this.options.ackMaxAttempts,
        ackBackoffMs: this.options.ackBackoffMs,
      };
      this.sendPipeline = new ChatSendPipeline(sendOptions);
      this.rebuild();
    } catch (err) {
      this.updateConnection(
        "error",
        err instanceof Error ? err.message : `${err}`,
      );
      throw err;
    }
  }

  getSnapshot(): ChatSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: ChatSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  selectThread(thread_id: string): void {
    const normalized = thread_id.trim();
    if (!normalized || normalized === this.selectedThreadId) return;
    this.selectedThreadId = normalized;
    this.rebuild();
  }

  async sendToExistingCodexThread(opts: {
    thread_id: string;
    text: string;
  }): Promise<{ message_id: string; thread_id: string }> {
    if (!this.sendPipeline) throw new Error("Chat is not ready.");
    return await this.sendPipeline.send(opts);
  }

  async interrupt(thread_id: string): Promise<void> {
    if (!this.sendPipeline) throw new Error("Chat is not ready.");
    await this.sendPipeline.interrupt(thread_id);
  }

  async reconnect(_reason: string): Promise<void> {
    await this.closeDb();
    await this.open();
  }

  async close(): Promise<void> {
    await this.closeDb();
    this.listeners.clear();
    this.updateConnection("closed");
  }

  private async closeDb(): Promise<void> {
    this.options.projectHostClient.removeListener(
      "disconnected",
      this.onDisconnected,
    );
    this.options.projectHostClient.removeListener(
      "connected",
      this.onConnected,
    );
    const db = this.db;
    this.db = undefined;
    this.sendPipeline = undefined;
    db?.removeListener("change", this.onChange);
    await db?.close();
  }

  private async waitUntilReady(db: ImmerDB): Promise<void> {
    if (db.isReady()) return;
    const timeoutMs = this.options.readyTimeoutMs ?? 30_000;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        db.removeListener("ready", onReady);
        db.removeListener("error", onError);
      };
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (err: unknown) => {
        cleanup();
        reject(err);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out opening chat '${this.options.path}'.`));
      }, timeoutMs);
      db.once("ready", onReady);
      db.once("error", onError);
    });
  }

  private rebuild(): void {
    const db = this.db;
    if (!db?.isReady()) return;
    const rows = db.get();
    const projected = projectChatRows(
      Array.isArray(rows) ? rows : [],
      this.selectedThreadId,
    );
    if (
      !this.selectedThreadId ||
      !projected.threads.some(
        (thread) => thread.thread_id === this.selectedThreadId,
      )
    ) {
      this.selectedThreadId = projected.threads[0]?.thread_id;
    }
    const current = projectChatRows(
      Array.isArray(rows) ? rows : [],
      this.selectedThreadId,
    );
    this.snapshot = {
      revision: ++this.revision,
      connection: "connected",
      ready: true,
      project_id: this.options.project_id,
      path: this.options.path,
      selected_thread_id: this.selectedThreadId,
      threads: current.threads,
      messages: current.messages,
    };
    this.emit();
  }

  private updateConnection(
    connection: ChatSnapshot["connection"],
    error?: string,
  ): void {
    this.snapshot = {
      ...this.snapshot,
      revision: ++this.revision,
      connection,
      ready: connection === "connected" && this.db?.isReady() === true,
      error,
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

export function createHeadlessChatClient(
  options: CreateHeadlessChatClientOptions,
): HeadlessChatClient {
  return new CoCalcHeadlessChatClient(options);
}
