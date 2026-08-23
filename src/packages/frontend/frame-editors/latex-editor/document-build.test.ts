import type { DocumentBuildSnapshot } from "@cocalc/app-document-build";

import {
  isDocumentBuildTerminal,
  snapshotBuildLogs,
  snapshotParsedLog,
} from "./document-build";

function snapshot(): DocumentBuildSnapshot {
  return {
    build_id: "build-1",
    identity: {
      kind: "latex",
      logical_path: "/home/user/paper.tex",
      working_path: "/home/user/paper.tex",
      resource_key: "/home/user/paper.tex",
    },
    state: "running",
    seq: 3,
    submitted_at: 100,
    started_at: 110,
    build_timeout_ms: 60_000,
    force: false,
    stages: [
      {
        stage_id: "latex-1",
        name: "latex",
        logical_path: "/home/user/paper.tex",
        working_path: "/home/user/paper.tex",
        resource_key: "/home/user/paper.tex",
        command: "latexmk",
        cwd: "/home/user",
        bash: false,
        timeout_s: 60,
        required: true,
        job_key: "latex-1",
        state: "running",
        started_at: 110,
        stdout: "building",
        stderr: "",
        job_id: "job-1",
      },
    ],
    diagnostics: [
      {
        level: "warning",
        source: "latex",
        message: "Reference is undefined",
        file: "paper.tex",
        line: 7,
        stage_id: "latex-1",
      },
    ],
    dependencies: ["chapter.tex"],
    artifacts: [],
  };
}

test("projects service stages and diagnostics into legacy LaTeX logs", () => {
  const value = snapshot();
  const logs = snapshotBuildLogs(value);
  const parsed = snapshotParsedLog(value);

  expect(logs.latex).toMatchObject({
    type: "async",
    job_id: "job-1",
    status: "running",
    stdout: "building",
  });
  expect(logs.latex?.parse?.warnings).toEqual([
    expect.objectContaining({ message: "Reference is undefined", line: 7 }),
  ]);
  expect(parsed.deps).toEqual(["chapter.tex"]);
  expect(parsed.warnings).toHaveLength(1);
});

test("recognizes every terminal service state", () => {
  const value = snapshot();
  expect(isDocumentBuildTerminal(value)).toBe(false);
  for (const state of [
    "succeeded",
    "failed",
    "canceled",
    "timed_out",
  ] as const) {
    expect(isDocumentBuildTerminal({ ...value, state })).toBe(true);
  }
});
