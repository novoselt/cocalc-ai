/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Alert, Button, Modal, Space, Typography } from "antd";
import { useState } from "react";

import { compute_fingerprint } from "@cocalc/frontend/account/ssh-keys/fingerprint";
import { redux } from "@cocalc/frontend/app-framework";
import {
  FreshAuthModal,
  useFreshAuthAction,
} from "@cocalc/frontend/auth/fresh-auth";
import { SelectProject } from "@cocalc/frontend/projects/select-project";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import { PROJECT_SECRETS_SSH_PRIVATE_KEY_NAME } from "@cocalc/util/project-secrets-constants";
import {
  INSTALL_CLOUDFLARED_SCRIPT,
  parseSshPublicKey,
  projectSshConfigBlock,
  upsertProjectSshConfigBlock,
} from "./project-to-project-ssh-config";

const { Paragraph, Text } = Typography;
const PUBLIC_KEY_PATH = ".ssh/id_ed25519.pub";
const SSH_CONFIG_PATH = ".ssh/config";

function isMissingFileError(error: unknown): boolean {
  const message = `${(error as any)?.message ?? error ?? ""}`.toLowerCase();
  return (
    message.includes("enoent") ||
    message.includes("not found") ||
    message.includes("no such file")
  );
}

async function startSourceProject(project_id: string): Promise<void> {
  await redux.getActions("projects").start_project(project_id, {
    waitForStart: true,
    waitTimeoutMs: 120_000,
  });
}

async function readSourcePublicKey(project_id: string): Promise<string | null> {
  try {
    return await webapp_client.project_client.read_text_file({
      project_id,
      path: PUBLIC_KEY_PATH,
    });
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

async function readSourceSshConfig(project_id: string): Promise<string> {
  try {
    return await webapp_client.project_client.read_text_file({
      project_id,
      path: SSH_CONFIG_PATH,
    });
  } catch (error) {
    if (isMissingFileError(error)) {
      return "";
    }
    throw error;
  }
}

async function configureSourceProject({
  source_project_id,
  target_project_id,
  route,
}: {
  source_project_id: string;
  target_project_id: string;
  route: Awaited<
    ReturnType<
      typeof webapp_client.conat_client.hub.projects.resolveProjectSshConnection
    >
  >;
}): Promise<void> {
  if (route.transport !== "direct") {
    await webapp_client.project_client.exec({
      project_id: source_project_id,
      command: "bash",
      args: ["-c", INSTALL_CLOUDFLARED_SCRIPT],
      timeout: 120,
    });
  }
  const block = projectSshConfigBlock({
    alias: target_project_id,
    route,
  });
  const existing = await readSourceSshConfig(source_project_id);
  await webapp_client.project_client.write_text_file({
    project_id: source_project_id,
    path: SSH_CONFIG_PATH,
    content: upsertProjectSshConfigBlock({
      content: existing,
      alias: target_project_id,
      block,
    }),
  });
  await webapp_client.project_client.exec({
    project_id: source_project_id,
    command: "bash",
    args: ["-c", 'chmod 700 "$HOME/.ssh" && chmod 600 "$HOME/.ssh/config"'],
  });
}

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
      await startSourceProject(source_project_id);
      let publicKey = await readSourcePublicKey(source_project_id);
      const route =
        await webapp_client.conat_client.hub.projects.resolveProjectSshConnection(
          {
            project_id: target_project_id,
          },
        );
      const completed = await runFreshAuthAction(async () => {
        if (publicKey == null) {
          const secrets =
            await webapp_client.conat_client.hub.projects.listProjectSecrets({
              project_id: source_project_id,
            });
          if (
            secrets.some(
              ({ name }) => name === PROJECT_SECRETS_SSH_PRIVATE_KEY_NAME,
            )
          ) {
            throw new Error(
              `The source project has ${PROJECT_SECRETS_SSH_PRIVATE_KEY_NAME}, but ${PUBLIC_KEY_PATH} is missing. Open its Secrets settings to repair the SSH deploy key.`,
            );
          }
          const generated =
            await webapp_client.conat_client.hub.projects.generateProjectSshKeySecret(
              {
                browser_id: webapp_client.browser_id,
                project_id: source_project_id,
              },
            );
          publicKey = generated.public_key;
        }
        const parsed = parseSshPublicKey(publicKey);
        await configureSourceProject({
          source_project_id,
          target_project_id,
          route,
        });
        await redux.getActions("projects").add_ssh_key_to_project({
          project_id: target_project_id,
          fingerprint: compute_fingerprint(parsed.base64),
          title: `SSH from project ${source_project_id}`,
          value: parsed.value,
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
