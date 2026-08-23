/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { DBDocument } from "@cocalc/sync/editor/db/doc";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  ProjectDocumentBuildRuntime,
  documentBuildStageAggregate,
  documentBuildStageJobKey,
} from "./runtime";

describe("ProjectDocumentBuildRuntime", () => {
  const execFileAsync = promisify(execFile);
  let home: string;
  let runtime: ProjectDocumentBuildRuntime;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "cocalc-document-build-"));
    runtime = new ProjectDocumentBuildRuntime({
      build_id: "build-1",
      signal: new AbortController().signal,
      setCancelActive: () => {},
      env: { HOME: home, COCALC_RUNTIME_HOME: "/home/user" },
    });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("reads the persisted auxiliary syncdb build command", async () => {
    let document = new DBDocument(new Set(["key"]), new Set());
    document = document.set({
      key: "build_command",
      value: ["latexmk", "-pdf", "paper.tex"],
    });
    await writeFile(path.join(home, ".paper.tex.syncdb"), document.to_str());
    await expect(
      runtime.readBuildConfig("/home/user/paper.tex"),
    ).resolves.toEqual({
      build_command: ["latexmk", "-pdf", "paper.tex"],
    });
  });

  it("supports filesystem reads, copies, existence, and hashes", async () => {
    await writeFile(path.join(home, "paper.tex"), "content");
    await expect(runtime.readText("/home/user/paper.tex")).resolves.toBe(
      "content",
    );
    await expect(runtime.exists("/home/user/paper.tex")).resolves.toBe(true);
    await expect(runtime.hash("/home/user/paper.tex")).resolves.toMatch(
      /^[a-f0-9]{64}$/,
    );
    await mkdir(path.join(home, "output"));
    await runtime.copy("/home/user/paper.tex", "/home/user/output/copied.tex");
    await expect(
      runtime.readText("/home/user/output/copied.tex"),
    ).resolves.toBe("content");
  });

  it("copies controlled LaTeX output from tmp into the project", async () => {
    const output = await mkdtemp(
      path.join(tmpdir(), "cocalc-document-build-output-"),
    );
    try {
      await writeFile(path.join(output, "paper.pdf"), "pdf output");
      await runtime.copy(
        path.join(output, "paper.pdf"),
        "/home/user/paper.pdf",
      );
      await expect(runtime.readText("/home/user/paper.pdf")).resolves.toBe(
        "pdf output",
      );
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  });

  it("rejects malformed saved configuration", async () => {
    await writeFile(path.join(home, ".paper.tex.syncdb"), "not-jsonl");
    await expect(
      runtime.readBuildConfig("/home/user/paper.tex"),
    ).rejects.toThrow("invalid saved LaTeX build configuration");
  });

  it("does not aggregate distinct reruns of the same compiler", () => {
    const stage = {
      job_key: "latex:/home/user/paper.tex",
      stage_id: "latex-1",
    } as any;
    expect(documentBuildStageJobKey(stage)).toBe(
      "latex:/home/user/paper.tex:latex-1",
    );
    expect(
      documentBuildStageJobKey({ ...stage, stage_id: "latex-3" }),
    ).not.toBe(documentBuildStageJobKey(stage));
  });

  it("treats stage generations as opaque exact-match values", () => {
    const stage = { aggregate_key: "-7f9e" } as any;
    expect(documentBuildStageAggregate(stage)).toEqual({ value: "-7f9e" });
    expect(
      documentBuildStageAggregate({ ...stage, aggregate_key: 17 }),
    ).toEqual({ value: 17 });
    expect(
      documentBuildStageAggregate({ ...stage, aggregate_key: undefined }),
    ).toBeUndefined();
  });

  it("aborts filesystem operations instead of reporting missing files", async () => {
    await writeFile(path.join(home, "paper.tex"), "content");
    const abort = new AbortController();
    abort.abort();
    const canceled = new ProjectDocumentBuildRuntime({
      build_id: "build-canceled",
      signal: abort.signal,
      setCancelActive: () => {},
      env: { HOME: home, COCALC_RUNTIME_HOME: "/home/user" },
    });

    await expect(canceled.readText("/home/user/paper.tex")).rejects.toThrow();
    await expect(canceled.exists("/home/user/paper.tex")).rejects.toThrow();
    await expect(canceled.hash("/home/user/paper.tex")).rejects.toThrow();
    await expect(
      canceled.copy("/home/user/paper.tex", "/home/user/copied.tex"),
    ).rejects.toThrow();
  });

  it("rejects FIFOs without blocking a project build slot", async () => {
    const fifo = path.join(home, "blocked.tex");
    await execFileAsync("mkfifo", [fifo]);

    await expect(runtime.readText("/home/user/blocked.tex")).rejects.toThrow(
      "not a regular file",
    );
    await expect(runtime.hash("/home/user/blocked.tex")).rejects.toThrow(
      "not a regular file",
    );
  });
});
