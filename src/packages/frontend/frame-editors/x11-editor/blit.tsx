/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Alert, Button, Flex, Spin, Typography } from "antd";
import { useEffect, useState } from "react";
import type { AppSpec } from "@cocalc/conat/project/api/apps";
import { exec } from "@cocalc/frontend/frame-editors/generic/client";
import { getProjectAppOpenUrl } from "@cocalc/frontend/project/app-server-open";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import {
  addBlitPassphrase,
  BLIT_APP_ID,
  createBlitAppSpec,
  INSTALL_BLIT_COMMAND,
} from "./blit-app";

interface Props {
  is_current: boolean;
  project_id: string;
  reload?: number;
}

type Stage = "starting" | "installing" | "ready";

export function Blit({ is_current, project_id, reload }: Props) {
  const [stage, setStage] = useState<Stage>("starting");
  const [error, setError] = useState<string>();
  const [src, setSrc] = useState<string>();
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let canceled = false;
    setStage("starting");
    setError(undefined);
    setSrc(undefined);
    void (async () => {
      const api = webapp_client.conat_client.projectApi({ project_id });
      const saved = await api.apps.upsertAppSpec(createBlitAppSpec());
      const spec = saved.spec as AppSpec;
      const status = await api.apps.ensureRunning(BLIT_APP_ID, {
        timeout: 60_000,
        interval: 500,
      });
      const url = await getProjectAppOpenUrl({
        getSpec: async () => spec,
        project_id,
        spec,
        status,
      });
      if (!url) {
        throw new Error("Blit started but CoCalc did not provide an app URL.");
      }
      if (!canceled) {
        setSrc(addBlitPassphrase(url));
        setStage("ready");
      }
    })().catch((err) => {
      if (!canceled) {
        setError(`${err}`);
      }
    });
    return () => {
      canceled = true;
    };
  }, [project_id, reload, retry]);

  async function install(): Promise<void> {
    setStage("installing");
    setError(undefined);
    try {
      const result = await exec({
        project_id,
        command: "bash",
        args: ["-lc", INSTALL_BLIT_COMMAND],
        timeout: 180,
        err_on_exit: true,
      });
      if (result.exit_code !== 0) {
        throw new Error(result.stderr || "Blit installation failed.");
      }
      setRetry((value) => value + 1);
    } catch (err) {
      setError(`${err}`);
      setStage("starting");
    }
  }

  if (src) {
    return (
      <iframe
        allow="autoplay; camera; clipboard-read; clipboard-write; fullscreen; microphone"
        aria-label="Blit graphical applications"
        key={src}
        src={src}
        style={{
          border: 0,
          display: is_current ? "block" : "none",
          height: "100%",
          width: "100%",
        }}
        title="Blit graphical applications"
      />
    );
  }

  return (
    <Flex
      align="center"
      justify="center"
      style={{ height: "100%", padding: 24 }}
      vertical
    >
      {error ? (
        <Alert
          action={
            <Flex gap="small" vertical>
              <Button onClick={() => setRetry((value) => value + 1)}>
                Retry
              </Button>
              <Button loading={stage === "installing"} onClick={install}>
                Install stock Blit
              </Button>
            </Flex>
          }
          description={
            <>
              <Typography.Paragraph>
                This prototype requires the stock Blit binary in the project.
                Installation uses Blit&apos;s official installer and writes to
                <Typography.Text code>~/.local/bin</Typography.Text>.
              </Typography.Paragraph>
              <Typography.Text code>{INSTALL_BLIT_COMMAND}</Typography.Text>
            </>
          }
          message="Unable to start graphical applications"
          showIcon
          type="error"
        />
      ) : (
        <Flex align="center" gap="middle" vertical>
          <Spin size="large" />
          <Typography.Text>
            {stage === "installing"
              ? "Installing stock Blit..."
              : "Starting the Blit Wayland compositor..."}
          </Typography.Text>
        </Flex>
      )}
    </Flex>
  );
}
