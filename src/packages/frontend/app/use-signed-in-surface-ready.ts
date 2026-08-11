/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { useEffect, useState } from "react";

import {
  onSignedInSurfaceReady,
  signedInSurfaceReadySegment,
} from "./surface-ready-state";

export default function useSignedInSurfaceReady(): boolean {
  const [ready, setReady] = useState(
    () => signedInSurfaceReadySegment() != null,
  );
  useEffect(() => onSignedInSurfaceReady(() => setReady(true)), []);
  return ready;
}
