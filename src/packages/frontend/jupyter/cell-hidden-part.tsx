/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Button } from "antd";
import React from "react";

import { Icon, Tooltip } from "@cocalc/frontend/components";
import { COLORS } from "@cocalc/util/theme";

interface Props {
  title: string;
  onReveal?: () => void;
  revealLabel?: string;
}

const STYLE: React.CSSProperties = {
  color: COLORS.GRAY_L,
  fontSize: "14pt",
  marginLeft: "7px",
};

export const CellHiddenPart: React.FC<Props> = ({
  title,
  onReveal,
  revealLabel,
}: Props) => {
  if (onReveal != null) {
    return (
      <Tooltip title={title}>
        <Button
          aria-label={revealLabel ?? title}
          icon={<Icon name="ellipsis" />}
          onClick={onReveal}
          size="small"
          style={STYLE}
          type="text"
        />
      </Tooltip>
    );
  }

  return (
    <div style={{ ...STYLE, marginLeft: "15px" }} title={title}>
      <Icon name="ellipsis" />
    </div>
  );
};
