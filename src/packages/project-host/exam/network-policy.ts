/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { executeCode } from "@cocalc/backend/execute-code";
import { isValidUUID } from "@cocalc/util/misc";

const STORAGE_WRAPPER = "/usr/local/sbin/cocalc-runtime-storage";

export type ExamProjectNetworkPolicy = "disabled" | "normal";

async function runPolicyCommand(args: string[]): Promise<void> {
  const { stdout, stderr, exit_code } = await executeCode({
    command: "sudo",
    args: ["-n", STORAGE_WRAPPER, ...args],
    timeout: 60,
    err_on_exit: false,
  });
  if (exit_code) {
    throw new Error(
      `project network policy command failed (exit ${exit_code}): ${
        stderr || stdout || ""
      }`.trim(),
    );
  }
}

function validateProjectId(project_id: string): void {
  if (!isValidUUID(project_id)) {
    throw new Error("invalid exam workspace project id");
  }
}

export async function setExamProjectNetworkPolicy({
  project_id,
  policy,
}: {
  project_id: string;
  policy: ExamProjectNetworkPolicy;
}): Promise<void> {
  validateProjectId(project_id);
  await runPolicyCommand(["set-project-network-policy", project_id, policy]);
}

export async function verifyExamProjectNetworkPolicy({
  project_id,
  policy,
}: {
  project_id: string;
  policy: ExamProjectNetworkPolicy;
}): Promise<void> {
  validateProjectId(project_id);
  await runPolicyCommand(["verify-project-network-policy", project_id, policy]);
}
