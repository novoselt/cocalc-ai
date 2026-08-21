/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Alert, Tag, Typography } from "antd";

import { appBasePath } from "@cocalc/frontend/customize/app-base-path";
import { useProjectRunQuota } from "@cocalc/frontend/project/use-project-run-quota";
import { joinUrlPath } from "@cocalc/util/url-path";

const { Text } = Typography;

export function formatBrowserIdleTimeout(seconds: number): {
  clock: string;
  description: string;
} {
  const normalized = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(normalized / 3600);
  const minutes = Math.floor((normalized % 3600) / 60);
  const remainingSeconds = normalized % 60;
  const clock = hours
    ? `${hours}:${`${minutes}`.padStart(2, "0")}:${`${remainingSeconds}`.padStart(2, "0")}`
    : `${minutes}:${`${remainingSeconds}`.padStart(2, "0")}`;
  const description =
    normalized % 3600 === 0
      ? `${normalized / 3600} hour${normalized === 3600 ? "" : "s"}`
      : normalized % 60 === 0
        ? `${normalized / 60} minute${normalized === 60 ? "" : "s"}`
        : `${normalized} seconds`;
  return { clock, description };
}

export function BrowserRuntimeLimitBanner({
  timeoutSeconds,
}: {
  timeoutSeconds: number;
}) {
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) return null;
  const timeout = formatBrowserIdleTimeout(timeoutSeconds);
  return (
    <Alert
      banner
      showIcon
      type="info"
      style={{ padding: "6px 12px" }}
      title={
        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <Text strong>Free project runtime</Text>
          <Tag aria-label={`Browser idle timeout ${timeout.clock}`}>
            {timeout.clock}
          </Tag>
          <Text>
            This browser keeps the project running. If no authenticated CoCalc
            browser tab has it open for {timeout.description}, CoCalc stops the
            runtime; files are preserved.{" "}
            <a href={joinUrlPath(appBasePath, "settings", "membership")}>
              Upgrade for background runtime
            </a>
          </Text>
        </div>
      }
    />
  );
}

export default function ProjectBrowserRuntimeLimitBanner({
  project_id,
}: {
  project_id: string;
}) {
  const { runQuota } = useProjectRunQuota(project_id);
  const value =
    (runQuota as any)?.get?.("browser_idle_timeout") ??
    (runQuota as any)?.browser_idle_timeout;
  const timeoutSeconds = Number(value);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) return null;
  return <BrowserRuntimeLimitBanner timeoutSeconds={timeoutSeconds} />;
}
