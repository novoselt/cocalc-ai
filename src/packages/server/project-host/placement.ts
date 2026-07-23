import type { MembershipEntitlements } from "@cocalc/conat/hub/api/purchases";
import type {
  Host,
  HostEffectiveAccessRole,
  HostIoContainmentMetrics,
} from "@cocalc/conat/hub/api/hosts";

export type UserHostTier = number;

type HostIoMetadata = {
  metadata?: {
    metrics?: {
      current?: {
        io_containment?: HostIoContainmentMetrics;
      };
    };
  };
};

export function hostIoPlacementConformant(row: HostIoMetadata): boolean {
  const containment = row.metadata?.metrics?.current?.io_containment;
  // Missing telemetry and non-enforcing policies preserve compatibility with
  // older hosts. Once a host explicitly declares enforcement, new placement
  // requires proof that the aggregate policy is effective.
  if (!containment || containment.policy_mode !== "enforce") return true;
  return (
    containment.capability === "validated" &&
    !`${containment.last_reconcile_error ?? ""}`.trim()
  );
}

export function normalizeHostTier(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function getUserHostTier(
  entitlements?: MembershipEntitlements,
): UserHostTier {
  return normalizeHostTier(entitlements?.features?.project_host_tier);
}

export function computePlacementPermission({
  tier,
  userTier,
  isOwner,
  accessRole,
  hasDedicatedAccess,
}: {
  tier?: Host["tier"];
  userTier: UserHostTier;
  isOwner: boolean;
  accessRole?: HostEffectiveAccessRole;
  hasDedicatedAccess?: boolean;
}): { can_place: boolean; reason_unavailable?: string } {
  // Dedicated-host owners/delegated users are explicitly allowed.
  let can_place =
    isOwner ||
    !!hasDedicatedAccess ||
    accessRole === "owner" ||
    accessRole === "manager" ||
    accessRole === "user" ||
    accessRole === "admin";
  let reason_unavailable: string | undefined;

  if (tier != null && !can_place) {
    const hostTier = normalizeHostTier(tier);
    if (userTier >= hostTier) {
      can_place = true;
    } else {
      reason_unavailable = `Requires project host tier ≥ ${hostTier}`;
    }
  }

  return { can_place, reason_unavailable };
}
