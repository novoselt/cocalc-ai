/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  GROWTH_EVENT_NAMES,
  type GrowthEventInput,
  type GrowthEventName,
} from "@cocalc/conat/hub/api/growth-analytics";
import { isValidUUID } from "@cocalc/util/misc";

const EVENT_NAMES = new Set<string>(GROWTH_EVENT_NAMES);
const PROPERTY_KEYS = new Set([
  "action_category",
  "auth_method",
  "metadata_class",
  "source_confidence",
  "funding_class",
  "onboarding_path",
  "outcome",
]);
const SOURCE_COMPONENTS = new Set([
  "browser",
  "hub",
  "project-host",
  "auth",
  "maintenance",
]);
const MAX_EVENT_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;
const MAX_PROPERTIES_BYTES = 1024;

function boundedText(value: unknown, max: number): string | undefined {
  const text = `${value ?? ""}`.trim();
  return text ? text.slice(0, max) : undefined;
}

export interface ValidatedGrowthEvent {
  event_id: string;
  event_name: GrowthEventName;
  occurred_at: Date;
  project_id?: string;
  source_component: string;
  experiment?: string;
  variant?: string;
  properties: Record<string, string>;
}

export function validateGrowthEvent(
  event: GrowthEventInput,
  now = new Date(),
): ValidatedGrowthEvent {
  if (!isValidUUID(event?.event_id)) {
    throw Error("event_id must be a valid UUID");
  }
  if (!EVENT_NAMES.has(event?.event_name)) {
    throw Error("event_name is not allowed");
  }
  if (event.project_id != null && !isValidUUID(event.project_id)) {
    throw Error("project_id must be a valid UUID");
  }
  const occurredAt = event.occurred_at ? new Date(event.occurred_at) : now;
  if (!Number.isFinite(occurredAt.getTime())) {
    throw Error("occurred_at is invalid");
  }
  if (occurredAt.getTime() < now.getTime() - MAX_EVENT_AGE_MS) {
    throw Error("event is outside the raw-event retention window");
  }
  if (occurredAt.getTime() > now.getTime() + MAX_FUTURE_MS) {
    throw Error("event occurred_at is too far in the future");
  }
  const sourceComponent = boundedText(event.source_component, 48) ?? "browser";
  if (!SOURCE_COMPONENTS.has(sourceComponent)) {
    throw Error("source_component is not allowed");
  }
  const properties: Record<string, string> = {};
  if (event.properties != null) {
    for (const [key, value] of Object.entries(event.properties)) {
      if (!PROPERTY_KEYS.has(key) || typeof value !== "string") {
        throw Error(`growth event property '${key}' is not allowed`);
      }
      const text = boundedText(value, 96);
      if (text != null) properties[key] = text;
    }
  }
  if (JSON.stringify(properties).length > MAX_PROPERTIES_BYTES) {
    throw Error("growth event properties are too large");
  }
  return {
    event_id: event.event_id,
    event_name: event.event_name,
    occurred_at: occurredAt,
    project_id: event.project_id,
    source_component: sourceComponent,
    experiment: boundedText(event.experiment, 64),
    variant: boundedText(event.variant, 48),
    properties,
  };
}
