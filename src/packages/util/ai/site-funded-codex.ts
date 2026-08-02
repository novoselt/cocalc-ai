/*
 *  This file is part of CoCalc: Copyright © 2026, SageMath, Inc.
 *  License: MS-RSL – see https://github.com/sagemathinc/cocalc-ai/blob/master/LICENSE.md
 */

import Decimal from "decimal.js-light";

export const MICROUSD_PER_USD = 1_000_000;
export const SITE_FUNDED_CODEX_POLICY_VERSION = 1;
export const SITE_FUNDED_CODEX_PRICE_VERSION = "openai-2026-07-30";

export type SiteFundedCodexPolicy = {
  version: number;
  model: string;
  reasoning: "low";
  serviceTier: "standard";
  maxConcurrentTurnsPerAccount: number;
  maxTurnCostMicrousd: number;
  maxTurnDurationMs: number;
  maxInputTokensPerRequest: number;
  maxOutputTokensPerRequest: number;
  maxRequestsPerTurn: number;
  allowFastMode: false;
  allowUltraOrMultiAgent: false;
  allowedProviderTools: string[];
};

export const DEFAULT_SITE_FUNDED_CODEX_POLICY: SiteFundedCodexPolicy = {
  version: SITE_FUNDED_CODEX_POLICY_VERSION,
  model: "gpt-5.6-luna",
  reasoning: "low",
  serviceTier: "standard",
  maxConcurrentTurnsPerAccount: 1,
  maxTurnCostMicrousd: 50_000,
  maxTurnDurationMs: 20 * 60_000,
  maxInputTokensPerRequest: 128_000,
  maxOutputTokensPerRequest: 8_000,
  maxRequestsPerTurn: 64,
  allowFastMode: false,
  allowUltraOrMultiAgent: false,
  allowedProviderTools: [],
};

export type SiteFundedCodexPrice = {
  version: string;
  provider: "openai";
  model: string;
  effectiveAt: string;
  sourceUrl: string;
  verifiedAt: string;
  inputUsdPerMillion: string;
  cachedInputUsdPerMillion: string;
  cacheWriteUsdPerMillion: string;
  outputUsdPerMillion: string;
  longContextThresholdTokens: number;
  longContextInputMultiplier: string;
  longContextOutputMultiplier: string;
};

const LUNA_PRICE: SiteFundedCodexPrice = {
  version: SITE_FUNDED_CODEX_PRICE_VERSION,
  provider: "openai",
  model: "gpt-5.6-luna",
  effectiveAt: "2026-07-30T00:00:00.000Z",
  sourceUrl: "https://openai.com/business/pricing/#api",
  verifiedAt: "2026-08-02T00:00:00.000Z",
  inputUsdPerMillion: "0.20",
  cachedInputUsdPerMillion: "0.02",
  cacheWriteUsdPerMillion: "0.25",
  outputUsdPerMillion: "1.20",
  longContextThresholdTokens: 272_000,
  longContextInputMultiplier: "2",
  longContextOutputMultiplier: "1.5",
};

const PRICE_CATALOG = new Map<string, SiteFundedCodexPrice>([
  [LUNA_PRICE.model, LUNA_PRICE],
]);

export type SiteFundedCodexRequestUsage = {
  inputTokens: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  outputTokens: number;
  reasoningOutputTokens?: number;
  providerToolFeesMicrousd?: number;
};

export type SiteFundedCodexCost = {
  priceVersion: string;
  model: string;
  longContext: boolean;
  ordinaryInputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  ordinaryInputCostMicrousd: number;
  cachedInputCostMicrousd: number;
  cacheWriteInputCostMicrousd: number;
  outputCostMicrousd: number;
  providerToolFeesMicrousd: number;
  costMicrousd: number;
};

export type SiteFundedCodexPoolId =
  | "site-funded-codex-free"
  | "site-funded-codex-paid";

export type SiteFundedCodexReservationStatus =
  | "active"
  | "committed"
  | "released"
  | "expired"
  | "interrupted"
  | "failed";

export type SiteFundedCodexReservation = {
  reservationId: string;
  fundedTurnId: string;
  poolId: SiteFundedCodexPoolId;
  policy: SiteFundedCodexPolicy;
  reservedMicrousd: number;
  committedMicrousd: number;
  expiresAt: string;
  heartbeatIntervalMs: number;
  status: SiteFundedCodexReservationStatus;
};

export type SiteFundedCodexUsageEvent = SiteFundedCodexRequestUsage & {
  eventId: string;
  reservationId: string;
  providerRequestId?: string;
  requestSequence: number;
  model: string;
  durationMs?: number;
};

export type SiteFundedCodexDenialCode =
  | "disabled"
  | "missing_price"
  | "account_limit_5h"
  | "account_limit_7d"
  | "account_concurrency"
  | "global_concurrency"
  | "global_pool"
  | "account_hold"
  | "ineligible"
  | "unavailable";

export type SiteFundedCodexAdmission =
  | {
      allowed: true;
      reservation: SiteFundedCodexReservation;
    }
  | {
      allowed: false;
      code: SiteFundedCodexDenialCode;
      reason: string;
      resetAt?: string;
    };

export type SiteFundedCodexPoolStatus = {
  poolId: SiteFundedCodexPoolId;
  periodStart: string;
  periodEnd: string;
  limitMicrousd: number;
  reservedMicrousd: number;
  committedMicrousd: number;
  activeReservations: number;
  utilization: number;
};

export type SiteFundedCodexAccountStatus = {
  accountId: string;
  committed5hMicrousd: number;
  committed7dMicrousd: number;
  activeReservedMicrousd: number;
  limit5hMicrousd?: number;
  limit7dMicrousd?: number;
  remaining5hMicrousd?: number;
  remaining7dMicrousd?: number;
};

export type SiteFundedCodexStatus = {
  pools: SiteFundedCodexPoolStatus[];
  account?: SiteFundedCodexAccountStatus;
  reconciliation?: {
    available: boolean;
    checkedAt: string;
    periodStart: string;
    periodEnd: string;
    localCommittedMicrousd: number;
    providerCostMicrousd?: number;
    discrepancyMicrousd?: number;
    discrepancyPercent?: number;
    projectId?: string;
    reason?: string;
  };
};

function tokenCount(value: number | undefined, name: string): number {
  const normalized = value ?? 0;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${name} must be a nonnegative safe integer`);
  }
  return normalized;
}

function microusdForTokens(tokens: number, usdPerMillion: string): Decimal {
  // One USD-per-million rate numerically equals one microusd per token.
  return new Decimal(tokens).mul(usdPerMillion);
}

function ceilMicrousd(value: Decimal): number {
  const rounded = value.toDecimalPlaces(0, Decimal.ROUND_CEIL).toNumber();
  if (!Number.isSafeInteger(rounded) || rounded < 0) {
    throw new Error("computed cost is outside the supported microusd range");
  }
  return rounded;
}

export function getSiteFundedCodexPrice(model: string): SiteFundedCodexPrice {
  const price = PRICE_CATALOG.get(`${model ?? ""}`.trim());
  if (!price) {
    throw new Error(
      `no exact site-funded Codex price is configured for model '${model}'`,
    );
  }
  return price;
}

export function computeSiteFundedCodexRequestCost({
  model,
  usage,
}: {
  model: string;
  usage: SiteFundedCodexRequestUsage;
}): SiteFundedCodexCost {
  const price = getSiteFundedCodexPrice(model);
  const inputTokens = tokenCount(usage.inputTokens, "inputTokens");
  const cachedInputTokens = tokenCount(
    usage.cachedInputTokens,
    "cachedInputTokens",
  );
  const cacheWriteInputTokens = tokenCount(
    usage.cacheWriteInputTokens,
    "cacheWriteInputTokens",
  );
  const outputTokens = tokenCount(usage.outputTokens, "outputTokens");
  const reasoningOutputTokens = tokenCount(
    usage.reasoningOutputTokens,
    "reasoningOutputTokens",
  );
  const providerToolFeesMicrousd = tokenCount(
    usage.providerToolFeesMicrousd,
    "providerToolFeesMicrousd",
  );
  if (cachedInputTokens + cacheWriteInputTokens > inputTokens) {
    throw new Error(
      "cached and cache-write input tokens cannot exceed total input tokens",
    );
  }
  if (reasoningOutputTokens > outputTokens) {
    throw new Error("reasoning output tokens cannot exceed output tokens");
  }

  const ordinaryInputTokens =
    inputTokens - cachedInputTokens - cacheWriteInputTokens;
  const longContext = inputTokens > price.longContextThresholdTokens;
  const inputMultiplier = longContext
    ? new Decimal(price.longContextInputMultiplier)
    : new Decimal(1);
  const outputMultiplier = longContext
    ? new Decimal(price.longContextOutputMultiplier)
    : new Decimal(1);

  const ordinaryInputCost = microusdForTokens(
    ordinaryInputTokens,
    price.inputUsdPerMillion,
  ).mul(inputMultiplier);
  const cachedInputCost = microusdForTokens(
    cachedInputTokens,
    price.cachedInputUsdPerMillion,
  ).mul(inputMultiplier);
  const cacheWriteInputCost = microusdForTokens(
    cacheWriteInputTokens,
    price.cacheWriteUsdPerMillion,
  ).mul(inputMultiplier);
  const outputCost = microusdForTokens(
    outputTokens,
    price.outputUsdPerMillion,
  ).mul(outputMultiplier);
  const total = ordinaryInputCost
    .add(cachedInputCost)
    .add(cacheWriteInputCost)
    .add(outputCost)
    .add(providerToolFeesMicrousd);

  return {
    priceVersion: price.version,
    model: price.model,
    longContext,
    ordinaryInputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens,
    reasoningOutputTokens,
    ordinaryInputCostMicrousd: ceilMicrousd(ordinaryInputCost),
    cachedInputCostMicrousd: ceilMicrousd(cachedInputCost),
    cacheWriteInputCostMicrousd: ceilMicrousd(cacheWriteInputCost),
    outputCostMicrousd: ceilMicrousd(outputCost),
    providerToolFeesMicrousd,
    costMicrousd: ceilMicrousd(total),
  };
}

export function microusdToUsageUnits(microusd: number): number {
  const normalized = tokenCount(microusd, "microusd");
  return new Decimal(normalized).mul(100).div(MICROUSD_PER_USD).toNumber();
}

export function usdToMicrousd(value: string | number): number {
  let amount: Decimal;
  try {
    amount = new Decimal(value);
  } catch {
    throw new Error("USD amount must be finite and nonnegative");
  }
  if (amount.isNegative()) {
    throw new Error("USD amount must be finite and nonnegative");
  }
  const result = amount
    .mul(MICROUSD_PER_USD)
    .toDecimalPlaces(0, Decimal.ROUND_FLOOR)
    .toNumber();
  if (!Number.isSafeInteger(result)) {
    throw new Error("USD amount is outside the supported microusd range");
  }
  return result;
}
