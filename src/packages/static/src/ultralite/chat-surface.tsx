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
const INITIAL_MESSAGE_LIMIT = 100;
const MESSAGE_LIMIT_STEP = 100;
const MAX_RENDERED_MESSAGE_LENGTH = 200_000;
const SAFE_LINK =
  /\[([^\]\n]{1,160})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)/g;

function boundedMessageContent(content: string): string {
  if (content.length <= MAX_RENDERED_MESSAGE_LENGTH) return content;
  return `${content.slice(0, MAX_RENDERED_MESSAGE_LENGTH)}\n\n[message truncated in constrained mode]`;
}

export function SafeMessageContent({ content }: { content: string }) {
  const text = boundedMessageContent(content);
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(SAFE_LINK)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(text.slice(cursor, index));
    const href = match[2] || match[3];
    let end = index + match[0].length;
    let suffix = "";
    if (!match[2]) {
      const trimmed = href.replace(/[.,;:!?]+$/, "");
      suffix = href.slice(trimmed.length);
      end -= suffix.length;
      nodes.push(
        <a
          href={trimmed}
          key={`${index}:${trimmed}`}
          rel="noreferrer"
          target="_blank"
        >
          {trimmed}
        </a>,
      );
    } else {
      nodes.push(
        <a
          href={href}
          key={`${index}:${href}`}
          rel="noreferrer"
          target="_blank"
        >
          {match[1]}
        </a>,
      );
    }
    if (suffix) nodes.push(suffix);
    cursor = end + suffix.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}

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

export function Message({ message }: { message: ProjectedChatMessage }) {
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
      <div>
        <SafeMessageContent
          content={message.content || (message.generating ? "Working..." : "")}
        />
      </div>
    </article>
  );
}

export function Chat({
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
  const [reconnecting, setReconnecting] = useState(false);
  const [messageLimit, setMessageLimit] = useState(INITIAL_MESSAGE_LIMIT);
  const [status, setStatus] = useState("Connecting...");
  const [error, setError] = useState<string>();
  const snapshot = useChatSnapshot(client, project.project_id, route.chatPath);

  useEffect(() => setMessageLimit(INITIAL_MESSAGE_LIMIT), [route.threadId]);

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
  const visibleMessages = snapshot.messages.slice(-messageLimit);
  const generating = snapshot.messages.some((message) => message.generating);
  const canContinue =
    snapshot.ready &&
    !submitting &&
    !generating &&
    (selectedThread?.agent_kind === "acp" ||
      selectedThread?.acp_config != null);

  const submitText = async (text: string, clearDraft: boolean) => {
    const active = clientRef.current;
    const normalized = text.trim();
    if (!active || !snapshot.ready || submitting || !normalized) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await active.sendToExistingCodexThread({
        thread_id: route.threadId,
        text: normalized,
      });
      if (clearDraft) setDraft("");
      setStatus("Prompt accepted by Codex");
    } catch (err) {
      setError(err instanceof Error ? err.message : `${err}`);
    } finally {
      setSubmitting(false);
    }
  };

  const send = async () => {
    if (!canSend) return;
    await submitText(draft, true);
  };

  const reconnect = async () => {
    const active = clientRef.current;
    if (!active || reconnecting) return;
    setReconnecting(true);
    setError(undefined);
    setStatus("Catching up...");
    try {
      await active.reconnect("constrained-client-user-request");
      setStatus("Live Codex session");
    } catch (err) {
      setError(err instanceof Error ? err.message : `${err}`);
      setStatus("Disconnected");
    } finally {
      setReconnecting(false);
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
            <button
              className="ul-icon-button"
              disabled={!client || reconnecting}
              onClick={() => void reconnect()}
              type="button"
            >
              {reconnecting ? "Catching up..." : "Catch up"}
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
        <div className="ul-history-notice">
          <span>
            Showing the newest {visibleMessages.length} of{" "}
            {snapshot.messages.length} messages.
          </span>
          <button
            className="ul-icon-button"
            onClick={() =>
              setMessageLimit((current) => current + MESSAGE_LIMIT_STEP)
            }
            type="button"
          >
            Show older
          </button>
        </div>
      ) : null}
      {snapshot.connection === "disconnected" ||
      snapshot.connection === "error" ? (
        <InlineAlert kind="warning">
          The live Codex connection was interrupted. Use Catch up to reconnect
          and load current activity.
        </InlineAlert>
      ) : null}
      {snapshot.error ? (
        <InlineAlert kind="error">{snapshot.error}</InlineAlert>
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
            {!generating ? (
              <button
                className="ul-button ul-button-secondary"
                disabled={!canContinue}
                onClick={() => void submitText("continue", false)}
                type="button"
              >
                {submitting ? "Sending..." : "Continue Codex"}
              </button>
            ) : null}
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
