/*
 * This file is part of CoCalc: Copyright © 2026 SageMath, Inc.
 * License: MS-RSL – see LICENSE.md for details
 */

import type { ChatThreadRuntimeState, CodexThreadConfig } from "@cocalc/chat";

export type ChatConnectionState =
  | "closed"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type ChatMessageRole = "human" | "agent" | "system";

export interface ProjectedChatMessage {
  message_id: string;
  thread_id: string;
  parent_message_id?: string;
  sender_id: string;
  role: ChatMessageRole;
  content: string;
  date: string;
  revision_date?: string;
  generating: boolean;
  state?: "queued" | "running" | "interrupted" | "complete" | "error";
  acp_events?: unknown[];
}

export interface ProjectedChatThread {
  thread_id: string;
  root_message_id?: string;
  name?: string;
  agent_kind?: "acp" | "llm" | "none";
  agent_model?: string;
  acp_config?: CodexThreadConfig;
  state: ChatThreadRuntimeState;
  active_message_id?: string;
  updated_at?: string;
}

export interface ChatSnapshot {
  revision: number;
  connection: ChatConnectionState;
  ready: boolean;
  error?: string;
  project_id: string;
  path: string;
  selected_thread_id?: string;
  threads: ProjectedChatThread[];
  messages: ProjectedChatMessage[];
}

export interface HeadlessChatClient {
  open(): Promise<void>;
  getSnapshot(): ChatSnapshot;
  subscribe(listener: (snapshot: ChatSnapshot) => void): () => void;
  selectThread(thread_id: string): void;
  sendToExistingCodexThread(opts: {
    thread_id: string;
    text: string;
  }): Promise<{ message_id: string; thread_id: string }>;
  interrupt(thread_id: string): Promise<void>;
  reconnect(reason: string): Promise<void>;
  close(): Promise<void>;
}
