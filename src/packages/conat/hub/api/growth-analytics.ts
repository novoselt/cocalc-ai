/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { authFirstRequireAccount } from "./util";

export const GROWTH_METRIC_VERSION = "growth-v1";

export const GROWTH_EVENT_NAMES = [
  "identity_proved",
  "account_created",
  "profile_completed",
  "first_project_flow_seen",
  "onboarding_path_selected",
  "onboarding_configuration_seen",
  "onboarding_configuration_ready",
  "project_create_started",
  "project_created",
  "project_ready",
  "project_entered",
  "project_surface_visible",
  "app_foreground",
  "project_engaged",
  "project_work",
  "ai_prompt_submitted",
  "guided_activation_done",
  "guided_activation_abandoned",
  "first_self_directed_work",
] as const;

export type GrowthEventName = (typeof GROWTH_EVENT_NAMES)[number];

export type GrowthActionCategory =
  | "jupyter_execute"
  | "terminal_submit"
  | "editor_modify"
  | "editor_save"
  | "ai_prompt"
  | "user_compute";

export interface GrowthEventInput {
  event_id: string;
  event_name: GrowthEventName;
  occurred_at?: string;
  project_id?: string;
  source_component?:
    | "browser"
    | "hub"
    | "project-host"
    | "auth"
    | "maintenance";
  experiment?: string;
  variant?: string;
  properties?: {
    action_category?: GrowthActionCategory;
    auth_method?: string;
    metadata_class?: string;
    source_confidence?: "canonical" | "server" | "browser" | "legacy_proxy";
    funding_class?: string;
    onboarding_path?: string;
    outcome?: string;
  };
}

export type GrowthActivitySignal =
  | "project_engaged_v1"
  | "project_work_v1"
  | "app_foreground_v1"
  | "ai_engaged_v1"
  | "self_directed_work_v1";

export interface GrowthRangeQuery {
  start?: string;
  end?: string;
  activity_signal?: GrowthActivitySignal;
}

export interface GrowthMetricPoint {
  period_start: string;
  value: number | null;
  numerator?: number;
  denominator?: number;
  partial: boolean;
}

export interface GrowthMetricSeries {
  metric_name: string;
  metric_version: string;
  label: string;
  points: GrowthMetricPoint[];
}

export interface GrowthSummary {
  start: string;
  end: string;
  metric_version: string;
  activity_signal: GrowthActivitySignal;
  series: GrowthMetricSeries[];
  materialized_at?: string;
}

export interface GrowthFunnelStep {
  milestone: string;
  label: string;
  accounts: number;
  conversion_from_previous_pct: number | null;
  conversion_from_created_pct: number | null;
}

export interface GrowthFunnel {
  start: string;
  end: string;
  metric_version: string;
  steps: GrowthFunnelStep[];
  materialized_at?: string;
}

export interface GrowthRetentionCell {
  period_index: number;
  cohort_size: number;
  exact_active_accounts: number;
  exact_retention_pct: number | null;
  rolling_active_accounts: number;
  rolling_retention_pct: number | null;
  complete: boolean;
}

export interface GrowthRetentionCohort {
  cohort_start: string;
  cells: GrowthRetentionCell[];
}

export interface GrowthRetentionMatrix {
  start: string;
  end: string;
  metric_version: string;
  activity_signal: GrowthActivitySignal;
  cohort_grain: "day" | "week";
  cohorts: GrowthRetentionCohort[];
  materialized_at?: string;
}

export interface GrowthWeeklyAccountingPoint {
  week_start: string;
  new_accounts: number;
  retained_accounts: number;
  resurrected_accounts: number;
  churned_accounts: number;
  net_growth: number;
  partial: boolean;
}

export interface GrowthWeeklyAccounting {
  metric_version: string;
  activity_signal: GrowthActivitySignal;
  points: GrowthWeeklyAccountingPoint[];
  materialized_at?: string;
}

export interface GrowthDataHealth {
  metric_version: string;
  scope_id: string;
  coverage_start?: string;
  last_success_at?: string;
  lag_seconds?: number;
  oldest_dirty_period?: string;
  dirty_period_count: number;
  event_backlog_count: number;
  rows_processed?: number;
  last_duration_ms?: number;
  last_error?: string;
  status: "healthy" | "stale" | "error" | "initializing";
}

export interface GrowthDashboard {
  summary: GrowthSummary;
  funnel: GrowthFunnel;
  retention: GrowthRetentionMatrix;
  weekly: GrowthWeeklyAccounting;
  health: GrowthDataHealth;
}

export interface GrowthAnalyticsApi {
  recordEvent: (opts: {
    account_id?: string;
    event: GrowthEventInput;
  }) => Promise<{ recorded: boolean }>;
  getGrowthSummary: (
    opts?: GrowthRangeQuery & { account_id?: string },
  ) => Promise<GrowthSummary>;
  getGrowthFunnel: (
    opts?: GrowthRangeQuery & { account_id?: string },
  ) => Promise<GrowthFunnel>;
  getActiveUserSeries: (
    opts?: GrowthRangeQuery & { account_id?: string },
  ) => Promise<GrowthMetricSeries>;
  getRetentionMatrix: (
    opts?: GrowthRangeQuery & {
      account_id?: string;
      cohort_grain?: "day" | "week";
    },
  ) => Promise<GrowthRetentionMatrix>;
  getWeeklyGrowthAccounting: (
    opts?: GrowthRangeQuery & { account_id?: string },
  ) => Promise<GrowthWeeklyAccounting>;
  getGrowthDataHealth: (opts?: {
    account_id?: string;
  }) => Promise<GrowthDataHealth>;
  getGrowthDashboard: (
    opts?: GrowthRangeQuery & {
      account_id?: string;
      cohort_grain?: "day" | "week";
    },
  ) => Promise<GrowthDashboard>;
}

export const growthAnalytics = {
  recordEvent: authFirstRequireAccount,
  getGrowthSummary: authFirstRequireAccount,
  getGrowthFunnel: authFirstRequireAccount,
  getActiveUserSeries: authFirstRequireAccount,
  getRetentionMatrix: authFirstRequireAccount,
  getWeeklyGrowthAccounting: authFirstRequireAccount,
  getGrowthDataHealth: authFirstRequireAccount,
  getGrowthDashboard: authFirstRequireAccount,
} as const;
