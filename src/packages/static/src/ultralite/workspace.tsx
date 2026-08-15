/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import type { AccountProjectListWindowRow } from "@cocalc/conat/hub/api/projects";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { AuthBootstrap } from "./api";
import { navigate, parseRoute, type UltraliteRoute } from "./routes";
import { UltraliteSession } from "./session";
import { fullProjectUrl } from "./urls";

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
    <main className="ul-page" id="main-content">
      <div className="ul-page-heading">
        <div>
          <p className="ul-kicker">Your work</p>
          <h1 tabIndex={-1}>Projects</h1>
        </div>
        <span className="ul-meta">Realtime only where it matters</span>
      </div>
      <div className="ul-search-wrap">
        <label className="ul-meta" htmlFor="ul-project-search">
          Search projects
        </label>
        <input
          className="ul-search"
          id="ul-project-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Title or description"
          type="search"
          value={query}
        />
      </div>
      {projects.length ? (
        <div className="ul-grid">
          {projects.map((project) => {
            const state = stateLabel(project);
            return (
              <button
                aria-label={`Open project ${project.title || "Untitled project"}, ${state}`}
                className="ul-card"
                key={project.project_id}
                onClick={() =>
                  navigate({ kind: "project", projectId: project.project_id })
                }
                type="button"
              >
                <div className="ul-card-title">
                  {project.title || "Untitled project"}
                </div>
                {project.description ? <p>{project.description}</p> : null}
                <span
                  className={`ul-status ${state === "running" ? "ul-status-running" : ""}`}
                >
                  {state}
                </span>
                {project.last_activity_at ? (
                  <div className="ul-meta">
                    Active {new Date(project.last_activity_at).toLocaleString()}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : loading ? null : (
        <div className="ul-empty">No projects match this search.</div>
      )}
      {loading ? (
        <p aria-live="polite" className="ul-meta">
          Loading projects...
        </p>
      ) : null}
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
  );
}

function ProjectHome({ project }: { project: AccountProjectListWindowRow }) {
  const noHost = !project.host_id;
  return (
    <main className="ul-page" id="main-content">
      <div className="ul-page-heading">
        <div>
          <button
            className="ul-icon-button"
            onClick={() => navigate({ kind: "projects" })}
            type="button"
          >
            Back to projects
          </button>
          <p className="ul-kicker">Project</p>
          <h1 tabIndex={-1}>{project.title || "Untitled project"}</h1>
          {project.description ? <p>{project.description}</p> : null}
        </div>
      </div>
      {noHost ? (
        <p className="ul-notice" role="status">
          This project has not been assigned to a project host. Open it once in
          full CoCalc to assign one.
        </p>
      ) : null}
      <div className="ul-grid">
        <button
          className="ul-card"
          disabled={noHost}
          onClick={() =>
            navigate({
              kind: "files",
              projectId: project.project_id,
              path: "/home/user",
            })
          }
          type="button"
        >
          <div className="ul-card-title">Files</div>
          <p>Browse project files and open text or notebook views.</p>
          <span className="ul-status">Direct project-host access</span>
        </button>
        <button
          className="ul-card"
          disabled={noHost}
          onClick={() =>
            navigate({ kind: "agents", projectId: project.project_id })
          }
          type="button"
        >
          <div className="ul-card-title">Codex</div>
          <p>
            Continue an existing Codex session with live activity and interrupt
            support.
          </p>
          <span className="ul-status">Loaded only when opened</span>
        </button>
        <a
          className="ul-card"
          href={fullProjectUrl({ projectId: project.project_id })}
        >
          <div className="ul-card-title">Full CoCalc</div>
          <p>
            Open editors, terminals, collaboration, settings, and all project
            tools.
          </p>
          <span className="ul-status">Standard workspace</span>
        </a>
      </div>
    </main>
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
      <main className="ul-page" id="main-content">
        <h1 tabIndex={-1}>Project unavailable</h1>
        <p role="alert">This project is not in the loaded project window.</p>
        <button
          className="ul-button"
          onClick={() => navigate({ kind: "projects" })}
          type="button"
        >
          Back to projects
        </button>
      </main>
    );
  }
  if (route.kind === "project") return <ProjectHome project={project} />;
  if (!project.host_id) return <ProjectHome project={project} />;
  if (route.kind === "files" || route.kind === "file") {
    return (
      <Suspense fallback={<RouteLoading label="Loading the file surface" />}>
        <FileSurface project={project} route={route} session={session} />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<RouteLoading label="Loading the Codex client" />}>
      <ChatSurface project={project} route={route} session={session} />
    </Suspense>
  );
}

function RouteLoading({ label }: { label: string }) {
  return (
    <main className="ul-page" id="main-content">
      <p aria-live="polite" className="ul-kicker">
        {label}...
      </p>
    </main>
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
      <main className="ul-centered" id="main-content">
        <p className="ul-kicker">Connection problem</p>
        <h1 tabIndex={-1}>Workspace unavailable</h1>
        <p className="ul-error" role="alert">
          {error}
        </p>
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
  if (!session)
    return (
      <RouteLoading
        label={`Connecting ${bootstrap.display_name || "your account"}`}
      />
    );
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
