/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import { runGrowthMaterializationOnce } from "./materialize";

const logger = getLogger("server:growth-analytics:maintenance");
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

let started = false;
let running = false;

function intervalMs(): number {
  const value = Number(process.env.COCALC_GROWTH_MATERIALIZER_INTERVAL_MS);
  return Number.isSafeInteger(value) && value >= 10_000
    ? value
    : DEFAULT_INTERVAL_MS;
}

function enabled(): boolean {
  return !["0", "false", "off"].includes(
    `${process.env.COCALC_GROWTH_ANALYTICS_ENABLED ?? "1"}`.toLowerCase(),
  );
}

async function tick(): Promise<void> {
  if (running || !enabled()) return;
  running = true;
  try {
    const result = await runGrowthMaterializationOnce();
    if (result.status === "ok" && (result.events || result.profiles)) {
      logger.info("growth analytics materialized", result);
    }
  } catch (err) {
    logger.warn("growth analytics maintenance tick failed", { err: `${err}` });
  } finally {
    running = false;
  }
}

export function startGrowthAnalyticsMaintenance(): void {
  if (started) return;
  started = true;
  if (!enabled()) {
    logger.info("growth analytics maintenance disabled");
    return;
  }
  const timer = setInterval(() => void tick(), intervalMs());
  timer.unref?.();
  void tick();
}

export const __test__ = {
  reset: () => {
    started = false;
    running = false;
  },
};
