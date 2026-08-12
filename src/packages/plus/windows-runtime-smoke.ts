/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { conat } from "@cocalc/conat/client";
import { fsClient, fsSubject } from "@cocalc/conat/files/fs";
import { terminalClient } from "@cocalc/conat/project/terminal";
import { projectApiClient } from "@cocalc/conat/project/api/project-client";
import { FALLBACK_PROJECT_UUID } from "@cocalc/util/misc";

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Windows runtime smoke test timed out after ${timeoutMs}ms`);
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  });
}

async function smokeHttp(port: number): Promise<void> {
  const rootUrl = `http://localhost:${port}/`;
  const redirect = await fetchWithTimeout(rootUrl, { redirect: "manual" });
  if (redirect.status !== 302) {
    throw new Error(
      `HTTP smoke expected a redirect, got status ${redirect.status}`,
    );
  }
  const location = redirect.headers.get("location");
  await redirect.body?.cancel();
  if (!location) {
    throw new Error("HTTP smoke redirect did not include a location");
  }

  const app = await fetchWithTimeout(new URL(location, rootUrl).href);
  if (!app.ok) {
    throw new Error(`HTTP app smoke failed with status ${app.status}`);
  }
  const html = await app.text();
  if (!html.toLowerCase().includes("cocalc")) {
    throw new Error("HTTP app response did not contain the CoCalc app");
  }
}

export async function runWindowsRuntimeSmoke(port: number): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("the Windows runtime smoke test requires Windows");
  }
  const client = conat();
  const project_id = FALLBACK_PROJECT_UUID;
  const fs = fsClient({
    client,
    subject: fsSubject({ project_id }),
    timeout: 15_000,
  });
  const marker = `cocalc-plus-windows-${Date.now()}`;
  await smokeHttp(port);
  const projectApi = projectApiClient({ client, project_id });
  const configuration = await projectApi.system.configuration("main", true);
  if (configuration.capabilities.homeDirectory !== "/home/user") {
    throw new Error(
      `project configuration exposed a noncanonical home: ${JSON.stringify(configuration.capabilities.homeDirectory)}`,
    );
  }
  await projectApi.system.listing({ path: "/home/user" });
  const filename = ".cocalc-plus-windows-smoke.txt";
  const canonicalFilename = `/home/user/${filename}`;
  const renamedFilename = `/home/user/.cocalc-plus-windows-smoke-renamed.txt`;
  const destinationDirectory = `/home/user/.cocalc-plus-windows-smoke-dir`;
  const movedFilename = `${destinationDirectory}/.cocalc-plus-windows-smoke-renamed.txt`;
  await projectApi.system.writeTextFileToProject({
    path: canonicalFilename,
    content: marker,
  });
  const stored = await projectApi.system.readTextFileFromProject({
    path: canonicalFilename,
  });
  if (stored !== marker) {
    throw new Error(`filesystem smoke mismatch: ${JSON.stringify(stored)}`);
  }
  if (
    (await projectApi.system.realpath(canonicalFilename)) !== canonicalFilename
  ) {
    throw new Error("project realpath did not preserve the canonical path");
  }
  const names = await fs.readdir("/home/user");
  if (!names.includes(filename)) {
    throw new Error(
      "filesystem smoke file is missing from the project listing",
    );
  }
  await projectApi.system.renameFile({
    src: canonicalFilename,
    dest: renamedFilename,
  });
  if ((await fs.readFile(renamedFilename, "utf8")) !== marker) {
    throw new Error("renamed project file smoke mismatch");
  }
  await fs.mkdir(destinationDirectory);
  await projectApi.system.moveFiles({
    paths: [renamedFilename],
    dest: destinationDirectory,
  });
  if ((await fs.readFile(movedFilename, "utf8")) !== marker) {
    throw new Error("moved project file smoke mismatch");
  }

  const terminal = terminalClient({
    client,
    project_id,
    reconnection: false,
  });
  const terminalId = `windows-smoke-${Date.now()}`;
  try {
    await terminal.spawn("bash", [], {
      cwd: "/home/user",
      id: terminalId,
      path: "windows-smoke.term",
      timeout: 15_000,
    });
    await terminal.write({
      id: terminalId,
      input: `Write-Output ${marker}\r\n`,
      kind: "user",
    });
    await waitFor(async () =>
      `${await terminal.history(terminalId)}`.includes(marker),
    );
  } finally {
    await terminal.destroy().catch(() => {});
    terminal.close();
    await fs.rm(canonicalFilename, { force: true }).catch(() => {});
    await fs.rm(renamedFilename, { force: true }).catch(() => {});
    await fs.rm(movedFilename, { force: true }).catch(() => {});
    await fs
      .rm(destinationDirectory, { recursive: true, force: true })
      .catch(() => {});
  }
  process.stdout.write(
    `${JSON.stringify({ ok: true, http: true, files: true, powershell_terminal: true })}\n`,
  );
}
