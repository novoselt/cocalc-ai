/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  Alert,
  Button,
  Flex,
  Modal,
  Popconfirm,
  Typography,
  theme,
} from "antd";
import { useState } from "react";
import { Icon } from "@cocalc/frontend/components";
import { exec } from "@cocalc/frontend/frame-editors/generic/client";
import {
  BLIT_APPLICATIONS,
  CHECK_BLIT_APPLICATION_COMMAND,
  INSTALL_BLIT_APPLICATION_COMMAND,
  LAUNCH_BLIT_APPLICATION_COMMAND,
  type BlitApplication,
  type BlitApplicationInstall,
  parseBlitApplicationAvailability,
} from "./blit-applications";

interface Props {
  onShutdown?: () => Promise<void>;
  project_id: string;
  shuttingDown?: boolean;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : `${err}`;
}

function installExecArgs(install: BlitApplicationInstall): string[] {
  if (install.kind === "script") {
    return ["-c", install.command, "cocalc-blit-install"];
  }
  return [
    "-c",
    INSTALL_BLIT_APPLICATION_COMMAND,
    "cocalc-blit-install",
    ...install.packages,
  ];
}

export function BlitLauncher({
  onShutdown,
  project_id,
  shuttingDown = false,
}: Props) {
  const { token } = theme.useToken();
  const [busyAppId, setBusyAppId] = useState<string>();
  const [installedAppIds, setInstalledAppIds] = useState<Set<string>>(
    () => new Set(["terminal"]),
  );
  const [installApp, setInstallApp] = useState<BlitApplication>();
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  function rememberInstalled(app: BlitApplication): void {
    setInstalledAppIds((current) => new Set(current).add(app.id));
  }

  async function runApplication(app: BlitApplication): Promise<void> {
    const result = await exec({
      project_id,
      command: "bash",
      args: [
        "-c",
        LAUNCH_BLIT_APPLICATION_COMMAND,
        "cocalc-blit-launch",
        app.id,
        ...app.command,
      ],
      timeout: 30,
      err_on_exit: true,
    });
    if (result.exit_code !== 0) {
      throw new Error(result.stderr || `Unable to launch ${app.label}.`);
    }
    setStatus(`${app.label} launched.`);
  }

  async function launch(app: BlitApplication): Promise<void> {
    if (busyAppId || installing) return;
    setBusyAppId(app.id);
    setError(undefined);
    setStatus(undefined);
    try {
      if (app.executable && !installedAppIds.has(app.id)) {
        const result = await exec({
          project_id,
          command: "bash",
          args: [
            "-c",
            CHECK_BLIT_APPLICATION_COMMAND,
            "cocalc-blit-check",
            app.executable,
          ],
          timeout: 30,
          err_on_exit: true,
        });
        const availability = parseBlitApplicationAvailability(
          `${result.stdout}\n${result.stderr}`,
        );
        if (availability === "missing") {
          if (!app.install) {
            throw new Error(`${app.label} is not installed in this project.`);
          }
          setInstallError(undefined);
          setInstallApp(app);
          return;
        }
        rememberInstalled(app);
      }
      await runApplication(app);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyAppId(undefined);
    }
  }

  async function installAndLaunch(): Promise<void> {
    const app = installApp;
    if (!app?.install || installing) return;
    setInstalling(true);
    setInstallError(undefined);
    try {
      const result = await exec({
        project_id,
        command: "bash",
        args: installExecArgs(app.install),
        timeout: 30 * 60,
        err_on_exit: true,
      });
      if (result.exit_code !== 0) {
        throw new Error(result.stderr || `Unable to install ${app.label}.`);
      }
      rememberInstalled(app);
      setInstallApp(undefined);
      setBusyAppId(app.id);
      await runApplication(app);
    } catch (err) {
      setInstallError(errorMessage(err));
    } finally {
      setBusyAppId(undefined);
      setInstalling(false);
    }
  }

  async function shutdown(): Promise<void> {
    if (!onShutdown || busyAppId || installing || shuttingDown) return;
    setError(undefined);
    setStatus(undefined);
    try {
      await onShutdown();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <div
        style={{
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flex: "0 0 auto",
          minWidth: 0,
          padding: "4px 8px",
        }}
      >
        <Flex
          aria-label="Graphical application launcher"
          gap={4}
          role="toolbar"
          style={{ overflowX: "auto", paddingBottom: 1 }}
        >
          {BLIT_APPLICATIONS.map((app) => (
            <Button
              disabled={
                (busyAppId != null && busyAppId !== app.id) ||
                installing ||
                shuttingDown
              }
              icon={
                <span aria-hidden="true">
                  <Icon name={app.icon} />
                </span>
              }
              key={app.id}
              loading={busyAppId === app.id}
              onClick={() => void launch(app)}
              size="small"
              style={{ flex: "0 0 auto" }}
            >
              {app.label}
            </Button>
          ))}
          {onShutdown && (
            <Popconfirm
              cancelText="Cancel"
              description="This closes every graphical window and terminal in the shared project session for all connected browsers."
              okButtonProps={{ danger: true }}
              okText="Shut down"
              onConfirm={shutdown}
              title="Shut down graphical applications?"
            >
              <Button
                danger
                disabled={busyAppId != null || installing}
                loading={shuttingDown}
                size="small"
                style={{ flex: "0 0 auto", marginInlineStart: "auto" }}
              >
                Shut down
              </Button>
            </Popconfirm>
          )}
        </Flex>
        {(status || error) && (
          <Typography.Text
            aria-live="polite"
            role={error ? "alert" : "status"}
            style={{
              color: error ? token.colorError : token.colorTextSecondary,
              display: "block",
              marginTop: 2,
            }}
          >
            {error ?? status}
          </Typography.Text>
        )}
      </div>
      <Modal
        cancelButtonProps={{ disabled: installing }}
        cancelText="Cancel"
        closable={!installing}
        mask={{ closable: !installing }}
        okButtonProps={{ loading: installing }}
        okText={`Install ${installApp?.label ?? "application"}`}
        onCancel={() => {
          if (!installing) {
            setInstallApp(undefined);
            setInstallError(undefined);
          }
        }}
        onOk={() => void installAndLaunch()}
        open={installApp != null}
        title={`Install ${installApp?.label ?? "application"}?`}
      >
        {installApp && (
          <Flex gap="small" vertical>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              {installApp.description}
            </Typography.Paragraph>
            {installApp.install?.kind === "apt" ? (
              <Typography.Text>
                This installs the Ubuntu package
                {installApp.install.packages.length === 1 ? "" : "s"}{" "}
                <Typography.Text code>
                  {installApp.install.packages.join(" ")}
                </Typography.Text>{" "}
                in this project, then launches the application.
              </Typography.Text>
            ) : (
              <Typography.Text>{installApp.install?.summary}</Typography.Text>
            )}
            {installError && (
              <Alert
                description={installError}
                showIcon
                title={`Unable to install ${installApp.label}`}
                type="error"
              />
            )}
          </Flex>
        )}
      </Modal>
    </>
  );
}
