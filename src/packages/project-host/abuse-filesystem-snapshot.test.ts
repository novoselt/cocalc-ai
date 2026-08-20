/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectAbuseFilesystemSnapshot } from "./abuse-filesystem-snapshot";

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cocalc-abuse-filesystems-"));
  const projectPool = join(root, "cgroups");
  const storageMount = join(root, "storage");
  await mkdir(projectPool);
  await mkdir(storageMount);
  return { root, projectPool, storageMount };
}

async function addProject(
  paths: Awaited<ReturnType<typeof fixture>>,
  projectId: string,
) {
  const cgroup = join(paths.projectPool, `project-${projectId}`);
  await mkdir(cgroup);
  await writeFile(join(cgroup, "pids.current"), "1\n");
  const project = join(paths.storageMount, `project-${projectId}`);
  await mkdir(project);
  return project;
}

describe("abuse filesystem snapshot", () => {
  it("produces stable structure hashes without returning file paths", async () => {
    const paths = await fixture();
    const first = await addProject(paths, PROJECT_A);
    const second = await addProject(paths, PROJECT_B);
    await mkdir(join(first, "app"));
    await mkdir(join(second, "app"));
    await writeFile(join(first, "app", "index.js"), "one");
    await writeFile(join(second, "app", "index.js"), "three");

    const result = await collectAbuseFilesystemSnapshot({ ...paths });

    expect(result.coverage).toBe("complete");
    expect(result.fingerprint_count).toBe(2);
    expect(result.projects[0].structure_sha256).toBe(
      result.projects[1].structure_sha256,
    );
    expect(result.projects[0].metadata_sha256).not.toBe(
      result.projects[1].metadata_sha256,
    );
    expect(JSON.stringify(result)).not.toContain("index.js");
  });

  it("excludes dependency contents and never follows symlinks", async () => {
    const paths = await fixture();
    const project = await addProject(paths, PROJECT_A);
    const outside = join(paths.root, "outside");
    await mkdir(join(project, "node_modules", "package"), { recursive: true });
    await writeFile(join(project, "node_modules", "package", "secret"), "x");
    await mkdir(outside);
    await writeFile(join(outside, "secret"), "secret");
    await symlink(outside, join(project, "external"));

    const result = await collectAbuseFilesystemSnapshot({ ...paths });
    const fingerprint = result.projects[0];

    expect(fingerprint.complete).toBe(true);
    expect(fingerprint.excluded_count).toBe(1);
    expect(fingerprint.symlink_count).toBe(1);
    expect(fingerprint.entry_count).toBe(2);
  });

  it("marks oversized projects non-correlatable without losing host coverage", async () => {
    const paths = await fixture();
    const project = await addProject(paths, PROJECT_A);
    await writeFile(join(project, "a"), "a");
    await writeFile(join(project, "b"), "b");

    const result = await collectAbuseFilesystemSnapshot({
      ...paths,
      max_entries_per_project: 1,
    });

    expect(result.coverage).toBe("complete");
    expect(result.fingerprint_count).toBe(0);
    expect(result.skipped_large_project_count).toBe(1);
    expect(result.projects[0].complete).toBe(false);
  });

  it("ignores inactive cgroups and hidden project scaffolding", async () => {
    const paths = await fixture();
    const active = await addProject(paths, PROJECT_A);
    const inactive = await addProject(paths, PROJECT_B);
    await writeFile(
      join(paths.projectPool, `project-${PROJECT_B}`, "pids.current"),
      "0\n",
    );
    await writeFile(join(active, ".bashrc"), "default");
    await writeFile(join(active, "main.py"), "print('ok')");
    await writeFile(join(inactive, "main.py"), "print('inactive')");

    const result = await collectAbuseFilesystemSnapshot({ ...paths });

    expect(result.project_count).toBe(1);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0].project_id).toBe(PROJECT_A);
    expect(result.projects[0].entry_count).toBe(1);
    expect(result.projects[0].examined_count).toBe(2);
    expect(result.projects[0].excluded_count).toBe(1);
  });
});
