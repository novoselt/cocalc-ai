/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { useEffect, useState } from "react";

export function getVisibleViewportBottom({
  innerHeight,
  visualViewport,
}: Pick<Window, "innerHeight" | "visualViewport">): number {
  const viewportHeight = visualViewport?.height;
  const viewportOffsetTop = visualViewport?.offsetTop;
  if (
    typeof viewportHeight === "number" &&
    Number.isFinite(viewportHeight) &&
    viewportHeight > 0 &&
    typeof viewportOffsetTop === "number" &&
    Number.isFinite(viewportOffsetTop)
  ) {
    return Math.max(1, Math.round(viewportHeight + viewportOffsetTop));
  }
  return Math.max(1, Math.round(innerHeight));
}

export function useVisibleViewportBottom(enabled: boolean): number | undefined {
  const [viewportBottom, setViewportBottom] = useState<number | undefined>(
    () =>
      enabled && typeof window !== "undefined"
        ? getVisibleViewportBottom(window)
        : undefined,
  );

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      setViewportBottom(undefined);
      return;
    }

    const update = () => {
      const next = getVisibleViewportBottom(window);
      setViewportBottom((current) => (current === next ? current : next));
    };
    const visualViewport = window.visualViewport;
    update();
    window.addEventListener("resize", update);
    visualViewport?.addEventListener("resize", update);
    visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      visualViewport?.removeEventListener("resize", update);
      visualViewport?.removeEventListener("scroll", update);
    };
  }, [enabled]);

  return viewportBottom;
}
