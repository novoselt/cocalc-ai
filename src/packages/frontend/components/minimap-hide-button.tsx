/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Button, Popconfirm } from "antd";

import { Icon } from "@cocalc/frontend/components/icon";

interface Props {
  onConfirm: () => void;
  top?: number;
}

export function MinimapHideButton({ onConfirm, top = 3 }: Props) {
  return (
    <div
      data-cocalc-minimap-hide="1"
      style={{ position: "absolute", top, right: 3, zIndex: 5 }}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <Popconfirm
        placement="leftTop"
        title="Hide minimap?"
        description="You can show it again from the View menu."
        okText="Hide"
        cancelText="Cancel"
        onConfirm={onConfirm}
      >
        <Button
          aria-label="Hide minimap"
          title="Hide minimap"
          size="small"
          icon={<Icon name="eye-slash" />}
          style={{ width: 20, minWidth: 20, height: 20, padding: 0 }}
        />
      </Popconfirm>
    </div>
  );
}
