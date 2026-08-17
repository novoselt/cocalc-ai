/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import type { AccountProjectListWindowRow } from "@cocalc/conat/hub/api/projects";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { getAccountProjectWindow, type AuthBootstrap } from "./api";
import type { UltraliteRoute } from "./routes";
import {
  recordUltraliteFailure,
  recordUltraliteOutcome,
  recordUltraliteSurfaceReady,
} from "./telemetry";
import type { UltraliteSession } from "./session";
import { loadUltraliteSession } from "./session-loader";
import {
  ChunkErrorBoundary,
  InlineAlert,
  ProjectLayout,
  ShellLoading,
  SurfaceHeader,
} from "./ui";

const FileSurface = lazy(
  () =>
    new Promise((resolve, reject) => {
      require.ensure(
        [],
        () => resolve(require("./file-surface")),
        reject,
        "ultralite-files",
      );
    }),
);
const ChatSurface = lazy(
  () =>
    new Promise((resolve, reject) => {
      require.ensure(
        [],
        () => resolve(require("./chat-surface")),
        reject,
        "ultralite-chat",
      );
    }),
);
const NotebooksSurface = lazy(
  () =>
    new Promise((resolve, reject) => {
      require.ensure(
        [],
        () => resolve(require("./notebooks-surface")),
        reject,
        "ultralite-notebooks",
      );
    }),
);
const VmSurface = lazy(
  () =>
    new Promise((resolve, reject) => {
      require.ensure(
        [],
        () => resolve(require("./vm-surface")),
        reject,
        "ultralite-vms",
      );
    }),
);
const TerminalSurface = lazy(
  () =>
    new Promise((resolve, reject) => {
      require.ensure(
        [],
        () => resolve(require("./terminal-surface")),
        reject,
        "ultralite-terminal",
      );
    }),
);
const AppSurface = lazy(
  () =>
    new Promise((resolve, reject) => {
      require.ensure(
        [],
        () => resolve(require("./app-surface")),
        reject,
        "ultralite-apps",
      );
    }),
);
const CliSurface = lazy(
  () =>
    new Promise((resolve, reject) => {
      require.ensure(
        [],
        () => resolve(require("./cli-surface")),
        reject,
        "ultralite-cli",
      );
    }),
);
const SettingsSurface = lazy(
  () =>
    new Promise((resolve, reject) => {
      require.ensure(
        [],
        () => resolve(require("./settings-surface")),
        reject,
        "ultralite-settings",
      );
    }),
);
const RecentSurface = lazy(
  () =>
    new Promise((resolve, reject) => {
      require.ensure(
        [],
        () => resolve(require("./recent-surface")),
        reject,
        "ultralite-recent",
      );
    }),
);

type ProjectRoute = Exclude<
  UltraliteRoute,
  { kind: "docs" | "notifications" | "projects" }
>;
type ConnectedProjectRoute = Exclude<ProjectRoute, { kind: "cli" | "recent" }>;

function MissingHost({ project }: { project: AccountProjectListWindowRow }) {
  return (
    <main className="ul-page" id="main-content">
      <SurfaceHeader title="Project storage unavailable" />
      <InlineAlert kind="warning">
        {project.title || "This project"} has not been assigned to a project
        host. Open it in full CoCalc to complete project placement.
      </InlineAlert>
    </main>
  );
}

function DeferredSurface({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <ChunkErrorBoundary label={label}>
      <Suspense fallback={<ShellLoading />}>{children}</Suspense>
    </ChunkErrorBoundary>
  );
}

function ProjectSurface({
  project,
  route,
  session,
}: {
  project: AccountProjectListWindowRow;
  route: ConnectedProjectRoute;
  session: UltraliteSession;
}) {
  let surface: ReactNode;
  if (!project.host_id && route.kind !== "vms" && route.kind !== "settings") {
    surface = <MissingHost project={project} />;
  } else if (route.kind === "files" || route.kind === "file") {
    surface = (
      <DeferredSurface label="Files">
        <FileSurface project={project} route={route} session={session} />
      </DeferredSurface>
    );
  } else if (route.kind === "agents" || route.kind === "chat") {
    surface = (
      <DeferredSurface label="Codex">
        <ChatSurface project={project} route={route} session={session} />
      </DeferredSurface>
    );
  } else if (route.kind === "notebooks") {
    surface = (
      <DeferredSurface label="Jupyter">
        <NotebooksSurface project={project} session={session} />
      </DeferredSurface>
    );
  } else if (route.kind === "vms") {
    surface = (
      <DeferredSurface label="VMs">
        <VmSurface project={project} session={session} />
      </DeferredSurface>
    );
  } else if (route.kind === "terminal") {
    surface = (
      <DeferredSurface label="Terminal">
        <TerminalSurface project={project} session={session} />
      </DeferredSurface>
    );
  } else if (route.kind === "apps") {
    surface = (
      <DeferredSurface label="Apps">
        <AppSurface project={project} session={session} />
      </DeferredSurface>
    );
  } else if (route.kind === "settings") {
    surface = (
      <DeferredSurface label="Settings">
        <SettingsSurface project={project} session={session} />
      </DeferredSurface>
    );
  }
  return (
    <ProjectLayout project={project} route={route}>
      {surface}
    </ProjectLayout>
  );
}

export default function Workspace({
  bootstrap,
  onProjectTitleChange,
  route,
}: {
  bootstrap: AuthBootstrap;
  onProjectTitleChange: (title?: string) => void;
  route: ProjectRoute;
}) {
  const sessionless = route.kind === "recent" || route.kind === "cli";
  const [session, setSession] = useState<UltraliteSession>();
  const [project, setProject] = useState<AccountProjectListWindowRow>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const initial = bootstrap.project_window?.find(
      ({ project_id }) => project_id === route.projectId,
    );
    setProject(initial);
    setError(undefined);
    if (initial) return;
    const controller = new AbortController();
    void getAccountProjectWindow({
      bootstrap,
      request: { limit: 1, project_id: route.projectId },
      signal: controller.signal,
    })
      .then(({ projects }) => {
        if (cancelled) return;
        if (projects[0]) setProject(projects[0]);
        else setError("This project is not available to your account.");
      })
      .catch((err) => {
        if (!cancelled && !controller.signal.aborted) {
          recordUltraliteFailure("project", err);
          setError(err instanceof Error ? err.message : `${err}`);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [bootstrap, route.projectId]);

  useEffect(() => {
    if (sessionless) {
      setSession(undefined);
      return;
    }
    let current: UltraliteSession | undefined;
    let cancelled = false;
    setSession(undefined);
    void loadUltraliteSession()
      .then(({ UltraliteSession }) => UltraliteSession.open(bootstrap))
      .then((opened) => {
        current = opened;
        if (cancelled) opened.close();
        else setSession(opened);
      })
      .catch((err) => {
        if (!cancelled) {
          recordUltraliteFailure("project", err);
          recordUltraliteOutcome("project", "routing_failure");
          setError(err instanceof Error ? err.message : `${err}`);
        }
      });
    return () => {
      cancelled = true;
      current?.close();
    };
  }, [bootstrap, sessionless]);

  useEffect(() => {
    if (!project) return;
    if (!sessionless && !session) return;
    recordUltraliteSurfaceReady("project");
    recordUltraliteOutcome("project", "project_open");
  }, [project, route.kind, session, sessionless]);

  useEffect(() => {
    if (project) {
      onProjectTitleChange(project.title || "Untitled project");
    }
  }, [onProjectTitleChange, project]);

  useEffect(() => {
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>("h1")?.focus(),
    );
  }, [route.kind, route.projectId]);

  if (error) {
    return (
      <main className="ul-centered" id="main-content">
        <h1 tabIndex={-1}>Workspace unavailable</h1>
        <InlineAlert kind="error">{error}</InlineAlert>
        <button
          className="ul-button"
          onClick={() => window.location.reload()}
          type="button"
        >
          Try again
        </button>
      </main>
    );
  }
  if (!project) {
    return <ShellLoading />;
  }
  if (route.kind === "recent") {
    return (
      <ProjectLayout project={project} route={route}>
        <DeferredSurface label="Recent files">
          <RecentSurface accountId={bootstrap.account_id!} project={project} />
        </DeferredSurface>
      </ProjectLayout>
    );
  }
  if (route.kind === "cli") {
    return (
      <ProjectLayout project={project} route={route}>
        <DeferredSurface label="CLI">
          <CliSurface project={project} />
        </DeferredSurface>
      </ProjectLayout>
    );
  }
  if (!session) return <ShellLoading />;
  return <ProjectSurface project={project} route={route} session={session} />;
}
