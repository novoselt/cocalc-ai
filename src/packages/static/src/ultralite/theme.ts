/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import type { CSSProperties } from "react";
import { COLORS } from "@cocalc/util/theme";

export const ultraliteTheme = {
  "--ul-accent": COLORS.BLUE_DD,
  "--ul-accent-soft": COLORS.BLUE_LLLL,
  "--ul-bg": COLORS.TOP_BAR.ACTIVE,
  "--ul-border": COLORS.GRAY_LL,
  "--ul-border-dark": COLORS.GRAY_L,
  "--ul-code-bg": COLORS.GRAY_LLL,
  "--ul-code-text": COLORS.GRAY_DD,
  "--ul-danger": COLORS.BS_RED,
  "--ul-danger-soft": COLORS.ANTD_BG_RED_L,
  "--ul-focus": COLORS.YELL_D,
  "--ul-heading": COLORS.GRAY_DD,
  "--ul-ink": COLORS.GRAY_DD,
  "--ul-muted": COLORS.GRAY_M,
  "--ul-paper": COLORS.TOP_BAR.ACTIVE,
  "--ul-rail": COLORS.GRAY_LLL,
  "--ul-success": COLORS.ANTD_GREEN_D,
  "--ul-topbar": COLORS.BLUE_D,
  "--ul-warning": COLORS.YELL_D,
  "--ul-warning-soft": COLORS.YELL_LLL,
} as CSSProperties;
