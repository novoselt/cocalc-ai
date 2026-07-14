/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import type {
  CourseSecretPolicyState,
  CourseSecretRecipientPreview,
  CourseSecretSyncPreview,
  CourseSecretSyncResult,
  CourseSecretSyncRun,
} from "@cocalc/conat/hub/api/projects";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import { getInterBayBridge } from "@cocalc/server/inter-bay/bridge";
import { resolveProjectBay } from "@cocalc/server/inter-bay/directory";
import {
  approveCourseSecretRecipients as approveRecipientsInDb,
  assertCourseSecretPolicyGeneration,
  beginCourseSecretRun,
  finishCourseSecretRun,
  getCourseSecretPolicyState,
  recordCourseSecretResults,
} from "./course-secret-sharing";
import {
  getCourseShareableSecretValues,
  installCourseManagedProjectSecrets,
  removeCourseManagedProjectSecrets,
  validateCourseSecretTargetAssociation,
} from "./project-secrets";
import { syncProjectSecretsRuntimeOnAssignedHost } from "./project-secrets-runtime";

const logger = getLogger("server:projects:course-secret-sharing-coordinator");

async function targetPreview({
  target_project_id,
  course_project_id,
  course_path,
  approved,
}: {
  target_project_id: string;
  course_project_id: string;
  course_path: string;
  approved: boolean;
}): Promise<CourseSecretRecipientPreview> {
  const ownership = await resolveProjectBay(target_project_id);
  if (!ownership) {
    return {
      target_project_id,
      approved,
      eligible: false,
      reason: "not_found",
    };
  }
  const association =
    ownership.bay_id === getConfiguredBayId()
      ? await validateCourseSecretTargetAssociation({
          project_id: target_project_id,
          course_project_id,
          course_path,
        }).then((reason) => ({ eligible: reason === "eligible", reason }))
      : await getInterBayBridge()
          .projectSecrets(ownership.bay_id)
          .validateCourseTarget({
            project_id: target_project_id,
            course_project_id,
            course_path,
            epoch: ownership.epoch,
          });
  if (!association.eligible) {
    return {
      target_project_id,
      approved,
      eligible: false,
      reason: association.reason,
    };
  }
  return {
    target_project_id,
    approved,
    eligible: approved,
    reason: approved ? "eligible" : "not_approved",
  };
}

export async function previewCourseSecretSyncLocal({
  course_project_id,
  course_id,
  course_path,
  target_project_ids,
}: {
  course_project_id: string;
  course_id: string;
  course_path: string;
  target_project_ids: string[];
}): Promise<CourseSecretSyncPreview> {
  const state = await getCourseSecretPolicyState({
    course_project_id,
    course_id,
    course_path,
  });
  const approved = new Set(
    state?.recipients
      .filter(({ revoked_at }) => revoked_at == null)
      .map(({ target_project_id }) => target_project_id) ?? [],
  );
  const targets = Array.from(new Set(target_project_ids ?? []));
  const recipients = await Promise.all(
    targets.map((target_project_id) =>
      targetPreview({
        target_project_id,
        course_project_id,
        course_path,
        approved: approved.has(target_project_id),
      }),
    ),
  );
  return {
    policy: state?.policy ?? null,
    grants: state?.grants ?? [],
    recipients,
  };
}

export async function approveCourseSecretRecipientsLocal(opts: {
  account_id: string;
  course_project_id: string;
  course_id: string;
  course_path: string;
  recipients: Array<{
    target_project_id: string;
    student_account_id?: string | null;
  }>;
}): Promise<CourseSecretPolicyState> {
  const preview = await previewCourseSecretSyncLocal({
    ...opts,
    target_project_ids: opts.recipients.map(
      ({ target_project_id }) => target_project_id,
    ),
  });
  const invalid = preview.recipients.filter(
    ({ reason }) => !["eligible", "not_approved"].includes(reason),
  );
  if (invalid.length) {
    throw new Error(
      `invalid course secret recipient(s): ${invalid
        .map(
          ({ target_project_id, reason }) => `${target_project_id}:${reason}`,
        )
        .join(", ")}`,
    );
  }
  return await approveRecipientsInDb(opts);
}

function resultRows(
  run_id: string,
  target_project_id: string,
  names: string[],
  status: CourseSecretSyncResult["status"],
  error_code?: string | null,
): Array<{
  run_id: string;
  target_project_id: string;
  secret_name: string;
  status: CourseSecretSyncResult["status"];
  error_code?: string | null;
}> {
  return names.map((secret_name) => ({
    run_id,
    target_project_id,
    secret_name,
    status,
    error_code,
  }));
}

async function installOnTarget({
  ownership,
  ...opts
}: {
  ownership: { bay_id: string; epoch: number };
  project_id: string;
  course_project_id: string;
  course_id: string;
  course_path: string;
  policy_id: string;
  account_id: string;
  secrets: Array<{
    name: string;
    value: string;
    source_revision: number;
    grant_id: string;
  }>;
}) {
  if (ownership.bay_id !== getConfiguredBayId()) {
    return await getInterBayBridge()
      .projectSecrets(ownership.bay_id)
      .installCourseManaged({ ...opts, epoch: ownership.epoch });
  }
  const result = await installCourseManagedProjectSecrets(opts);
  const runtime_refresh = await syncProjectSecretsRuntimeOnAssignedHost({
    project_id: opts.project_id,
  });
  return { ...result, runtime_refresh };
}

async function removeFromTarget({
  ownership,
  ...opts
}: {
  ownership: { bay_id: string; epoch: number };
  project_id: string;
  policy_id: string;
  names?: string[];
  account_id: string;
}) {
  if (ownership.bay_id !== getConfiguredBayId()) {
    return await getInterBayBridge()
      .projectSecrets(ownership.bay_id)
      .removeCourseManaged({ ...opts, epoch: ownership.epoch });
  }
  const result = await removeCourseManagedProjectSecrets(opts);
  const runtime_refresh = await syncProjectSecretsRuntimeOnAssignedHost({
    project_id: opts.project_id,
  });
  return { ...result, runtime_refresh };
}

function safeErrorCode(err: unknown): string {
  const message = `${err}`.toLowerCase();
  if (message.includes("policy changed")) return "policy_changed";
  if (message.includes("not linked")) return "target_association_changed";
  if (message.includes("not found")) return "target_not_found";
  if (message.includes("limit")) return "target_secret_limit";
  if (message.includes("eligible") || message.includes("unavailable")) {
    return "source_secret_unavailable";
  }
  return "internal_error";
}

async function executeCourseSecretRun(
  snapshot: Awaited<ReturnType<typeof beginCourseSecretRun>>,
  account_id: string,
): Promise<void> {
  const { policy, grants, recipients, run } = snapshot;
  try {
    let sourceSecrets: Awaited<
      ReturnType<typeof getCourseShareableSecretValues>
    > = [];
    if (run.mode === "sync") {
      sourceSecrets = await getCourseShareableSecretValues({
        project_id: policy.course_project_id,
        names: grants.map(({ name }) => name),
      });
    }
    const grantByName = new Map(grants.map((item) => [item.name, item]));
    for (const recipient of recipients) {
      await assertCourseSecretPolicyGeneration({
        policy_id: policy.policy_id,
        generation: run.policy_generation,
        allow_disabled: run.mode === "cleanup",
        allow_revoked: run.mode === "cleanup",
      });
      const ownership = await resolveProjectBay(recipient.target_project_id);
      if (!ownership) {
        await recordCourseSecretResults({
          course_project_id: policy.course_project_id,
          results: resultRows(
            run.run_id,
            recipient.target_project_id,
            grants.map(({ name }) => name),
            "skipped",
            "target_not_found",
          ),
        });
        continue;
      }
      try {
        if (run.mode === "cleanup") {
          const removed = await removeFromTarget({
            ownership,
            project_id: recipient.target_project_id,
            policy_id: policy.policy_id,
            account_id,
          });
          const removedNames = new Set(removed.removed);
          await recordCourseSecretResults({
            course_project_id: policy.course_project_id,
            results: grants.map(({ name }) => ({
              run_id: run.run_id,
              target_project_id: recipient.target_project_id,
              secret_name: name,
              status: removedNames.has(name) ? "removed" : "unchanged",
              runtime_status: removed.runtime_refresh.status,
            })),
          });
          continue;
        }
        const validation = await targetPreview({
          target_project_id: recipient.target_project_id,
          course_project_id: policy.course_project_id,
          course_path: policy.course_path,
          approved: true,
        });
        if (!validation.eligible) {
          await recordCourseSecretResults({
            course_project_id: policy.course_project_id,
            results: resultRows(
              run.run_id,
              recipient.target_project_id,
              grants.map(({ name }) => name),
              "skipped",
              validation.reason,
            ),
          });
          continue;
        }
        const installed = await installOnTarget({
          ownership,
          project_id: recipient.target_project_id,
          course_project_id: policy.course_project_id,
          course_id: policy.course_id,
          course_path: policy.course_path,
          policy_id: policy.policy_id,
          account_id,
          secrets: sourceSecrets.map((secret) => ({
            name: secret.name,
            value: secret.value,
            source_revision: secret.revision,
            grant_id: grantByName.get(secret.name)!.grant_id,
          })),
        });
        const copied = new Set(installed.copied);
        const conflicts = new Set(installed.conflicts);
        await recordCourseSecretResults({
          course_project_id: policy.course_project_id,
          results: sourceSecrets.map((secret) => ({
            run_id: run.run_id,
            target_project_id: recipient.target_project_id,
            secret_name: secret.name,
            source_revision: secret.revision,
            status: conflicts.has(secret.name)
              ? "conflict"
              : copied.has(secret.name)
                ? "copied"
                : "unchanged",
            error_code: conflicts.has(secret.name)
              ? "target_name_conflict"
              : null,
            runtime_status: installed.runtime_refresh.status,
          })),
        });
      } catch (err) {
        await recordCourseSecretResults({
          course_project_id: policy.course_project_id,
          results: resultRows(
            run.run_id,
            recipient.target_project_id,
            grants.map(({ name }) => name),
            "failed",
            safeErrorCode(err),
          ),
        });
      }
    }
    await finishCourseSecretRun({ run_id: run.run_id, account_id });
  } catch (err) {
    logger.warn("course secret synchronization failed", {
      course_project_id: policy.course_project_id,
      policy_id: policy.policy_id,
      run_id: run.run_id,
      error_code: safeErrorCode(err),
    });
    await finishCourseSecretRun({
      run_id: run.run_id,
      account_id,
      error_code: safeErrorCode(err),
    });
  }
}

export async function startCourseSecretRunLocal(opts: {
  account_id: string;
  course_project_id: string;
  course_id: string;
  course_path: string;
  mode: "sync" | "cleanup";
}): Promise<CourseSecretSyncRun> {
  const snapshot = await beginCourseSecretRun(opts);
  void executeCourseSecretRun(snapshot, opts.account_id);
  return snapshot.run;
}
