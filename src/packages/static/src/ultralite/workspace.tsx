/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import type { AccountProjectListWindowRow } from "@cocalc/conat/hub/api/projects";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AuthBootstrap } from "./api";
import { navigate, parseRoute, type UltraliteRoute } from "./routes";
import { UltraliteSession } from "./session";
import {
  ChunkErrorBoundary,
  EmptyState,
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
const PAGE_SIZE = 50;

function stateLabel(project: AccountProjectListWindowRow): string {
  const state = `${project.state_summary?.state ?? "off"}`;
  return state === "running" ? "running" : state;
}

function ProjectList({
  projects,
  loading,
  hasMore,
  query,
  setQuery,
  loadMore,
}: {
  projects: AccountProjectListWindowRow[];
  loading: boolean;
  hasMore: boolean;
  query: string;
  setQuery: (value: string) => void;
  loadMore: () => void;
}) {
  return (
    <>
      <TopBar />
      <main className="ul-page ul-projects-page" id="main-content">
        <SurfaceHeader
          actions={
            <div className="ul-search-wrap">
              <label className="ul-visually-hidden" htmlFor="ul-project-search">
                Search projects
              </label>
              <input
                className="ul-search"
                id="ul-project-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search projects"
                type="search"
                value={query}
              />
            </div>
          }
          title="Projects"
        />
        <div className="ul-project-table" role="list">
          {projects.map((project) => {
            const state = stateLabel(project);
            const title = project.title || "Untitled project";
            const edited = project.last_edited || project.last_activity_at;
            return (
              <button
                aria-label={`Open project ${title}, ${state}`}
                className="ul-project-row"
                key={project.project_id}
                onClick={() =>
                  navigate({
                    kind: "files",
                    projectId: project.project_id,
                    path: "/home/user",
                  })
                }
                role="listitem"
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="ul-project-avatar"
                  style={{
                    borderColor:
                      typeof project.theme?.color === "string"
                        ? project.theme.color
                        : undefined,
                  }}
                >
                  {title.slice(0, 1).toUpperCase()}
                </span>
                <span className="ul-project-main">
                  <strong>{title}</strong>
                  {project.description ? (
                    <span className="ul-project-description">
                      {project.description}
                    </span>
                  ) : null}
                </span>
                <span
                  className={`ul-project-state ${state === "running" ? "ul-status-running" : ""}`}
                >
                  {state}
                </span>
                <span className="ul-project-edited">
                  {edited
                    ? new Date(edited).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : ""}
                </span>
              </button>
            );
          })}
        </div>
        {!projects.length && !loading ? (
          <EmptyState>No projects match this search.</EmptyState>
        ) : null}
        {loading ? <LoadingState label="Loading projects" /> : null}
        {hasMore ? (
          <button
            className="ul-button ul-button-secondary"
            onClick={loadMore}
            type="button"
          >
            Load more projects
          </button>
        ) : null}
      </main>
    </>
  );
}

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

function ProjectRoute({
  project,
  route,
  session,
}: {
  project: AccountProjectListWindowRow;
  route: Exclude<UltraliteRoute, { kind: "projects" }>;
  session: UltraliteSession;
}) {
  let surface: ReactNode;
  if (!project.host_id && route.kind !== "vms") {
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
  } else {
    surface = (
      <DeferredSurface label="Apps">
        <AppSurface project={project} session={session} />
      </DeferredSurface>
    );
  }
  return (
    <ProjectLayout project={project} route={route}>
      {surface}
    </ProjectLayout>
  );
}

function RouteSurface({
  route,
  session,
  projects,
  loading,
  hasMore,
  query,
  setQuery,
  loadMore,
}: {
  route: UltraliteRoute;
  session: UltraliteSession;
  projects: AccountProjectListWindowRow[];
  loading: boolean;
  hasMore: boolean;
  query: string;
  setQuery: (value: string) => void;
  loadMore: () => void;
}) {
  if (route.kind === "projects") {
    return (
      <ProjectList
        hasMore={hasMore}
        loadMore={loadMore}
        loading={loading}
        projects={projects}
        query={query}
        setQuery={setQuery}
      />
    );
  }
  const project = projects.find(
    ({ project_id }) => project_id === route.projectId,
  );
  if (project == null) {
    if (loading) return <RouteLoading label="Loading project metadata" />;
    return (
      <>
        <TopBar />
        <main className="ul-page" id="main-content">
          <SurfaceHeader title="Project unavailable" />
          <InlineAlert kind="error">
            This project is not in the loaded project window. Return to Projects
            and search for it by title.
          </InlineAlert>
          <button
            className="ul-button"
            onClick={() => navigate({ kind: "projects" })}
            type="button"
          >
            Back to projects
          </button>
        </main>
      </>
    );
  }
  return <ProjectRoute project={project} route={route} session={session} />;
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

export default function Workspace({ bootstrap }: { bootstrap: AuthBootstrap }) {
  const [session, setSession] = useState<UltraliteSession>();
  const [route, setRoute] = useState(() => parseRoute());
  const [projects, setProjects] = useState<AccountProjectListWindowRow[]>([]);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef(0);
  const routeProjectId =
    route.kind === "projects" ? undefined : route.projectId;

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHashChange);
    if (!window.location.hash) navigate({ kind: "projects" });
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setActiveQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let current: UltraliteSession | undefined;
    let cancelled = false;
    setError(undefined);
    void UltraliteSession.open(bootstrap)
      .then((opened) => {
        current = opened;
        if (cancelled) opened.close();
        else setSession(opened);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : `${err}`);
      });
    return () => {
      cancelled = true;
      current?.close();
    };
  }, [bootstrap]);

  const load = async (replace: boolean) => {
    if (!session) return;
    const generation = ++request.current;
    setLoading(true);
    setError(undefined);
    try {
      const offset = replace ? 0 : projects.length;
      const page = await session.listProjects({
        limit: PAGE_SIZE,
        offset,
        search: activeQuery,
      });
      if (generation !== request.current) return;
      setProjects((current) => (replace ? page : [...current, ...page]));
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      if (generation === request.current) {
        setError(err instanceof Error ? err.message : `${err}`);
      }
    } finally {
      if (generation === request.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!session) return;
    setProjects([]);
    void load(true);
    // load is intentionally keyed by the session and debounced query only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuery, session]);

  useEffect(() => {
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>("h1")?.focus(),
    );
  }, [route.kind, routeProjectId]);

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
  if (!session) {
    return (
      <RouteLoading
        label={`Connecting ${bootstrap.display_name || "your account"}`}
      />
    );
  }
  return (
    <RouteSurface
      hasMore={hasMore}
      loadMore={() => void load(false)}
      loading={loading}
      projects={projects}
      query={query}
      route={route}
      session={session}
      setQuery={setQuery}
    />
  );
}
