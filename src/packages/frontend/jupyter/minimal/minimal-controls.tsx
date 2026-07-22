/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/**
 * Right-hand controls of the compact kernel header while a notebook frame is
 * in minimal mode: layout width Segmented, Zen switch, help popover, and the
 * switch back to the regular notebook view.
 */

import { Segmented, Switch } from "antd";

import { Icon, Tooltip } from "@cocalc/frontend/components";
import { COLORS } from "@cocalc/util/theme";
import { SwitchToRegularButton } from "./frame-type-toggle";
import MinimalNotebookHelp from "./minimal-help";
import type { MinimalLayout } from "./types";

interface MinimalControlsProps {
  minimalLayout?: MinimalLayout;
  availableLayouts?: readonly MinimalLayout[];
  onLayoutChange: (layout: MinimalLayout) => void;
  zenMode?: boolean;
  onZenModeChange?: (zen: boolean) => void;
}

function Divider() {
  return (
    <div
      style={{
        borderLeft: `1px solid ${COLORS.GRAY_L}`,
        height: "18px",
      }}
    />
  );
}

export function MinimalControls({
  minimalLayout,
  availableLayouts,
  onLayoutChange,
  zenMode,
  onZenModeChange,
}: MinimalControlsProps) {
  return (
    <>
      <Divider />
      <Segmented
        size="small"
        className="minimal-status-segmented"
        value={minimalLayout ?? "comfortable"}
        onChange={(v) => onLayoutChange(v as MinimalLayout)}
        options={[
          {
            value: "wide",
            label: (
              <Tooltip title="Full width">
                <Icon name="column-width" />
              </Tooltip>
            ),
          },
          {
            value: "comfortable",
            disabled: !availableLayouts?.includes("comfortable"),
            label: (
              <Tooltip title="Comfortable width">
                <Icon name="pic-centered" rotate="90" />
              </Tooltip>
            ),
          },
          {
            value: "narrow",
            disabled: !availableLayouts?.includes("narrow"),
            label: (
              <Tooltip title="Narrow, centered">
                <Icon name="vertical-align-middle" rotate="90" />
              </Tooltip>
            ),
          },
        ].filter((o) => availableLayouts?.includes(o.value as any) ?? true)}
      />
      {onZenModeChange && (
        <Tooltip title={zenMode ? "Show code cells" : "Hide code cells"}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              cursor: "pointer",
            }}
            onClick={() => onZenModeChange(!zenMode)}
          >
            <Switch size="small" checked={zenMode} />
            <span style={{ userSelect: "none" }}>Zen</span>
          </span>
        </Tooltip>
      )}
      <Divider />
      <MinimalNotebookHelp />
      {/* direct flex child: blockified, so no baseline descender space; the
          header's own padding provides the gap to the frame edge */}
      <SwitchToRegularButton />
    </>
  );
}
