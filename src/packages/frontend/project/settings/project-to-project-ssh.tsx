/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Alert, Button, Modal, Space, Typography } from "antd";
import { useState } from "react";

import {
  FreshAuthModal,
  useFreshAuthAction,
} from "@cocalc/frontend/auth/fresh-auth";
import { SelectProject } from "@cocalc/frontend/projects/select-project";
import {
  configureProjectToProjectSsh,
  ensureProjectDeployPublicKey,
  startSshSourceProject,
} from "./project-to-project-ssh-service";

const { Paragraph, Text } = Typography;

export function ProjectToProjectSsh({
  target_project_id,
}: {
  target_project_id: string;
}) {
  const [open, setOpen] = useState(false);
  const [sourceProjectId, setSourceProjectId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [command, setCommand] = useState("");
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction();

  async function setup(): Promise<void> {
    const source_project_id = sourceProjectId.trim();
    if (!source_project_id) {
      setError("Select the project that will initiate SSH connections.");
      return;
    }
    setSaving(true);
    setError("");
    setCommand("");
    try {
      await startSshSourceProject(source_project_id);
      const completed = await runFreshAuthAction(async () => {
        const publicKey = await ensureProjectDeployPublicKey(source_project_id);
        await configureProjectToProjectSsh({
          source_project_id,
          target_project_id,
          public_key: publicKey,
        });
      });
      if (completed) {
        setCommand(`ssh ${target_project_id}`);
      }
    } catch (err) {
      setError(`${(err as any)?.message ?? err}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        Configure project-to-project SSH
      </Button>
      <Modal
        open={open}
        title="Connect from another CoCalc project"
        onCancel={() => setOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setOpen(false)}>Close</Button>
            <Button
              type="primary"
              loading={saving}
              disabled={!sourceProjectId}
              onClick={() => void setup()}
            >
              Configure SSH
            </Button>
          </Space>
        }
        width={720}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Paragraph>
            Select the source project that should be able to SSH to this
            project. CoCalc creates or reuses a dedicated key in the source,
            authorizes its public key here, and writes the source project&apos;s{" "}
            <Text code>~/.ssh/config</Text>. Your CoCalc account login is never
            stored in either project.
          </Paragraph>
          <Alert
            type="warning"
            showIcon
            message="Source project collaborators receive this access"
            description="Anyone who can read files in the source project can use its deploy key. Remove the corresponding project SSH key here to revoke access."
          />
          <SelectProject
            exclude={[target_project_id]}
            fullCollaboratorOnly
            value={sourceProjectId || undefined}
            onChange={(project_id) => {
              setSourceProjectId(project_id ?? "");
              setError("");
              setCommand("");
            }}
          />
          {error ? <Alert type="error" showIcon message={error} /> : null}
          {command ? (
            <Alert
              type="success"
              showIcon
              message="Project-to-project SSH configured"
              description={
                <>
                  In the source project, run <Text code>{command}</Text>.
                </>
              }
            />
          ) : null}
        </Space>
      </Modal>
      <FreshAuthModal {...freshAuthModalProps} />
    </>
  );
}
