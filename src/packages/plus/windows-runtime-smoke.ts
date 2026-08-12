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

async function withTimeout<T>(
  promise: Promise<T>,
  description: string,
  timeoutMs = 20_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`${description} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer != null) clearTimeout(timer);
  }
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
  const bootstrap = await fetchWithTimeout(
    new URL("api/v2/auth/bootstrap", rootUrl).href,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );
  if (!bootstrap.ok) {
    throw new Error(`auth bootstrap smoke failed with ${bootstrap.status}`);
  }
  const auth = await bootstrap.json();
  if (!auth.signed_in) {
    throw new Error("auth bootstrap smoke did not report a signed-in user");
  }
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
  const target = new URL(location, rootUrl).searchParams.get("target");
  if (target !== `projects/${FALLBACK_PROJECT_UUID}/files/`) {
    throw new Error(`HTTP smoke redirected to an unexpected target: ${target}`);
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
  const syncedFilename = `/home/user/.cocalc-plus-windows-editor-smoke.md`;
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

  const synced = client.sync.string({
    project_id,
    path: syncedFilename,
    cursors: false,
    document_activity_interval: 0,
  });
  try {
    await withTimeout(synced.wait_until_ready(), "collaborative editor open");
    synced.from_str(`# Native Windows editor smoke\n\n${marker}\n`);
    await withTimeout(synced.save_to_disk(), "collaborative editor save");
    const saved = await projectApi.system.readTextFileFromProject({
      path: syncedFilename,
    });
    if (!saved.includes(marker)) {
      throw new Error("collaborative editor did not persist its content");
    }
  } finally {
    await synced.close().catch(() => {});
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
    await fs.rm(syncedFilename, { force: true }).catch(() => {});
    await fs
      .rm(destinationDirectory, { recursive: true, force: true })
      .catch(() => {});
  }
  process.stdout.write(
    `${JSON.stringify({ ok: true, http: true, files: true, collaborative_editor: true, powershell_terminal: true })}\n`,
  );
}
