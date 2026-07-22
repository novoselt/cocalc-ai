/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/**
 * Toggle buttons for switching between regular and minimal notebook frames.
 */

import { Button } from "antd";

import { Icon, Tooltip } from "@cocalc/frontend/components";
import { useFrameContext } from "@cocalc/frontend/frame-editors/frame-tree/frame-context";

function hasFrameOfType(actions: any, type: string): boolean {
  const leafIds = actions?._get_leaf_ids?.() ?? {};
  for (const id in leafIds) {
    if (actions._get_frame_type(id) === type) {
      return true;
    }
  }
  return false;
}

function isMultiFrame(actions: any): boolean {
  return Object.keys(actions?._get_leaf_ids?.() ?? {}).length > 1;
}

export function SwitchToMinimalButton() {
  const { actions, id } = useFrameContext();

  if (isMultiFrame(actions) && hasFrameOfType(actions, "jupyter_minimal")) {
    return null;
  }

  return (
    <Tooltip title="Switch this notebook frame to minimal mode. You can switch back any time.">
      <Button
        type="text"
        size="small"
        onClick={() => actions.set_frame_type(id, "jupyter_minimal")}
      >
        <Icon name="swap" /> Minimal
      </Button>
    </Tooltip>
  );
}

export function SwitchToRegularButton() {
  const { actions, id } = useFrameContext();

  if (
    isMultiFrame(actions) &&
    hasFrameOfType(actions, "jupyter_cell_notebook")
  ) {
    return null;
  }

  return (
    <Tooltip title="Switch this notebook frame back to the regular Jupyter notebook view.">
      <Button
        type="text"
        size="small"
        onClick={() => actions.set_frame_type(id, "jupyter_cell_notebook")}
      >
        <Icon name="swap" /> Regular
      </Button>
    </Tooltip>
  );
}
