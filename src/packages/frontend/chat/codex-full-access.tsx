/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Alert } from "antd";

export function CodexFullAccessNotice() {
  return (
    <Alert
      type="info"
      showIcon
      message="Codex has full access to this project"
      description={
        <>
          Codex can read and modify files, run commands, install software, and
          use the network inside this CoCalc project. CoCalc projects are
          already isolated Linux environments with snapshots and backups, so
          Codex runs with full project access instead of adding another sandbox
          layer.
        </>
      }
    />
  );
}
