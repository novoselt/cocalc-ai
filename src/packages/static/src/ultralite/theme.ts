/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import type { CSSProperties } from "react";
import { COLORS } from "@cocalc/util/theme";

export const ultraliteTheme = {
  "--ul-accent": COLORS.BLUE_DD,
  "--ul-accent-soft": COLORS.BLUE_LLLL,
  "--ul-bg": COLORS.GRAY_LLL,
  "--ul-border": COLORS.GRAY_L0,
  "--ul-danger": COLORS.BS_RED,
  "--ul-ink": COLORS.GRAY_DD,
  "--ul-muted": COLORS.GRAY_M,
  "--ul-paper": COLORS.TOP_BAR.ACTIVE,
  "--ul-success": COLORS.ANTD_GREEN_D,
  "--ul-warm": COLORS.YELL_LLL,
} as CSSProperties;
