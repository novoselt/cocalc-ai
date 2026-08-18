/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import type { AccountProjectListWindowRow } from "@cocalc/conat/hub/api/projects";
import { useEffect, useRef, useState } from "react";
import { getAccountProjectWindow, type AuthBootstrap } from "./api";
import { navigate } from "./routes";
import type { UltraliteSession } from "./session";
import { loadUltraliteSession } from "./session-loader";
import {
  markUltraliteBackend,
  recordUltraliteFailure,
  recordUltraliteSurfaceReady,
} from "./telemetry";
import {
  EmptyState,
  EssentialLink,
  InlineAlert,
  LoadingState,
  SurfaceHeader,
} from "./ui";

const PAGE_SIZE = 50;
const CREATED_PROJECT_POLL_MS = 400;
const CREATED_PROJECT_POLL_ATTEMPTS = 30;

function stateLabel(project: AccountProjectListWindowRow): string {
  const state = `${project.state_summary?.state ?? "off"}`;
  return state === "running" ? "running" : state;
}

export default function ProjectsWorkspace({
  bootstrap,
}: {
  bootstrap: AuthBootstrap;
}) {
  const [projects, setProjects] = useState(
    () => bootstrap.project_window ?? [],
  );
  const [hasMore, setHasMore] = useState(
    bootstrap.project_window_has_more === true,
  );
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const initiallyHasProjects =
    (bootstrap.project_window?.length ?? 0) > 0 ||
    bootstrap.project_window_has_more === true;
  const [hasAccountProjects, setHasAccountProjects] =
    useState(initiallyHasProjects);
  const [showCreate, setShowCreate] = useState(!initiallyHasProjects);
  const [projectTitle, setProjectTitle] = useState("My Project");
  const [creating, setCreating] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string>();
  const request = useRef(0);
  const firstQuery = useRef(true);

  useEffect(() => {
    const timer = setTimeout(() => setActiveQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const load = async (replace: boolean) => {
    const generation = ++request.current;
    setLoading(true);
    setError(undefined);
    markUltraliteBackend("projects", "start");
    try {
      const result = await getAccountProjectWindow({
        bootstrap,
        request: {
          limit: PAGE_SIZE,
          offset: replace ? 0 : projects.length,
          search: activeQuery || undefined,
        },
      });
      if (generation !== request.current) return;
      markUltraliteBackend("projects", "end");
      setProjects((current) =>
        replace ? result.projects : [...current, ...result.projects],
      );
      setHasMore(result.hasMore);
    } catch (err) {
      markUltraliteBackend("projects", "end");
      recordUltraliteFailure("projects", err);
      if (generation === request.current) {
        setError(err instanceof Error ? err.message : `${err}`);
      }
    } finally {
      if (generation === request.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (firstQuery.current) {
      firstQuery.current = false;
      return;
    }
    setProjects([]);
    void load(true);
    // load is intentionally keyed by the debounced query only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeQuery]);

  useEffect(() => {
    if (!loading && !error) recordUltraliteSurfaceReady("projects");
  }, [error, loading]);

  const createProject = async () => {
    const title = projectTitle.trim();
    if (!title || creating || createdProjectId) return;
    setCreating(true);
    setError(undefined);
    let session: UltraliteSession | undefined;
    try {
      const { UltraliteSession } = await loadUltraliteSession();
      session = await UltraliteSession.open(bootstrap);
      const projectId = await session.hubApi.projects.createProject({
        description: "",
        start: false,
        title,
      });
      setCreatedProjectId(projectId);
      let created: AccountProjectListWindowRow | undefined;
      for (
        let attempt = 0;
        attempt < CREATED_PROJECT_POLL_ATTEMPTS;
        attempt += 1
      ) {
        const result = await getAccountProjectWindow({
          bootstrap,
          request: { limit: 1, project_id: projectId },
        });
        created = result.projects[0];
        if (created) break;
        await new Promise((resolve) =>
          setTimeout(resolve, CREATED_PROJECT_POLL_MS),
        );
      }
      if (!created) {
        throw new Error(
          "The project was created, but it has not appeared in your project list yet. Reload this page to open it.",
        );
      }
      setProjects((current) => [
        created!,
        ...current.filter(({ project_id }) => project_id !== projectId),
      ]);
      setHasAccountProjects(true);
      setShowCreate(false);
      navigate({
        kind: "files",
        path: "/home/user",
        projectId,
      });
    } catch (err) {
      recordUltraliteFailure("projects", err);
      setError(err instanceof Error ? err.message : `${err}`);
    } finally {
      session?.close();
      setCreating(false);
    }
  };

  const createPanel = (
    <form
      className={`ul-create-project ${hasAccountProjects ? "ul-create-project-compact" : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        void createProject();
      }}
    >
      {!hasAccountProjects ? (
        <>
          <div className="ul-eyebrow">Essential CoCalc</div>
          <h2>Start your first project</h2>
          <p>
            A project is your workspace for notebooks, code, terminals, and
            Codex. You can switch to full CoCalc whenever you need more tools.
          </p>
        </>
      ) : (
        <h2>Create a project</h2>
      )}
      {bootstrap.email_address_verified === false ? (
        <InlineAlert kind="warning">
          Verify your email address before creating a project.
        </InlineAlert>
      ) : null}
      <label className="ul-field" htmlFor="ul-new-project-title">
        <span>Project name</span>
        <input
          autoFocus
          className="ul-input"
          disabled={creating || !!createdProjectId}
          id="ul-new-project-title"
          maxLength={100}
          onChange={(event) => setProjectTitle(event.target.value)}
          value={projectTitle}
        />
      </label>
      <div className="ul-toolbar">
        <button
          className="ul-button"
          disabled={
            creating ||
            !!createdProjectId ||
            !projectTitle.trim() ||
            bootstrap.email_address_verified === false
          }
          type="submit"
        >
          {creating ? "Creating..." : "Create project"}
        </button>
        {hasAccountProjects ? (
          <button
            className="ul-button ul-button-secondary"
            disabled={creating}
            onClick={() => setShowCreate(false)}
            type="button"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );

  return (
    <main className="ul-page ul-projects-page" id="main-content">
      <SurfaceHeader
        actions={
          <div className="ul-toolbar">
            {hasAccountProjects ? (
              <button
                className="ul-button"
                onClick={() => {
                  setCreatedProjectId(undefined);
                  setProjectTitle("My Project");
                  setShowCreate(true);
                }}
                type="button"
              >
                New project
              </button>
            ) : null}
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
          </div>
        }
        title="Projects"
      />
      {error ? <InlineAlert kind="error">{error}</InlineAlert> : null}
      {showCreate ? createPanel : null}
      <div className="ul-project-table" role="list">
        {projects.map((project) => {
          const state = stateLabel(project);
          const title = project.title || "Untitled project";
          const edited = project.last_edited || project.last_activity_at;
          return (
            <div key={project.project_id} role="listitem">
              <EssentialLink
                aria-label={`Open project ${title}, ${state}`}
                className="ul-project-row"
                route={{
                  kind: "files",
                  projectId: project.project_id,
                  path: "/home/user",
                }}
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
              </EssentialLink>
            </div>
          );
        })}
      </div>
      {!projects.length && !loading && !showCreate ? (
        <EmptyState>
          {activeQuery
            ? "No projects match this search."
            : "No projects are available."}
        </EmptyState>
      ) : null}
      {loading ? <LoadingState label="Loading projects" /> : null}
      {hasMore ? (
        <button
          className="ul-button ul-button-secondary"
          disabled={loading}
          onClick={() => void load(false)}
          type="button"
        >
          Load more projects
        </button>
      ) : null}
    </main>
  );
}
