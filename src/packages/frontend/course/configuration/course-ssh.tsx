/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Alert, Button, Card, Checkbox, Space, Typography } from "antd";

import {
  FreshAuthModal,
  isFreshAuthRequiredError,
  useFreshAuthAction,
} from "@cocalc/frontend/auth/fresh-auth";
import { useMemo, useRedux, useState } from "@cocalc/frontend/app-framework";
import { Icon } from "@cocalc/frontend/components";
import {
  configureProjectToProjectSsh,
  ensureProjectDeployPublicKey,
  readProjectDeployPublicKey,
  removeProjectToProjectSsh,
  startSshSourceProject,
} from "@cocalc/frontend/project/settings/project-to-project-ssh-service";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import type { CourseActions } from "../actions";
import type { CourseSettingsRecord, StudentsMap } from "../store";

const { Paragraph, Text } = Typography;

interface Props {
  actions: CourseActions;
  name: string;
  project_id: string;
  settings: CourseSettingsRecord;
}

export function CourseSshAccess({
  actions,
  name,
  project_id,
  settings,
}: Props) {
  const students = useRedux(name, "students") as StudentsMap | undefined;
  const enabled = settings.get("ssh_to_student_projects") === true;
  const keyOwnerAccountId = settings.get("ssh_to_student_projects_account_id");
  const ownedByAnotherAccount =
    enabled &&
    !!keyOwnerAccountId &&
    keyOwnerAccountId !== webapp_client.account_id;
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");

  const activeTargetIds = useMemo(() => {
    const ids = new Set<string>();
    if (students) {
      for (const [, student] of students) {
        const target = student.get("project_id");
        if (target && !student.get("deleted")) {
          ids.add(target);
        }
      }
    }
    const sharedProjectId = settings.get("shared_project_id");
    if (sharedProjectId) {
      ids.add(sharedProjectId);
    }
    return [...ids];
  }, [students, settings]);

  const allTargetIds = useMemo(() => {
    const ids = new Set(activeTargetIds);
    if (students) {
      for (const [, student] of students) {
        const target = student.get("project_id");
        if (target) {
          ids.add(target);
        }
      }
    }
    return [...ids];
  }, [activeTargetIds, students]);

  async function synchronize(nextEnabled: boolean): Promise<void> {
    if (ownedByAnotherAccount) {
      setError(
        "The course manager who enabled SSH access must synchronize or disable it. This prevents leaving a second manager's SSH key authorized.",
      );
      return;
    }
    await runFreshAuthAction(async () => {
      setBusy(true);
      setError("");
      setProgress("");
      const configuredTargets: string[] = [];
      let publicKey: string | null = null;
      try {
        await startSshSourceProject(project_id);
        publicKey = nextEnabled
          ? await ensureProjectDeployPublicKey(project_id)
          : await readProjectDeployPublicKey(project_id);
        if (publicKey == null && !nextEnabled) {
          throw new Error(
            "The course SSH public key is missing, so CoCalc cannot identify and revoke it. Repair the SSH deploy key first.",
          );
        }
        const targets = nextEnabled ? activeTargetIds : allTargetIds;
        for (let i = 0; i < targets.length; i += 1) {
          const target_project_id = targets[i];
          setProgress(
            `${nextEnabled ? "Configuring" : "Revoking"} project ${i + 1} of ${targets.length}`,
          );
          if (nextEnabled) {
            await configureProjectToProjectSsh({
              source_project_id: project_id,
              target_project_id,
              public_key: publicKey!,
            });
            configuredTargets.push(target_project_id);
          } else {
            await removeProjectToProjectSsh({
              source_project_id: project_id,
              target_project_id,
              public_key: publicKey!,
            });
          }
        }
        actions.configuration.set_course_ssh_enabled(
          nextEnabled,
          nextEnabled ? webapp_client.account_id : undefined,
        );
        setProgress(
          nextEnabled
            ? `SSH access synchronized with ${targets.length} project${targets.length === 1 ? "" : "s"}.`
            : "Course SSH access revoked.",
        );
      } catch (err) {
        if (isFreshAuthRequiredError(err)) {
          throw err;
        }
        let rollbackError = "";
        if (nextEnabled && publicKey != null) {
          for (const target_project_id of configuredTargets.reverse()) {
            try {
              await removeProjectToProjectSsh({
                source_project_id: project_id,
                target_project_id,
                public_key: publicKey,
              });
            } catch (rollbackErr) {
              rollbackError = ` Cleanup also failed for ${target_project_id}: ${
                (rollbackErr as any)?.message ?? rollbackErr
              }`;
              break;
            }
          }
        }
        setError(`${(err as any)?.message ?? err}.${rollbackError}`);
      } finally {
        setBusy(false);
      }
    });
  }

  return (
    <>
      <Card
        title={
          <>
            <Icon name="terminal" /> SSH to course projects
          </>
        }
      >
        <Space vertical size="middle" style={{ width: "100%" }}>
          <Checkbox
            checked={enabled}
            disabled={busy || ownedByAnotherAccount}
            onChange={(event) => void synchronize(event.target.checked)}
          >
            Allow this course project to SSH to every student project and the
            shared project
          </Checkbox>
          <Paragraph style={{ margin: 0 }}>
            CoCalc creates one deploy key in this project, authorizes its public
            key in each managed project, and writes project aliases to{" "}
            <Text code>~/.ssh/config</Text>. Connect with{" "}
            <Text code>ssh STUDENT_PROJECT_ID</Text>.
          </Paragraph>
          <Alert
            type="warning"
            showIcon
            title="This grants full shell access"
            description="Every collaborator who can use this course project's files can use its deploy key. Only enable this when all course project collaborators should have access to every managed project."
          />
          {enabled ? (
            <Button
              disabled={ownedByAnotherAccount}
              loading={busy}
              onClick={() => void synchronize(true)}
            >
              Synchronize SSH access
            </Button>
          ) : null}
          {ownedByAnotherAccount ? (
            <Alert
              type="warning"
              showIcon
              title="Managed by another course collaborator"
              description="The account that enabled this deploy key must synchronize or revoke it, since project SSH keys are owned by the account that installs them."
            />
          ) : null}
          {progress ? <Alert type="info" showIcon title={progress} /> : null}
          {error ? <Alert type="error" showIcon title={error} /> : null}
        </Space>
      </Card>
      <FreshAuthModal {...freshAuthModalProps} />
    </>
  );
}
