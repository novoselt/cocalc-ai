/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { useSyncExternalStore } from "react";

import {
  getStartupPerformancePolicy,
  subscribeStartupPerformancePolicy,
} from "./startup-performance-policy";

export default function useStartupPerformancePolicy() {
  return useSyncExternalStore(
    subscribeStartupPerformancePolicy,
    getStartupPerformancePolicy,
    getStartupPerformancePolicy,
  );
}
