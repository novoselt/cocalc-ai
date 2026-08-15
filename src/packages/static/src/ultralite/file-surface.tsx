/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import type { AccountProjectListWindowRow } from "@cocalc/conat/hub/api/projects";
import type { Files } from "@cocalc/conat/files/listing";
import type { FilesystemClient } from "@cocalc/conat/files/fs";
import { useEffect, useState } from "react";
import NotebookView, {
  parseNotebook,
  type NotebookDocument,
} from "./notebook-view";
import { navigate, normalizeProjectPath, type UltraliteRoute } from "./routes";
import type { UltraliteSession } from "./session";
import { fullProjectUrl } from "./urls";

const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_NOTEBOOK_BYTES = 15 * 1024 * 1024;

function childPath(parent: string, name: string): string {
  return normalizeProjectPath(`${parent.replace(/\/$/, "")}/${name}`);
}

function parentPath(path: string): string {
  const parts = normalizeProjectPath(path).split("/").filter(Boolean);
  if (parts.length <= 2) return "/home/user";
  parts.pop();
  return `/${parts.join("/")}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unit = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unit;
  return `${unit === 0 || value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function asText(value: string | Uint8Array): string {
  return typeof value === "string" ? value : new TextDecoder().decode(value);
}

function Breadcrumbs({ projectId, path }: { projectId: string; path: string }) {
  const relative = path.replace(/^\/home\/user\/?/, "");
  const names = relative ? relative.split("/") : [];
  return (
    <nav aria-label="File path" className="ul-breadcrumbs">
      <button
        onClick={() =>
          navigate({ kind: "files", projectId, path: "/home/user" })
        }
        type="button"
      >
        Home
      </button>
      {names.map((name, index) => {
        const current = `/home/user/${names.slice(0, index + 1).join("/")}`;
        return (
          <span key={current}>
            <span aria-hidden="true">/</span>
            <button
              onClick={() =>
                navigate({ kind: "files", projectId, path: current })
              }
              type="button"
            >
              {name}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

function DirectoryView({
  project,
  path,
  files,
  truncated,
}: {
  project: AccountProjectListWindowRow;
  path: string;
  files: Files;
  truncated?: boolean;
}) {
  const entries = Object.entries(files).sort(([nameA, a], [nameB, b]) => {
    const aDirectory = a.type === "d" || a.isDir;
    const bDirectory = b.type === "d" || b.isDir;
    if (aDirectory !== bDirectory) return aDirectory ? -1 : 1;
    return nameA.localeCompare(nameB, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
  return (
    <>
      {truncated ? (
        <p className="ul-notice" role="status">
          This directory is large. The project host returned a truncated
          listing.
        </p>
      ) : null}
      <div className="ul-file-list">
        {path !== "/home/user" ? (
          <button
            className="ul-file-row"
            onClick={() =>
              navigate({
                kind: "files",
                projectId: project.project_id,
                path: parentPath(path),
              })
            }
            type="button"
          >
            <span className="ul-file-name">../</span>
            <span className="ul-file-meta ul-file-modified" />
            <span className="ul-file-meta">Folder</span>
          </button>
        ) : null}
        {entries.map(([name, data]) => {
          const directory = data.type === "d" || data.isDir;
          const target = childPath(path, name);
          return (
            <button
              aria-label={`${directory ? "Open folder" : "Open file"} ${name}`}
              className="ul-file-row"
              key={name}
              onClick={() =>
                navigate({
                  kind: directory ? "files" : "file",
                  projectId: project.project_id,
                  path: target,
                })
              }
              type="button"
            >
              <span className="ul-file-name">
                {directory ? `${name}/` : name}
              </span>
              <span className="ul-file-meta ul-file-modified">
                {data.mtime ? new Date(data.mtime).toLocaleDateString() : ""}
              </span>
              <span className="ul-file-meta">
                {directory ? "Folder" : formatBytes(data.size)}
              </span>
            </button>
          );
        })}
        {!entries.length ? (
          <p className="ul-empty">This directory is empty.</p>
        ) : null}
      </div>
    </>
  );
}

export default function FileSurface({
  project,
  route,
  session,
}: {
  project: AccountProjectListWindowRow;
  route: Extract<UltraliteRoute, { kind: "files" | "file" }>;
  session: UltraliteSession;
}) {
  const [filesystem, setFilesystem] = useState<FilesystemClient>();
  const [files, setFiles] = useState<Files>();
  const [truncated, setTruncated] = useState(false);
  const [contents, setContents] = useState<string>();
  const [notebook, setNotebook] = useState<NotebookDocument>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    void session
      .openProjectFiles(project.project_id, project.host_id!)
      .then(({ filesystem }) => {
        if (!cancelled) setFilesystem(filesystem);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : `${err}`);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [project.host_id, project.project_id, session]);

  useEffect(() => {
    if (!filesystem) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setFiles(undefined);
    setContents(undefined);
    setNotebook(undefined);
    void (async () => {
      if (route.kind === "files") {
        const listing = await filesystem.getListing(route.path);
        if (!cancelled) {
          setFiles(listing.files);
          setTruncated(listing.truncated === true);
        }
        return;
      }
      const stats = await filesystem.stat(route.path);
      const notebookFile = route.path.toLowerCase().endsWith(".ipynb");
      const limit = notebookFile ? MAX_NOTEBOOK_BYTES : MAX_TEXT_BYTES;
      if (stats.size > limit) {
        throw new Error(
          `This ${formatBytes(stats.size)} file exceeds the ${formatBytes(limit)} ultralite viewing limit.`,
        );
      }
      const text = asText(
        (await filesystem.readFile(route.path, "utf8")) as string | Uint8Array,
      );
      if (!notebookFile && text.includes("\0")) {
        throw new Error(
          "This appears to be a binary file. Open it in full CoCalc.",
        );
      }
      if (!cancelled) {
        if (notebookFile) setNotebook(parseNotebook(text));
        else setContents(text);
      }
    })()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : `${err}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filesystem, route.kind, route.path]);

  return (
    <main className="ul-page" id="main-content">
      <div className="ul-page-heading">
        <div>
          <button
            className="ul-icon-button"
            onClick={() =>
              navigate({ kind: "project", projectId: project.project_id })
            }
            type="button"
          >
            Project home
          </button>
          <p className="ul-kicker">Read-only files</p>
          <h1 tabIndex={-1}>
            {route.kind === "files"
              ? project.title
              : route.path.split("/").pop()}
          </h1>
        </div>
        <a
          className="ul-link-button ul-link-button-subtle"
          href={fullProjectUrl({
            projectId: project.project_id,
            path: route.path,
          })}
        >
          Open in full CoCalc
        </a>
      </div>
      <Breadcrumbs
        projectId={project.project_id}
        path={route.kind === "file" ? parentPath(route.path) : route.path}
      />
      {loading ? (
        <p aria-live="polite" className="ul-meta">
          Loading from the project host...
        </p>
      ) : null}
      {error ? (
        <p className="ul-error" role="alert">
          {error}
        </p>
      ) : null}
      {route.kind === "files" && files ? (
        <DirectoryView
          files={files}
          path={route.path}
          project={project}
          truncated={truncated}
        />
      ) : notebook ? (
        <NotebookView notebook={notebook} />
      ) : contents != null ? (
        <pre className="ul-text-view">
          <code>{contents}</code>
        </pre>
      ) : null}
    </main>
  );
}
