/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  collectAbuseProcessSnapshot,
  sanitizeProcessName,
} from "./abuse-process-snapshot";

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "cocalc-abuse-processes-"));
  const projectPool = join(root, "cgroups");
  const procRoot = join(root, "proc");
  await mkdir(projectPool);
  await mkdir(procRoot);
  return { projectPool, procRoot };
}

async function addProcess({
  projectPool,
  procRoot,
  projectId,
  pid,
  name,
  child,
}: Awaited<ReturnType<typeof fixture>> & {
  projectId: string;
  pid: number;
  name: string;
  child?: string;
}) {
  const project = join(projectPool, `project-${projectId}`);
  const cgroup = child ? join(project, child) : project;
  await mkdir(cgroup, { recursive: true });
  await writeFile(join(cgroup, "cgroup.procs"), `${pid}\n`);
  if (child) await writeFile(join(project, "cgroup.procs"), "");
  await mkdir(join(procRoot, `${pid}`), { recursive: true });
  await writeFile(join(procRoot, `${pid}`, "comm"), `${name}\n`);
}

describe("abuse process snapshot", () => {
  it("aggregates sanitized process names from project cgroups", async () => {
    const paths = await fixture();
    await addProcess({
      ...paths,
      projectId: PROJECT_A,
      pid: 101,
      name: "sshx",
    });
    await addProcess({
      ...paths,
      projectId: PROJECT_B,
      pid: 202,
      name: "cloudflared",
      child: "network",
    });

    const result = await collectAbuseProcessSnapshot({ ...paths });

    expect(result.coverage).toBe("complete");
    expect(result.process_count).toBe(2);
    expect(result.projects).toEqual([
      {
        project_id: PROJECT_A,
        process_count: 1,
        processes: [{ name: "sshx", count: 1 }],
      },
      {
        project_id: PROJECT_B,
        process_count: 1,
        processes: [{ name: "cloudflared", count: 1 }],
      },
    ]);
  });

  it("marks bounded scans partial", async () => {
    const paths = await fixture();
    await addProcess({
      ...paths,
      projectId: PROJECT_A,
      pid: 101,
      name: "sshx",
    });
    await addProcess({
      ...paths,
      projectId: PROJECT_B,
      pid: 202,
      name: "cloudflared",
    });

    const result = await collectAbuseProcessSnapshot({
      ...paths,
      max_projects: 1,
    });

    expect(result.coverage).toBe("partial");
    expect(result.truncated.projects).toBe(true);
    expect(result.project_count).toBe(1);
  });

  it("does not return terminal control characters", () => {
    expect(sanitizeProcessName("\u001b[31msshx\n")).toBe("?[31msshx");
  });
});
