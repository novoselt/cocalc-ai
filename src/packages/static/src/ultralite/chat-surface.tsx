/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import {
  AgentSessionIndex,
  createHeadlessChatClient,
  type AgentSessionRecord,
  type ChatSnapshot,
  type HeadlessChatClient,
  type ProjectedChatMessage,
} from "@cocalc/chat-client";
import type { AccountProjectListWindowRow } from "@cocalc/conat/hub/api/projects";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { navigate, type UltraliteRoute } from "./routes";
import type { UltraliteSession } from "./session";
import { fullProjectUrl } from "./urls";
import { EmptyState, InlineAlert, LoadingState, SurfaceHeader } from "./ui";

const ACTIVE_STATUS = new Set(["active", "running"]);

function sessionSort(records: AgentSessionRecord[]): AgentSessionRecord[] {
  return [...records].sort((a, b) => {
    const active =
      Number(ACTIVE_STATUS.has(b.status)) - Number(ACTIVE_STATUS.has(a.status));
    return (
      active ||
      new Date(b.updated_at).valueOf() - new Date(a.updated_at).valueOf()
    );
  });
}

function AgentList({
  project,
  session,
}: {
  project: AccountProjectListWindowRow;
  session: UltraliteSession;
}) {
  const [records, setRecords] = useState<AgentSessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let index: AgentSessionIndex | undefined;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    void session
      .openProjectHost(project.project_id, project.host_id!)
      .then(async ({ client }) => {
        if (cancelled) return;
        index = new AgentSessionIndex({
          client,
          project_id: project.project_id,
        });
        index.subscribe((next) => setRecords(sessionSort(next)));
        await index.open();
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : `${err}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      index?.close();
    };
  }, [project.host_id, project.project_id, session]);

  return (
    <main className="ul-page" id="main-content">
      <SurfaceHeader
        actions={
          <a
            className="ul-link-button ul-link-button-subtle"
            href={fullProjectUrl({ projectId: project.project_id })}
          >
            Create in full CoCalc
          </a>
        }
        eyebrow="Existing sessions"
        title="Codex"
      />
      <p className="ul-muted">
        Ultralite continues existing indexed sessions. Creating a new Codex
        thread still uses the full workspace.
      </p>
      {loading ? <LoadingState label="Loading Codex sessions" /> : null}
      {error ? <InlineAlert kind="error">{error}</InlineAlert> : null}
      {records.length ? (
        <div className="ul-session-list">
          {records.map((record) => (
            <button
              aria-label={`Open ${record.title || "Codex session"}, ${record.status}`}
              className="ul-session-row"
              key={`${record.chat_path}:${record.thread_key}`}
              onClick={() =>
                navigate({
                  kind: "chat",
                  projectId: project.project_id,
                  chatPath: record.chat_path,
                  threadId: record.thread_key,
                })
              }
              type="button"
            >
              <div className="ul-row-title">
                {record.title || "Codex session"}
              </div>
              <div className="ul-row-detail">
                {[record.model, record.reasoning].filter(Boolean).join(" - ") ||
                  record.chat_path}
              </div>
              <span
                className={`ul-row-detail ${ACTIVE_STATUS.has(record.status) ? "ul-status-running" : ""}`}
              >
                {record.status} - updated{" "}
                {new Date(record.updated_at).toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      ) : !loading && !error ? (
        <EmptyState>No indexed Codex sessions were found.</EmptyState>
      ) : null}
    </main>
  );
}

function useChatSnapshot(
  client: HeadlessChatClient | undefined,
  projectId: string,
  path: string,
): ChatSnapshot {
  const fallback = useMemo<ChatSnapshot>(
    () => ({
      revision: 0,
      connection: "closed",
      ready: false,
      project_id: projectId,
      path,
      threads: [],
      messages: [],
    }),
    [path, projectId],
  );
  const subscribe = useCallback(
    (notify: () => void) =>
      client ? client.subscribe(() => notify()) : () => undefined,
    [client],
  );
  const getSnapshot = useCallback(
    () => client?.getSnapshot() ?? fallback,
    [client, fallback],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function Message({ message }: { message: ProjectedChatMessage }) {
  const human = message.role === "human";
  return (
    <article className={`ul-message ${human ? "ul-message-human" : ""}`}>
      <div className="ul-status">
        {human ? "You" : message.role === "agent" ? "Codex" : "System"}
        {message.state ? ` - ${message.state}` : ""}
      </div>
      {message.activity?.markdown ? (
        <pre className="ul-activity">{message.activity.markdown}</pre>
      ) : null}
      <div>{message.content || (message.generating ? "Working..." : "")}</div>
    </article>
  );
}

function Chat({
  project,
  route,
  session,
}: {
  project: AccountProjectListWindowRow;
  route: Extract<UltraliteRoute, { kind: "chat" }>;
  session: UltraliteSession;
}) {
  const [client, setClient] = useState<HeadlessChatClient>();
  const clientRef = useRef<HeadlessChatClient | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [status, setStatus] = useState("Connecting...");
  const [error, setError] = useState<string>();
  const snapshot = useChatSnapshot(client, project.project_id, route.chatPath);

  useEffect(() => {
    let cancelled = false;
    let opened: HeadlessChatClient | undefined;
    setError(undefined);
    setStatus("Connecting to the project host...");
    void (async () => {
      await session.ensureProjectRunning(project.project_id, setStatus);
      const lease = await session.openProjectHost(
        project.project_id,
        project.host_id!,
      );
      if (cancelled) return;
      opened = createHeadlessChatClient({
        account_id: session.accountId,
        project_id: project.project_id,
        path: route.chatPath,
        projectHostClient: lease.client,
        selected_thread_id: route.threadId,
      });
      clientRef.current = opened;
      setClient(opened);
      await opened.open();
      if (!cancelled) setStatus("Live Codex session");
    })().catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : `${err}`);
        setStatus("Disconnected");
      }
    });
    return () => {
      cancelled = true;
      clientRef.current = undefined;
      setClient(undefined);
      void opened?.close();
    };
  }, [
    project.host_id,
    project.project_id,
    route.chatPath,
    route.threadId,
    session,
  ]);

  const selectedThread = snapshot.threads.find(
    ({ thread_id }) => thread_id === route.threadId,
  );
  const canSend =
    snapshot.ready &&
    !submitting &&
    !!draft.trim() &&
    (selectedThread?.agent_kind === "acp" ||
      selectedThread?.acp_config != null);
  const visibleMessages = snapshot.messages.slice(-100);
  const generating = visibleMessages.some((message) => message.generating);

  const send = async () => {
    const active = clientRef.current;
    const text = draft.trim();
    if (!active || !canSend || !text) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await active.sendToExistingCodexThread({
        thread_id: route.threadId,
        text,
      });
      setDraft("");
      setStatus("Prompt accepted by Codex");
    } catch (err) {
      setError(err instanceof Error ? err.message : `${err}`);
    } finally {
      setSubmitting(false);
    }
  };

  const interrupt = async () => {
    const active = clientRef.current;
    if (!active || interrupting) return;
    setInterrupting(true);
    setError(undefined);
    try {
      await active.interrupt(route.threadId);
      setStatus("Interrupt confirmed");
    } catch (err) {
      setError(err instanceof Error ? err.message : `${err}`);
    } finally {
      setInterrupting(false);
    }
  };

  return (
    <main className="ul-page" id="main-content">
      <SurfaceHeader
        actions={
          <>
            <button
              className="ul-icon-button"
              onClick={() =>
                navigate({ kind: "agents", projectId: project.project_id })
              }
              type="button"
            >
              Codex sessions
            </button>
            <a
              className="ul-link-button ul-link-button-subtle"
              href={fullProjectUrl({
                projectId: project.project_id,
                path: route.chatPath,
              })}
            >
              Full CoCalc
            </a>
          </>
        }
        eyebrow={status}
        title={selectedThread?.name || "Codex chat"}
      />
      {snapshot.messages.length > visibleMessages.length ? (
        <InlineAlert>
          Showing the newest 100 messages to keep this view lightweight.
        </InlineAlert>
      ) : null}
      {error ? <InlineAlert kind="error">{error}</InlineAlert> : null}
      <div className="ul-chat-layout">
        <section aria-label="Chat messages" className="ul-messages">
          {visibleMessages.map((message) => (
            <Message key={message.message_id} message={message} />
          ))}
          {!visibleMessages.length ? (
            <EmptyState>Waiting for chat history...</EmptyState>
          ) : null}
        </section>
        <form
          className="ul-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label htmlFor="ul-codex-prompt">
            <strong>Message Codex</strong>
          </label>
          <textarea
            className="ul-textarea"
            id="ul-codex-prompt"
            onChange={(event) => setDraft(event.target.value)}
            placeholder="What should Codex do next?"
            value={draft}
          />
          <div className="ul-toolbar">
            <button className="ul-button" disabled={!canSend} type="submit">
              {submitting ? "Sending..." : "Send"}
            </button>
            {generating ? (
              <button
                className="ul-button ul-button-danger"
                disabled={interrupting}
                onClick={() => void interrupt()}
                type="button"
              >
                {interrupting ? "Stopping..." : "Stop"}
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </main>
  );
}

export default function ChatSurface({
  project,
  route,
  session,
}: {
  project: AccountProjectListWindowRow;
  route: Extract<UltraliteRoute, { kind: "agents" | "chat" }>;
  session: UltraliteSession;
}) {
  return route.kind === "agents" ? (
    <AgentList project={project} session={session} />
  ) : (
    <Chat project={project} route={route} session={session} />
  );
}
