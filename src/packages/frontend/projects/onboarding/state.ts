/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { ProjectCollabInviteRow } from "@cocalc/conat/hub/api/projects";

export const FIRST_RUN_ONBOARDING_SETTING = "first_run_onboarding_v1";
export const FIRST_RUN_ONBOARDING_VERSION = 1;

export type OnboardingIntent =
  | "jupyter-python"
  | "jupyter-r"
  | "jupyter-julia"
  | "sage"
  | "code"
  | "codex"
  | "latex"
  | "teaching"
  | "membership-self"
  | "license-team"
  | "license-site"
  | "legacy-restore"
  | "course-invite"
  | "project-invite"
  | "existing-project";

export type StoredFirstRunOnboarding = {
  version: 1;
  status: "in_progress" | "completed" | "dismissed";
  intent?: OnboardingIntent;
  project_id?: string;
  updated_at: string;
};

export type FirstRunProject = {
  project_id: string;
  title?: string;
  course_type?: string;
  last_active?: unknown;
};

export type FirstRunDecision =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "invitations"; invitations: ProjectCollabInviteRow[] }
  | { kind: "ready-projects"; projects: FirstRunProject[] }
  | { kind: "intent" };

export function signUpUsageIntentQuery(intent: OnboardingIntent) {
  return { accounts: { sign_up_usage_intent: intent } };
}

const RECENT_ACCOUNT_MS = 14 * 24 * 60 * 60 * 1000;

export function normalizeStoredFirstRunOnboarding(
  value: unknown,
): StoredFirstRunOnboarding | undefined {
  const raw = (value as any)?.toJS?.() ?? value;
  if (
    raw?.version !== FIRST_RUN_ONBOARDING_VERSION ||
    (raw?.status !== "in_progress" &&
      raw?.status !== "completed" &&
      raw?.status !== "dismissed")
  ) {
    return undefined;
  }
  return raw as StoredFirstRunOnboarding;
}

export function classifyFirstRunOnboarding({
  projects,
  invitations,
  invitesLoading,
  accountCreated,
  saved,
}: {
  projects: FirstRunProject[];
  invitations: ProjectCollabInviteRow[];
  invitesLoading: boolean;
  accountCreated?: Date | string | number;
  saved?: StoredFirstRunOnboarding;
}): FirstRunDecision {
  if (saved?.status === "dismissed") {
    return { kind: "hidden" };
  }
  // A purchase/migration route has no project, so completing it is durable.
  // Project-based onboarding is complete only while the account still has a
  // nondeleted project. If the user deletes their only project, help them
  // start again instead of leaving them at another blank project list.
  if (
    saved?.status === "completed" &&
    (!saved.project_id || projects.length > 0)
  ) {
    return { kind: "hidden" };
  }

  const createdAt = accountCreated ? new Date(accountCreated).valueOf() : 0;
  const recentAccount =
    Number.isFinite(createdAt) && Date.now() - createdAt <= RECENT_ACCOUNT_MS;
  const hasUsedProject = projects.some((project) => !!project.last_active);
  const isFirstSession = recentAccount && !hasUsedProject;

  if (saved?.status === "in_progress" && saved.project_id) {
    const project = projects.find(
      ({ project_id }) => project_id === saved.project_id,
    );
    if (project) return { kind: "ready-projects", projects: [project] };
  }

  // Do not flash onboarding for established users while their invite inbox
  // initializes. New or empty accounts wait so an invitation can take
  // precedence over asking them to create an unrelated project.
  if (invitesLoading && (projects.length === 0 || isFirstSession)) {
    return { kind: "loading" };
  }

  if (invitations.length > 0 && (projects.length === 0 || isFirstSession)) {
    return { kind: "invitations", invitations };
  }
  if (projects.length === 0) {
    return { kind: "intent" };
  }
  if (isFirstSession) {
    return { kind: "ready-projects", projects };
  }
  return { kind: "hidden" };
}

export function isCourseInvitation(invite: ProjectCollabInviteRow): boolean {
  return (
    invite.scope === "course_student" ||
    invite.invite_source === "course_email" ||
    `${invite.context?.course_project_id ?? ""}`.trim().length > 0
  );
}
