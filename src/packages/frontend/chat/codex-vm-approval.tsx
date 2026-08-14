/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Alert, Button, Space, Typography } from "antd";
import type { ComputeAgentGrant } from "@cocalc/conat/hub/api/compute";
import { useEffect, useState } from "@cocalc/frontend/app-framework";
import { projectFileBasePath } from "@cocalc/frontend/lib/cocalc-urls";
import { webapp_client } from "@cocalc/frontend/webapp-client";

const { Text } = Typography;
const AGENT_GRANT_POLL_MS = 2_000;

function pendingGrant(
  grants: ComputeAgentGrant[],
): ComputeAgentGrant | undefined {
  return grants.find((grant) => grant.metadata?.pending_request != null);
}

export function CodexVmApprovalPrompt({
  projectId,
  active,
}: {
  projectId?: string;
  active: boolean;
}) {
  const [grant, setGrant] = useState<ComputeAgentGrant>();

  useEffect(() => {
    if (!active || !projectId) {
      setGrant(undefined);
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const grants =
          await webapp_client.conat_client.hub.compute.listAgentGrants({
            project_id: projectId,
          });
        if (!disposed) setGrant(pendingGrant(grants));
      } catch {
        // The terminal command still reports the request if this optional UI
        // shortcut cannot reach the control plane.
      } finally {
        if (!disposed)
          timer = setTimeout(() => void poll(), AGENT_GRANT_POLL_MS);
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [active, projectId]);

  if (!grant || !projectId) return null;
  const request = grant.metadata?.pending_request ?? {};
  const operation = `${request.operation ?? request.action ?? "VM action"}`;
  const approvalUrl = `${projectFileBasePath(projectId)}/vms?agent_grant=${encodeURIComponent(grant.grant_id)}`;

  return (
    <Alert
      showIcon
      type="warning"
      title="Codex needs VM approval"
      description={
        <Space direction="vertical" size={8}>
          <Text>
            Review the {operation} request. The running CLI command will
            continue automatically after approval.
          </Text>
          <Button type="primary" href={approvalUrl} target="_blank">
            Review and approve VM access
          </Button>
        </Space>
      }
      style={{ marginBottom: 8 }}
    />
  );
}
