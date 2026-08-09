/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { redux } from "@cocalc/frontend/app-framework";
import type { AgentSessionRecord } from "@cocalc/frontend/chat/agent-session-index";

export const AGENT_PANEL_REVEAL_EVENT = "cocalc:agent-panel:reveal";
export const AGENT_PANEL_LAUNCH_EVENT = "cocalc:agent-panel:launch";
export const AGENT_PANEL_INLINE_CHAT_INSTANCE_KEY = "agents-panel-inline";
export const AGENT_PANEL_PIN_CHAT_INSTANCE_KEY = "agents-panel-pin";

export interface AgentPanelLaunchState {
  launchId: string;
  projectId: string;
  title: string;
  startedAt: string;
}

export interface AgentPanelRevealDetail {
  projectId: string;
  session: AgentSessionRecord;
  workspaceId?: string | null;
  workspaceOnly?: boolean;
}

export interface OpenedAgentSessionSelection {
  session_id: string;
  chat_path: string;
  thread_key: string;
  session?: AgentSessionRecord;
}

const pendingLaunches = new Map<string, AgentPanelLaunchState>();

export function loadPendingAgentSessionLaunch(
  projectId: string,
): AgentPanelLaunchState | null {
  return pendingLaunches.get(projectId) ?? null;
}

export function beginAgentSessionLaunch(
  projectId: string,
  title?: string,
): AgentPanelLaunchState {
  const launch: AgentPanelLaunchState = {
    launchId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    projectId,
    title: `${title ?? ""}`.trim() || "Agent",
    startedAt: new Date().toISOString(),
  };
  pendingLaunches.set(projectId, launch);
  redux.getProjectActions(projectId)?.setFlyoutExpanded?.("agents", true);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<AgentPanelLaunchState>(AGENT_PANEL_LAUNCH_EVENT, {
        detail: launch,
      }),
    );
  }
  return launch;
}

export function clearAgentSessionLaunch(
  projectId: string,
  launchId?: string,
): void {
  const current = pendingLaunches.get(projectId);
  if (!current || (launchId && current.launchId !== launchId)) return;
  pendingLaunches.delete(projectId);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<AgentPanelLaunchState | null>(AGENT_PANEL_LAUNCH_EVENT, {
        detail: null,
      }),
    );
  }
}

function openedSessionStorageKey(
  projectId: string,
  layout: "flyout" | "page",
): string {
  return `agents-panel-open-session:${projectId}:${layout}`;
}

export function loadOpenedAgentSessionSelection(
  projectId: string,
  layout: "flyout" | "page",
): OpenedAgentSessionSelection | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(
    openedSessionStorageKey(projectId, layout),
  );
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    const session_id = `${parsed?.session_id ?? ""}`.trim();
    const chat_path = `${parsed?.chat_path ?? ""}`.trim();
    const thread_key = `${parsed?.thread_key ?? ""}`.trim();
    if (!session_id || !chat_path || !thread_key) return null;
    return {
      session_id,
      chat_path,
      thread_key,
      session: parsed?.session,
    };
  } catch {
    return null;
  }
}

export function saveOpenedAgentSessionSelection(
  projectId: string,
  layout: "flyout" | "page",
  selection: OpenedAgentSessionSelection | null,
): void {
  if (typeof window === "undefined") return;
  const key = openedSessionStorageKey(projectId, layout);
  if (!selection) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(selection));
}

function selectionFromSession(
  session: AgentSessionRecord,
): OpenedAgentSessionSelection | null {
  const session_id = `${session.session_id ?? ""}`.trim();
  const chat_path = `${session.chat_path ?? ""}`.trim();
  const thread_key = `${session.thread_key ?? ""}`.trim();
  if (!session_id || !chat_path || !thread_key) return null;
  return { session_id, chat_path, thread_key, session };
}

export function revealAgentSession(
  projectId: string,
  session: AgentSessionRecord,
  opts?: {
    workspaceId?: string | null;
    workspaceOnly?: boolean;
  },
): void {
  clearAgentSessionLaunch(projectId);
  const selection = selectionFromSession(session);
  if (selection) {
    saveOpenedAgentSessionSelection(projectId, "flyout", selection);
    saveOpenedAgentSessionSelection(projectId, "page", selection);
  }
  redux.getProjectActions(projectId)?.setFlyoutExpanded?.("agents", true);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AgentPanelRevealDetail>(AGENT_PANEL_REVEAL_EVENT, {
      detail: {
        projectId,
        session,
        workspaceId: opts?.workspaceId ?? null,
        workspaceOnly: opts?.workspaceOnly,
      },
    }),
  );
}
