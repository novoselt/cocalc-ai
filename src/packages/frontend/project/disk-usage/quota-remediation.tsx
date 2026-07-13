/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { Alert, Button, Space } from "antd";
import { openAccountSettings } from "@cocalc/frontend/account/settings-routing";
import { redux } from "@cocalc/frontend/app-framework";
import openSupportTab from "@cocalc/frontend/support/open";
import { SNAPSHOTS } from "@cocalc/util/consts/snapshots";
import { DEFAULT_PROJECT_RUNTIME_HOME } from "@cocalc/util/project-runtime";

export function ProjectDiskQuotaRemediation({
  project_id,
  technical,
  onNavigate,
}: {
  project_id: string;
  technical?: string;
  onNavigate?: () => void;
}) {
  function manageFiles() {
    const actions = redux.getProjectActions(project_id);
    actions.set_current_path(DEFAULT_PROJECT_RUNTIME_HOME);
    actions.set_active_tab("files");
    onNavigate?.();
  }

  async function manageSnapshots() {
    await redux.getProjectActions(project_id).open_directory(SNAPSHOTS);
    onNavigate?.();
  }

  function upgradeMembership() {
    openAccountSettings({ page: "membership" });
    onNavigate?.();
  }

  function contactSupport() {
    openSupportTab({
      subject: "Request more project storage",
      body: `I need help with the storage quota for project ${project_id}.`,
    });
    onNavigate?.();
  }

  return (
    <Alert
      showIcon
      type="error"
      title="Project storage is full or nearly full"
      description={
        <div>
          <div>
            CoCalc cannot safely start this project without a small amount of
            free space for filesystem metadata. You do not need to start the
            project to browse, download, or delete files and snapshots.
          </div>
          <div style={{ marginTop: "8px" }}>
            Deleted or modified files may still occupy space in snapshots, so
            review both current files and snapshots. You can also upgrade your
            membership, or contact support if your work has a legitimate need
            for a higher quota.
          </div>
          <Space size={8} wrap style={{ marginTop: "12px" }}>
            <Button onClick={manageFiles} size="small" type="primary">
              Manage files
            </Button>
            <Button onClick={() => void manageSnapshots()} size="small">
              Manage snapshots
            </Button>
            <Button onClick={upgradeMembership} size="small">
              Upgrade membership
            </Button>
            <Button onClick={contactSupport} size="small">
              Contact support
            </Button>
          </Space>
          {technical && (
            <details style={{ fontSize: "12px", marginTop: "10px" }}>
              <summary>Technical details</summary>
              <pre
                style={{
                  marginBottom: 0,
                  maxHeight: "160px",
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                }}
              >
                {technical}
              </pre>
            </details>
          )}
        </div>
      }
    />
  );
}
