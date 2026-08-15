/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import {
  terminalClient,
  type TerminalClient,
} from "@cocalc/conat/project/terminal";
import type { AccountProjectListWindowRow } from "@cocalc/conat/hub/api/projects";
import { COLORS } from "@cocalc/util/theme";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import type { UltraliteSession } from "./session";
import {
  markUltraliteBackend,
  recordUltraliteFailure,
  recordUltraliteOutcome,
  recordUltraliteSurfaceReady,
} from "./telemetry";
import { InlineAlert, LoadingState, SurfaceHeader } from "./ui";
import { fullProjectUrl } from "./urls";

type ConnectionState =
  | "checking"
  | "idle"
  | "starting"
  | "connecting"
  | "connected"
  | "disconnected"
  | "exited";

const SPAWN_TIMEOUT_MS = 15_000;

export function writeTerminalInput(
  terminal: TerminalClient | undefined,
  data: string,
  kind: "auto" | "user" = "user",
): void {
  if (terminal?.socket.state === "ready") {
    terminal.socket.write({ data, kind });
  }
}

function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case "checking":
      return "Checking project state";
    case "idle":
      return "Not connected";
    case "starting":
      return "Starting project";
    case "connecting":
      return "Connecting terminal";
    case "connected":
      return "Connected";
    case "disconnected":
      return "Connection interrupted";
    case "exited":
      return "Shell exited";
  }
}

export default function TerminalSurface({
  project,
  session,
}: {
  project: AccountProjectListWindowRow;
  session: UltraliteSession;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XtermTerminal | undefined>(undefined);
  const fitRef = useRef<FitAddon | undefined>(undefined);
  const ptyRef = useRef<TerminalClient | undefined>(undefined);
  const connectGeneration = useRef(0);
  const renderingOutput = useRef(0);
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [projectRunning, setProjectRunning] = useState(false);
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();

  const sessionId = `ultralite-${session.accountId}`;

  const writeTerminalOutput = (data: string) => {
    const xterm = xtermRef.current;
    if (!xterm || !data) return;
    renderingOutput.current += 1;
    xterm.write(data, () => {
      setTimeout(() => {
        renderingOutput.current = Math.max(0, renderingOutput.current - 1);
      }, 0);
    });
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const xterm = new XtermTerminal({
      allowProposedApi: false,
      cursorBlink: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      scrollback: 5_000,
      theme: {
        background: COLORS.GRAY_DD,
        cursor: COLORS.BLUE_L,
        foreground: COLORS.TOP_BAR.ACTIVE,
        selectionBackground: COLORS.BLUE_DD,
      },
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(host);
    xtermRef.current = xterm;
    fitRef.current = fit;

    const fitAndResize = () => {
      try {
        fit.fit();
      } catch {
        return;
      }
      const pty = ptyRef.current;
      if (!pty || pty.socket.state !== "ready") return;
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
      resizeTimer.current = setTimeout(() => {
        if (xterm.cols > 0 && xterm.rows > 0) {
          void pty.resize({ cols: xterm.cols, rows: xterm.rows });
        }
      }, 80);
    };
    const observer = new ResizeObserver(fitAndResize);
    observer.observe(host);
    const input = xterm.onData((data) => {
      writeTerminalInput(
        ptyRef.current,
        data,
        renderingOutput.current > 0 ? "auto" : "user",
      );
    });
    const key = xterm.onKey(({ key }) => {
      if (renderingOutput.current > 0) {
        writeTerminalInput(ptyRef.current, key, "user");
      }
    });
    fitAndResize();

    return () => {
      connectGeneration.current += 1;
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
      observer.disconnect();
      input.dispose();
      key.dispose();
      ptyRef.current?.close();
      ptyRef.current = undefined;
      xterm.dispose();
      renderingOutput.current = 0;
      xtermRef.current = undefined;
      fitRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const check = async () => {
      markUltraliteBackend("terminal", "start");
      try {
        const state = await session.getProjectState(project.project_id);
        if (!active) return;
        const running = state.state === "running";
        setProjectRunning(running);
        setConnection("idle");
        markUltraliteBackend("terminal", "end");
        recordUltraliteSurfaceReady("terminal");
      } catch (err) {
        if (!active) return;
        markUltraliteBackend("terminal", "end");
        recordUltraliteFailure("terminal", err);
        setConnection("idle");
        setError(err instanceof Error ? err.message : `${err}`);
      }
    };
    void check();
    return () => {
      active = false;
    };
  }, [project.project_id, session]);

  const disconnect = () => {
    connectGeneration.current += 1;
    ptyRef.current?.close();
    ptyRef.current = undefined;
    setConnection("idle");
    setProgress(undefined);
  };

  const connectTerminal = async () => {
    if (["starting", "connecting", "connected"].includes(connection)) return;
    const generation = ++connectGeneration.current;
    let backendTimingActive = false;
    const finishBackendTiming = () => {
      if (!backendTimingActive) return;
      markUltraliteBackend("terminal", "end");
      backendTimingActive = false;
    };
    setError(undefined);
    setProgress(undefined);
    try {
      const state = await session.getProjectState(project.project_id);
      if (state.error) throw new Error(state.error);
      if (state.state !== "running") {
        if (
          !window.confirm(
            "Start this project and open a terminal? Project compute charges may apply.",
          )
        ) {
          return;
        }
        markUltraliteBackend("terminal", "start");
        backendTimingActive = true;
        setConnection("starting");
        await session.ensureProjectRunning(project.project_id, setProgress);
        if (generation !== connectGeneration.current) {
          finishBackendTiming();
          return;
        }
        setProjectRunning(true);
      }
      setConnection("connecting");
      setProgress("Opening a direct connection to the project host...");
      if (!backendTimingActive) {
        markUltraliteBackend("terminal", "start");
        backendTimingActive = true;
      }
      ptyRef.current?.close();
      const lease = await session.openProjectHost(
        project.project_id,
        project.host_id!,
      );
      const terminal = terminalClient({
        client: lease.client,
        getSize: () => {
          const xterm = xtermRef.current;
          return xterm && xterm.cols > 0 && xterm.rows > 0
            ? { cols: xterm.cols, rows: xterm.rows }
            : undefined;
        },
        project_id: project.project_id,
        reconnection: true,
      });
      if (generation !== connectGeneration.current) {
        terminal.close();
        finishBackendTiming();
        return;
      }
      ptyRef.current = terminal;
      terminal.socket.on("data", (data) => {
        if (generation === connectGeneration.current) {
          writeTerminalOutput(typeof data === "string" ? data : `${data}`);
        }
      });
      terminal.socket.on("disconnected", () => {
        if (generation === connectGeneration.current) {
          setConnection("disconnected");
        }
      });
      terminal.socket.on("closed", () => {
        if (generation === connectGeneration.current) {
          setConnection("disconnected");
        }
      });
      terminal.socket.on("recovered", () => {
        if (generation === connectGeneration.current) {
          setConnection("connected");
          setProgress(undefined);
        }
      });
      terminal.on("exit", () => {
        if (generation !== connectGeneration.current) return;
        writeTerminalOutput("\r\n[Shell exited]\r\n");
        setConnection("exited");
      });
      const history = await terminal.spawn("bash", [], {
        cwd: "/home/user",
        env0: {
          COLORTERM: "truecolor",
          TERM: "xterm-256color",
        },
        id: sessionId,
        timeout: SPAWN_TIMEOUT_MS,
      });
      if (generation !== connectGeneration.current) {
        terminal.close();
        finishBackendTiming();
        return;
      }
      if (history) {
        xtermRef.current?.reset();
        writeTerminalOutput(history);
      }
      try {
        fitRef.current?.fit();
      } catch {
        // A zero-sized host will be fitted by ResizeObserver when visible.
      }
      if (xtermRef.current?.cols && xtermRef.current.rows) {
        await terminal.resize({
          cols: xtermRef.current.cols,
          rows: xtermRef.current.rows,
        });
      }
      finishBackendTiming();
      recordUltraliteOutcome("terminal", "terminal_connect");
      setConnection("connected");
      setProgress(undefined);
      xtermRef.current?.focus();
    } catch (err) {
      if (generation !== connectGeneration.current) return;
      finishBackendTiming();
      recordUltraliteFailure("terminal", err);
      ptyRef.current?.close();
      ptyRef.current = undefined;
      setConnection("disconnected");
      setProgress(undefined);
      setError(err instanceof Error ? err.message : `${err}`);
    }
  };

  const busy =
    connection === "checking" ||
    connection === "starting" ||
    connection === "connecting";
  const connected = connection === "connected";

  return (
    <main className="ul-page ul-terminal-page" id="main-content">
      <SurfaceHeader
        actions={
          <>
            {connected ? (
              <button
                className="ul-button ul-button-secondary"
                onClick={disconnect}
                type="button"
              >
                Disconnect
              </button>
            ) : (
              <button
                className="ul-button"
                disabled={busy}
                onClick={() => void connectTerminal()}
                type="button"
              >
                {connection === "starting"
                  ? "Starting project..."
                  : connection === "connecting"
                    ? "Connecting..."
                    : connection === "exited"
                      ? "Restart shell"
                      : "Connect terminal"}
              </button>
            )}
            <a
              className="ul-link-button ul-link-button-subtle"
              data-ul-full-cocalc
              href={fullProjectUrl({ projectId: project.project_id })}
            >
              Full CoCalc
            </a>
          </>
        }
        eyebrow="Project compute"
        title="Terminal"
      />
      {!projectRunning && connection === "idle" ? (
        <InlineAlert>
          This project is stopped. Viewing this page does not start compute;
          connecting will ask before starting the project.
        </InlineAlert>
      ) : null}
      {error ? <InlineAlert kind="error">{error}</InlineAlert> : null}
      {busy ? (
        <LoadingState label={progress ?? connectionLabel(connection)} />
      ) : null}
      <div className="ul-terminal-meta" role="status" aria-live="polite">
        {connectionLabel(connection)}. The shell session is retained when this
        browser disconnects.
      </div>
      <div
        aria-label="Project terminal"
        className="ul-terminal-host"
        onClick={() => xtermRef.current?.focus()}
        role="application"
      />
      <p className="ul-muted">
        Terminal input and output travel directly between this browser and the
        project host. Use the browser or operating-system copy and paste
        shortcuts.
      </p>
    </main>
  );
}
