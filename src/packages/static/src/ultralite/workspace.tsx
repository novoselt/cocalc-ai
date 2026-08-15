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
import { UltraliteSession } from "./session";
import {
  ChunkErrorBoundary,
  InlineAlert,
  LoadingState,
  ProjectLayout,
  SurfaceHeader,
  TopBar,
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

type ProjectRoute = Exclude<UltraliteRoute, { kind: "projects" }>;

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
      <Suspense
        fallback={
          <main className="ul-page" id="main-content">
            <LoadingState label={`Loading ${label}`} />
          </main>
        }
      >
        {children}
      </Suspense>
    </ChunkErrorBoundary>
  );
}

function ProjectSurface({
  project,
  route,
  session,
}: {
  project: AccountProjectListWindowRow;
  route: ProjectRoute;
  session: UltraliteSession;
}) {
  let surface: ReactNode;
  if (!project.host_id && route.kind !== "vms" && route.kind !== "cli") {
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
  } else {
    surface = (
      <DeferredSurface label="CLI">
        <CliSurface project={project} />
      </DeferredSurface>
    );
  }
  return (
    <ProjectLayout project={project} route={route}>
      {surface}
    </ProjectLayout>
  );
}

function RouteLoading({ label }: { label: string }) {
  return (
    <>
      <TopBar />
      <main className="ul-page" id="main-content">
        <LoadingState label={label} />
      </main>
    </>
  );
}

export default function Workspace({
  bootstrap,
  route,
}: {
  bootstrap: AuthBootstrap;
  route: ProjectRoute;
}) {
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
    let current: UltraliteSession | undefined;
    let cancelled = false;
    void UltraliteSession.open(bootstrap)
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
  }, [bootstrap]);

  useEffect(() => {
    if (!session || !project) return;
    recordUltraliteSurfaceReady("project");
    recordUltraliteOutcome("project", "project_open");
  }, [project, session]);

  useEffect(() => {
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>("h1")?.focus(),
    );
  }, [route.kind, route.projectId]);

  if (error) {
    return (
      <>
        <TopBar />
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
      </>
    );
  }
  if (!session || !project) {
    return <RouteLoading label="Connecting to project" />;
  }
  return <ProjectSurface project={project} route={route} session={session} />;
}
