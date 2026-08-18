/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/**
 * The "Animations" preference in Account -> Preferences -> Theme
 * (`other_settings.antd_animate`, on by default).
 *
 * The preference is about **motion**: things that slide, resize, or otherwise
 * move can cause motion sickness. It is not a general "hold still" switch —
 * colour and opacity changes such as hover fades and blinking status
 * indicators move nothing and stay on.
 *
 * Antd's own motion is switched off through the theme token in
 * `./context.tsx`, but that does not reach hand-written CSS. For first-party
 * motion:
 *
 * - Inline styles: wrap the value in `useAnimatedTransition`, so the property
 *   changes instantly instead of easing when the preference is off.
 * - Stylesheets: key off the document root, which carries
 *   `data-animations="off"` while the preference is off.
 */

import { useEffect } from "react";

import { useAccountOtherSetting } from "@cocalc/frontend/app-framework";

export const ANIMATIONS_ATTRIBUTE = "data-animations";

export function useAnimationsEnabled(): boolean {
  return useAccountOtherSetting<boolean>("antd_animate") ?? true;
}

/**
 * The given CSS transition while animations are enabled, and `undefined` while
 * they are not, so the styled property takes effect immediately.
 */
export function useAnimatedTransition(transition: string): string | undefined {
  return useAnimationsEnabled() ? transition : undefined;
}

/**
 * Publish the preference on the document root so stylesheets can respond to
 * it. Called once from the application shell.
 */
export function useAnimationsRootAttribute(): void {
  const enabled = useAnimationsEnabled();
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute(
      ANIMATIONS_ATTRIBUTE,
      enabled ? "on" : "off",
    );
  }, [enabled]);
}
