/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { isDeepStrictEqual } from "node:util";
import getLogger from "@cocalc/backend/logger";
import getPool from "@cocalc/database/pool";
import { appendProjectOutboxEventForProject } from "@cocalc/database/postgres/project-events-outbox";
import { assertProjectNotRehoming } from "@cocalc/database/postgres/project-rehome-fence";
import type {
  ProjectReconcileCourseManagedProjectRequest,
  ProjectReconcileCourseManagedProjectResult,
} from "@cocalc/conat/inter-bay/api";
import { publishProjectDetailInvalidationBestEffort } from "@cocalc/server/account/project-detail-feed";
import { publishProjectAccountFeedEventsBestEffort } from "@cocalc/server/account/project-feed";
import { syncProjectUsersOnHost } from "@cocalc/server/project-host/control";
import {
  inviteCollaborator,
  inviteCollaboratorWithoutAccount,
} from "@cocalc/server/projects/collaborators";
import { normalizeCoursePath } from "@cocalc/util/course-path";
import { isValidUUID } from "@cocalc/util/misc";

const logger = getLogger("projects:course:reconcile-managed-project");

type ProjectUser = {
  group?: "owner" | "collaborator" | "viewer";
  hide?: boolean;
  [key: string]: unknown;
};

interface ProjectRow {
  users: Record<string, ProjectUser> | null;
  course: Record<string, unknown> | null;
  title: string | null;
  description: string | null;
  env: Record<string, string> | null;
}

function uniqueAccountIds(ids: string[], name: string): string[] {
  const result = new Set<string>();
  for (const raw of ids) {
    const account_id = `${raw ?? ""}`.trim();
    if (!account_id) continue;
    if (!isValidUUID(account_id)) {
      throw new Error(`invalid ${name}: ${account_id}`);
    }
    result.add(account_id);
  }
  return [...result];
}

function sameJson(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(a ?? null, b ?? null);
}

export async function reconcileCourseManagedProjectLocal(
  request: ProjectReconcileCourseManagedProjectRequest,
): Promise<ProjectReconcileCourseManagedProjectResult> {
  const { account_id, course_project_id, project_id, type } = request;
  if (
    !isValidUUID(account_id) ||
    !isValidUUID(course_project_id) ||
    !isValidUUID(project_id)
  ) {
    throw new Error("invalid course reconfiguration identifier");
  }
  const managerAccountIds = uniqueAccountIds(
    request.manager_account_ids,
    "manager account id",
  );
  if (!managerAccountIds.includes(account_id)) {
    throw new Error("course operation creator is no longer a course manager");
  }

  const desiredAccountIds = new Set([
    ...managerAccountIds,
    ...uniqueAccountIds(request.desired_account_ids, "desired account id"),
  ]);
  const course = {
    ...request.course,
    project_id: course_project_id,
    path: normalizeCoursePath(request.course_path),
  };
  const client = await getPool().connect();
  let usersChanged = false;
  let missingDesiredAccountIds: string[] = [];
  const changedFields = new Set<string>();
  try {
    await client.query("BEGIN");
    await assertProjectNotRehoming({
      db: client,
      project_id,
      action: "reconfigure managed course project",
    });
    const { rows } = await client.query<ProjectRow>(
      `SELECT users, course, title, description, env
         FROM projects
        WHERE project_id=$1
          AND deleted IS NULL
        FOR UPDATE`,
      [project_id],
    );
    const row = rows[0];
    if (!row) {
      throw new Error(`project ${project_id} not found on its owning bay`);
    }
    const users = { ...(row.users ?? {}) };
    missingDesiredAccountIds = [...desiredAccountIds].filter(
      (desiredAccountId) =>
        !managerAccountIds.includes(desiredAccountId) &&
        users[desiredAccountId] == null,
    );
    const currentCourse = row.course;
    const currentCourseProjectId = `${currentCourse?.project_id ?? ""}`;
    if (
      currentCourseProjectId &&
      currentCourseProjectId !== course_project_id
    ) {
      throw new Error("project belongs to a different course project");
    }
    const knownManagerOwnsProject = managerAccountIds.some((id) => {
      const group = users[id]?.group;
      return group === "owner" || group === "collaborator";
    });
    if (!currentCourseProjectId && !knownManagerOwnsProject) {
      throw new Error(
        "cannot repair course metadata because no current course manager has project access",
      );
    }

    const preserveStudentCourse =
      type === "nbgrader" && currentCourse?.type === "student";
    const nextCourse = preserveStudentCourse ? currentCourse : course;
    if (!sameJson(row.course, nextCourse)) {
      changedFields.add("course");
    }

    for (const managerAccountId of managerAccountIds) {
      const group = users[managerAccountId]?.group;
      if (group !== "owner" && group !== "collaborator") {
        users[managerAccountId] = {
          ...(users[managerAccountId] ?? {}),
          group: "collaborator",
        };
        usersChanged = true;
      }
    }
    if (users[account_id] && users[account_id].hide !== true) {
      users[account_id] = { ...users[account_id], hide: true };
      usersChanged = true;
    }
    if (!request.allow_collabs) {
      for (const [existingAccountId, info] of Object.entries(users)) {
        if (
          info?.group !== "owner" &&
          !desiredAccountIds.has(existingAccountId)
        ) {
          delete users[existingAccountId];
          usersChanged = true;
        }
      }
    }

    if (request.title !== undefined && row.title !== request.title) {
      changedFields.add("title");
    }
    if (
      request.description !== undefined &&
      row.description !== request.description
    ) {
      changedFields.add("description");
    }
    if (request.env !== undefined && !sameJson(row.env, request.env)) {
      changedFields.add("env");
    }
    if (usersChanged || changedFields.size > 0) {
      await client.query(
        `UPDATE projects
            SET users=$2::jsonb,
                course=$3::jsonb,
                title=COALESCE($4::text, title),
                description=COALESCE($5::text, description),
                env=CASE WHEN $6::boolean THEN $7::jsonb ELSE env END
          WHERE project_id=$1`,
        [
          project_id,
          JSON.stringify(users),
          JSON.stringify(nextCourse),
          request.title ?? null,
          request.description ?? null,
          request.env !== undefined,
          JSON.stringify(request.env ?? null),
        ],
      );
    }
    if (usersChanged) {
      await appendProjectOutboxEventForProject({
        db: client,
        event_type: "project.membership_changed",
        project_id,
      });
    }
    if (changedFields.has("title") || changedFields.has("description")) {
      await appendProjectOutboxEventForProject({
        db: client,
        event_type: "project.summary_changed",
        project_id,
      });
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  if (changedFields.size > 0) {
    await publishProjectDetailInvalidationBestEffort({
      project_id,
      fields: [...changedFields] as any,
    });
  }
  if (usersChanged) {
    await publishProjectAccountFeedEventsBestEffort({ project_id });
    try {
      await syncProjectUsersOnHost({ project_id });
    } catch (err) {
      logger.warn("unable to sync users after course reconfiguration", {
        project_id,
        err: `${err}`,
      });
    }
  }

  for (const desiredAccountId of missingDesiredAccountIds) {
    await inviteCollaborator({
      account_id,
      opts: { project_id, account_id: desiredAccountId },
    });
  }

  let email_invited_at: string | undefined;
  if (
    request.send_email_invite &&
    request.student_email_address &&
    request.invite
  ) {
    const result = await inviteCollaboratorWithoutAccount({
      account_id,
      opts: {
        project_id,
        title: request.title ?? "Course project",
        link2proj: "",
        to: request.student_email_address,
        email: request.invite.email_html,
        subject: request.invite.subject,
        message: request.invite.message,
        replyto: request.invite.reply_to,
        replyto_name: request.invite.reply_to_name,
        invite_base_url: request.invite.base_url,
        invite_scope: "course_student",
        invite_context: {
          course_project_id,
          course_path: request.course_path,
          student_id: request.student_id,
          student_project_id: project_id,
        },
      },
    });
    if (result.invites.length > 0) {
      email_invited_at = new Date().toISOString();
    }
  }
  return { project_id, ...(email_invited_at ? { email_invited_at } : {}) };
}
