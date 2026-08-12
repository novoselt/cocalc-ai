/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { useEffect, useState } from "react";

import {
  postSurfaceDelayMs,
  type PostSurfaceWork,
  type StartupPerformanceMode,
} from "./startup-performance-policy";

export default function usePostSurfaceWork({
  mode,
  surfaceReady,
  work,
}: {
  mode: StartupPerformanceMode;
  surfaceReady: boolean;
  work: PostSurfaceWork;
}): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!surfaceReady || ready) return;
    const delay = postSurfaceDelayMs(mode, work);
    if (delay === 0) {
      setReady(true);
      return;
    }
    const timer = window.setTimeout(() => setReady(true), delay);
    return () => window.clearTimeout(timer);
  }, [mode, ready, surfaceReady, work]);
  return ready;
}
