/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { compute_fingerprint } from "@cocalc/frontend/account/ssh-keys/fingerprint";
import { redux } from "@cocalc/frontend/app-framework";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import { PROJECT_SECRETS_SSH_PRIVATE_KEY_NAME } from "@cocalc/util/project-secrets-constants";
import {
  INSTALL_CLOUDFLARED_SCRIPT,
  parseSshPublicKey,
  projectSshConfigBlock,
  removeProjectSshConfigBlock,
  upsertProjectSshConfigBlock,
} from "./project-to-project-ssh-config";

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

export async function startSshSourceProject(project_id: string): Promise<void> {
  await redux.getActions("projects").start_project(project_id, {
    waitForStart: true,
    waitTimeoutMs: 120_000,
  });
}

export async function readProjectDeployPublicKey(
  project_id: string,
): Promise<string | null> {
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

async function writeSourceSshConfig({
  project_id,
  content,
}: {
  project_id: string;
  content: string;
}): Promise<void> {
  await webapp_client.project_client.write_text_file({
    project_id,
    path: SSH_CONFIG_PATH,
    content,
  });
  await webapp_client.project_client.exec({
    project_id,
    command: "bash",
    args: ["-c", 'chmod 700 "$HOME/.ssh" && chmod 600 "$HOME/.ssh/config"'],
  });
}

export async function ensureProjectDeployPublicKey(
  source_project_id: string,
): Promise<string> {
  let publicKey = await readProjectDeployPublicKey(source_project_id);
  if (publicKey != null) {
    return publicKey;
  }
  const secrets =
    await webapp_client.conat_client.hub.projects.listProjectSecrets({
      project_id: source_project_id,
    });
  if (
    secrets.some(({ name }) => name === PROJECT_SECRETS_SSH_PRIVATE_KEY_NAME)
  ) {
    throw new Error(
      `The source project has ${PROJECT_SECRETS_SSH_PRIVATE_KEY_NAME}, but ${PUBLIC_KEY_PATH} is missing. Open its Secrets settings to repair the SSH deploy key.`,
    );
  }
  const generated =
    await webapp_client.conat_client.hub.projects.generateProjectSshKeySecret({
      browser_id: webapp_client.browser_id,
      project_id: source_project_id,
    });
  return generated.public_key;
}

export async function configureProjectToProjectSsh({
  source_project_id,
  target_project_id,
  public_key,
}: {
  source_project_id: string;
  target_project_id: string;
  public_key: string;
}): Promise<void> {
  const route =
    await webapp_client.conat_client.hub.projects.resolveProjectSshConnection({
      project_id: target_project_id,
    });
  if (route.transport !== "direct") {
    await webapp_client.project_client.exec({
      project_id: source_project_id,
      command: "bash",
      args: ["-c", INSTALL_CLOUDFLARED_SCRIPT],
      timeout: 120,
    });
  }
  const parsed = parseSshPublicKey(public_key);
  const existing = await readSourceSshConfig(source_project_id);
  await writeSourceSshConfig({
    project_id: source_project_id,
    content: upsertProjectSshConfigBlock({
      content: existing,
      alias: target_project_id,
      block: projectSshConfigBlock({
        alias: target_project_id,
        route,
      }),
    }),
  });
  await redux.getActions("projects").add_ssh_key_to_project({
    project_id: target_project_id,
    fingerprint: compute_fingerprint(parsed.base64),
    title: `SSH from project ${source_project_id}`,
    value: parsed.value,
  });
}

export async function removeProjectToProjectSsh({
  source_project_id,
  target_project_id,
  public_key,
}: {
  source_project_id: string;
  target_project_id: string;
  public_key: string;
}): Promise<void> {
  const parsed = parseSshPublicKey(public_key);
  await redux.getActions("projects").delete_ssh_key_from_project({
    project_id: target_project_id,
    fingerprint: compute_fingerprint(parsed.base64),
  });
  const existing = await readSourceSshConfig(source_project_id);
  await writeSourceSshConfig({
    project_id: source_project_id,
    content: removeProjectSshConfigBlock({
      content: existing,
      alias: target_project_id,
    }),
  });
}
