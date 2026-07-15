import { COMPUTE_STATES } from "@cocalc/util/compute-states";

const HOST_ONLINE_WINDOW_MS = 10 * 60 * 1000;

type HostInfoLike = {
  get?: (key: string) => any;
  [key: string]: any;
};

export type HostOperationalState = {
  state: "operational" | "unavailable" | "unknown";
  status?: string;
  online?: boolean;
  reason?: string;
};

export type HostRecoveryDisplay = {
  active: boolean;
  title?: string;
  description?: string;
  etaMinutes?: number;
};

function read(hostInfo: HostInfoLike | undefined, key: string): any {
  if (!hostInfo) return undefined;
  if (typeof hostInfo.get === "function") return hostInfo.get(key);
  return (hostInfo as any)[key];
}

function parseOnline(hostInfo: HostInfoLike | undefined): boolean | undefined {
  const explicit = read(hostInfo, "online");
  if (typeof explicit === "boolean") return explicit;
  const lastSeen = read(hostInfo, "last_seen");
  if (typeof lastSeen !== "string" || lastSeen.length === 0) return undefined;
  const ts = Date.parse(lastSeen);
  if (!Number.isFinite(ts)) return undefined;
  return Date.now() - ts <= HOST_ONLINE_WINDOW_MS;
}

function normalizeStatus(value: unknown): string | undefined {
  const status = `${value ?? ""}`.trim().toLowerCase();
  if (!status) return undefined;
  return status === "active" ? "running" : status;
}

function futureTimestamp(value: unknown): number | undefined {
  const timestamp = Date.parse(`${value ?? ""}`);
  return Number.isFinite(timestamp) && timestamp > Date.now()
    ? timestamp
    : undefined;
}

export function getHostRecoveryDisplay(
  hostInfo: HostInfoLike | undefined,
): HostRecoveryDisplay {
  const recovery = read(hostInfo, "spot_recovery_state");
  const phase = `${
    read(hostInfo, "recovery_phase") ?? read(recovery, "phase") ?? ""
  }`.trim();
  const desiredState = `${read(hostInfo, "desired_state") ?? "running"}`;
  if (!phase || phase === "idle" || desiredState !== "running") {
    return { active: false };
  }
  const desiredPricing = `${
    read(hostInfo, "desired_pricing_model") ??
    read(hostInfo, "pricing_model") ??
    ""
  }`;
  if (desiredPricing !== "spot") return { active: false };
  const effectivePricing = `${
    read(hostInfo, "effective_pricing_model") ?? desiredPricing
  }`;
  const machine = read(hostInfo, "machine");
  const desiredMachineType = `${read(machine, "machine_type") ?? ""}`.trim();
  const activeMachineType = `${
    read(recovery, "active_machine_type") ?? desiredMachineType
  }`.trim();
  const nextRetry = futureTimestamp(read(recovery, "next_retry_at"));
  const etaMinutes = nextRetry
    ? Math.max(2, Math.ceil((nextRetry - Date.now()) / 60_000) + 2)
    : 2;

  if (
    effectivePricing === "on_demand" ||
    phase === "running_standard_fallback"
  ) {
    return {
      active: true,
      title: "Project host is restarting on guaranteed capacity",
      description:
        "Spot capacity was not available, so CoCalc switched this host to a regular on-demand VM and is reconnecting projects automatically.",
      etaMinutes,
    };
  }
  if (
    activeMachineType &&
    desiredMachineType &&
    activeMachineType !== desiredMachineType
  ) {
    return {
      active: true,
      title: "Project host is restarting on alternate Spot capacity",
      description: `The cloud provider interrupted this Spot VM. CoCalc is now trying ${activeMachineType} after ${desiredMachineType} was unavailable.`,
      etaMinutes,
    };
  }
  return {
    active: true,
    title: "Project host is restarting automatically",
    description:
      "The cloud provider interrupted this Spot VM. CoCalc detected the shutdown and is restarting the host and its projects automatically.",
    etaMinutes,
  };
}

type ComputeStateName = keyof typeof COMPUTE_STATES;
export type ProjectLifecycleDisplayState = ComputeStateName | "new";
export type IndexedBackupState = "present" | "missing" | "unknown";
export type ProjectLifecycleKind = ComputeStateName | "new" | "unknown";
export type ProjectLifecycleView = {
  rawState?: ComputeStateName;
  displayState?: ProjectLifecycleDisplayState;
  backupState: IndexedBackupState;
  kind: ProjectLifecycleKind;
  isRawArchived: boolean;
  isRunning: boolean;
  isNew: boolean;
  isArchived: boolean;
  isArchivedLike: boolean;
  showLifecycleBanner: boolean;
  canShowFilesystem: boolean;
  shouldRestoreTabs: boolean;
  shouldForceHomeTab: boolean;
};

function asComputeState(value: unknown): ComputeStateName | undefined {
  const state = `${value ?? ""}`.trim();
  if (!state) return undefined;
  if (!Object.prototype.hasOwnProperty.call(COMPUTE_STATES, state)) {
    return undefined;
  }
  return state as ComputeStateName;
}

export function evaluateHostOperational(
  hostInfo: HostInfoLike | undefined,
): HostOperationalState {
  if (!hostInfo) {
    return { state: "unknown" };
  }
  const reasonUnavailable =
    `${read(hostInfo, "reason_unavailable") ?? ""}`.trim();
  if (reasonUnavailable) {
    return { state: "unavailable", reason: reasonUnavailable };
  }
  const status = normalizeStatus(read(hostInfo, "status"));
  const online = parseOnline(hostInfo);
  if (!status || online == null) {
    return { state: "unknown", status, online };
  }
  if (status !== "running") {
    return {
      state: "unavailable",
      status,
      online,
      reason: `Assigned host is ${status}.`,
    };
  }
  if (!online) {
    return {
      state: "unavailable",
      status,
      online,
      reason: "Assigned host is offline (stale heartbeat).",
    };
  }
  return { state: "operational", status, online };
}

export function hostLabel(
  hostInfo: HostInfoLike | undefined,
  fallbackHostId?: string,
): string {
  const name = `${read(hostInfo, "name") ?? ""}`.trim();
  if (name) return name;
  return fallbackHostId ?? "assigned host";
}

export function normalizeProjectStateForDisplay({
  projectState,
  hostId,
  hostInfo,
}: {
  projectState?: unknown;
  hostId?: string | null;
  hostInfo?: HostInfoLike;
}): ComputeStateName | undefined {
  const state = asComputeState(projectState);
  if (!state) return undefined;
  if (state !== "running" || !hostId) return state;
  const hostStatus = normalizeStatus(read(hostInfo, "status"));
  // A stale/missing host heartbeat should not make a definitely running
  // project appear stopped in the UI. Reserve the downgrade for explicit
  // non-running host states such as off/error/deleted.
  if (hostStatus && hostStatus !== "running") {
    return "opened";
  }
  return state;
}

export function indexedBackupState(lastBackup: unknown): IndexedBackupState {
  if (typeof lastBackup === "undefined") {
    return "unknown";
  }
  if (lastBackup instanceof Date) {
    return Number.isFinite(lastBackup.valueOf()) ? "present" : "missing";
  }
  if (typeof lastBackup === "string") {
    return lastBackup.trim().length > 0 &&
      Number.isFinite(Date.parse(lastBackup))
      ? "present"
      : "missing";
  }
  if (lastBackup == null) {
    return "missing";
  }
  return "unknown";
}

export function getProjectLifecycleView({
  projectState,
  hostId,
  hostInfo,
  lastBackup,
}: {
  projectState?: unknown;
  hostId?: string | null;
  hostInfo?: HostInfoLike;
  lastBackup?: unknown;
}): ProjectLifecycleView {
  const rawState = normalizeProjectStateForDisplay({
    projectState,
    hostId,
    hostInfo,
  });
  const backupState = indexedBackupState(lastBackup);
  let displayState: ProjectLifecycleDisplayState | undefined = rawState;
  if (rawState === "archived") {
    if (backupState === "present") {
      displayState = "archived";
    } else if (backupState === "missing") {
      displayState = "new";
    } else {
      displayState = undefined;
    }
  }
  const isRawArchived = rawState === "archived";
  const kind =
    displayState ??
    (isRawArchived && backupState === "unknown"
      ? "unknown"
      : (rawState ?? "unknown"));
  const isNew = displayState === "new";
  const isArchived = displayState === "archived";
  const isArchivedLike = isRawArchived || isNew;
  const isRunning = kind === "running";
  const canShowFilesystem = !isArchivedLike;
  return {
    rawState,
    displayState,
    backupState,
    kind,
    isRawArchived,
    isRunning,
    isNew,
    isArchived,
    isArchivedLike,
    showLifecycleBanner: !isRunning,
    canShowFilesystem,
    shouldRestoreTabs: canShowFilesystem,
    shouldForceHomeTab: !canShowFilesystem,
  };
}

export function getProjectLifecycleDisplayState(args: {
  projectState?: unknown;
  hostId?: string | null;
  hostInfo?: HostInfoLike;
  lastBackup?: unknown;
}): ProjectLifecycleDisplayState | undefined {
  return getProjectLifecycleView(args).displayState;
}
