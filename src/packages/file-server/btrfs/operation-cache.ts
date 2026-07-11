import getLogger from "@cocalc/backend/logger";
import { btrfs } from "./util";

const logger = getLogger("file-server:btrfs:operation-cache");

type BtrfsOutput = Awaited<ReturnType<typeof btrfs>>;

type CacheEntry<T> = {
  expires: number;
  value: T;
};

const qgroupShowCache = new Map<string, CacheEntry<BtrfsOutput>>();
const qgroupShowInflight = new Map<string, Promise<BtrfsOutput>>();
const subvolumeShowCache = new Map<string, CacheEntry<BtrfsOutput>>();
const subvolumeShowInflight = new Map<string, Promise<BtrfsOutput>>();
const DEFAULT_MUTATION_LOCK_WAIT_MS = 2 * 60_000;

type MutationLockHolder = {
  token: symbol;
  operation: string;
  startedAt: number;
};

type MutationLockWaiter = {
  token: symbol;
  operation: string;
  queuedAt: number;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
};

type MutationLockState = {
  holder: MutationLockHolder;
  waiters: MutationLockWaiter[];
};

export type BtrfsMutationLockStatus = {
  mount: string;
  holder_operation: string;
  held_ms: number;
  queued: number;
  oldest_wait_ms?: number;
};

const mutationLocks = new Map<string, MutationLockState>();

function envDurationMs(name: string, fallback: number): number {
  const value = Number.parseInt(`${process.env[name] ?? ""}`, 10);
  if (Number.isFinite(value) && value >= 0) {
    return value;
  }
  return fallback;
}

function qgroupShowCacheMs(): number {
  return envDurationMs("COCALC_BTRFS_QGROUP_SHOW_CACHE_MS", 2_000);
}

function subvolumeShowCacheMs(): number {
  return envDurationMs("COCALC_BTRFS_SUBVOLUME_SHOW_CACHE_MS", 1_000);
}

function mutationLockWaitMs(): number {
  return envDurationMs(
    "COCALC_BTRFS_MUTATION_LOCK_WAIT_MS",
    DEFAULT_MUTATION_LOCK_WAIT_MS,
  );
}

async function cached<T>({
  cache,
  inflight,
  key,
  ttlMs,
  run,
}: {
  cache: Map<string, CacheEntry<T>>;
  inflight: Map<string, Promise<T>>;
  key: string;
  ttlMs: number;
  run: () => Promise<T>;
}): Promise<T> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now) {
    return cached.value;
  }
  const pending = inflight.get(key);
  if (pending) {
    return await pending;
  }
  const promise = (async () => {
    const value = await run();
    if (ttlMs > 0) {
      cache.set(key, { value, expires: Date.now() + ttlMs });
    }
    return value;
  })();
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    if (inflight.get(key) === promise) {
      inflight.delete(key);
    }
  }
}

export async function cachedBtrfsQgroupShowRaw(
  mount: string,
): Promise<BtrfsOutput> {
  return await cached({
    cache: qgroupShowCache,
    inflight: qgroupShowInflight,
    key: mount,
    ttlMs: qgroupShowCacheMs(),
    run: async () =>
      await btrfs({
        verbose: false,
        args: ["qgroup", "show", "-prc", "--raw", mount],
      }),
  });
}

export function invalidateBtrfsQgroupShowRaw(mount: string): void {
  qgroupShowCache.delete(mount);
}

export async function cachedBtrfsSubvolumeShow(
  path: string,
  opts?: { err_on_exit?: boolean },
): Promise<BtrfsOutput> {
  const errOnExit = opts?.err_on_exit ?? true;
  return await cached({
    cache: subvolumeShowCache,
    inflight: subvolumeShowInflight,
    key: `${errOnExit ? "strict" : "lenient"}:${path}`,
    ttlMs: subvolumeShowCacheMs(),
    run: async () =>
      await btrfs({
        args: ["subvolume", "show", path],
        err_on_exit: errOnExit,
        verbose: false,
      }),
  });
}

export function invalidateBtrfsSubvolumeShow(path: string): void {
  subvolumeShowCache.delete(`strict:${path}`);
  subvolumeShowCache.delete(`lenient:${path}`);
}

export async function withBtrfsMutationLock<T>({
  mount,
  operation,
  run,
  wait_ms = mutationLockWaitMs(),
}: {
  mount: string;
  operation: string;
  run: () => Promise<T>;
  wait_ms?: number;
}): Promise<T> {
  const release = await acquireBtrfsMutationLock({
    mount,
    operation,
    wait_ms,
  });
  try {
    return await run();
  } finally {
    release();
  }
}

async function acquireBtrfsMutationLock({
  mount,
  operation,
  wait_ms,
}: {
  mount: string;
  operation: string;
  wait_ms: number;
}): Promise<() => void> {
  const token = Symbol(operation);
  const existing = mutationLocks.get(mount);
  if (!existing) {
    const state: MutationLockState = {
      holder: { token, operation, startedAt: Date.now() },
      waiters: [],
    };
    mutationLocks.set(mount, state);
    logger.debug("acquired btrfs mutation lock", { mount, operation });
    return () => releaseBtrfsMutationLock({ mount, token });
  }

  const queuedAt = Date.now();
  logger.debug("waiting for btrfs mutation lock", {
    mount,
    operation,
    holder_operation: existing.holder.operation,
    held_ms: queuedAt - existing.holder.startedAt,
    queued: existing.waiters.length + 1,
  });
  return await new Promise<() => void>((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        const state = mutationLocks.get(mount);
        if (!state) return;
        const index = state.waiters.findIndex(
          (waiter) => waiter.token === token,
        );
        if (index < 0) return;
        state.waiters.splice(index, 1);
        const heldMs = Date.now() - state.holder.startedAt;
        const err = new Error(
          `timed out after ${wait_ms}ms waiting for btrfs mutation lock on ${mount}; holder=${state.holder.operation} held_ms=${heldMs}`,
        );
        logger.warn("timed out waiting for btrfs mutation lock", {
          mount,
          operation,
          wait_ms,
          holder_operation: state.holder.operation,
          held_ms: heldMs,
          queued: state.waiters.length,
        });
        reject(err);
      },
      Math.max(0, wait_ms),
    );
    timeout.unref?.();
    existing.waiters.push({
      token,
      operation,
      queuedAt,
      timeout,
      resolve,
      reject,
    });
  });
}

function releaseBtrfsMutationLock({
  mount,
  token,
}: {
  mount: string;
  token: symbol;
}): void {
  const state = mutationLocks.get(mount);
  if (!state || state.holder.token !== token) return;

  const released = state.holder;
  const next = state.waiters.shift();
  if (!next) {
    mutationLocks.delete(mount);
    logger.debug("released btrfs mutation lock", {
      mount,
      operation: released.operation,
      held_ms: Date.now() - released.startedAt,
      queued: 0,
    });
    return;
  }

  clearTimeout(next.timeout);
  state.holder = {
    token: next.token,
    operation: next.operation,
    startedAt: Date.now(),
  };
  logger.debug("handed off btrfs mutation lock", {
    mount,
    released_operation: released.operation,
    released_held_ms: Date.now() - released.startedAt,
    operation: next.operation,
    waited_ms: Date.now() - next.queuedAt,
    queued: state.waiters.length,
  });
  next.resolve(() => releaseBtrfsMutationLock({ mount, token: next.token }));
}

export function getBtrfsMutationLockStatus(): BtrfsMutationLockStatus[] {
  const now = Date.now();
  return Array.from(mutationLocks.entries())
    .map(([mount, state]) => ({
      mount,
      holder_operation: state.holder.operation,
      held_ms: Math.max(0, now - state.holder.startedAt),
      queued: state.waiters.length,
      ...(state.waiters[0]
        ? { oldest_wait_ms: Math.max(0, now - state.waiters[0].queuedAt) }
        : {}),
    }))
    .sort((a, b) => a.mount.localeCompare(b.mount));
}

export function clearBtrfsOperationCachesForTest(): void {
  qgroupShowCache.clear();
  qgroupShowInflight.clear();
  subvolumeShowCache.clear();
  subvolumeShowInflight.clear();
  for (const state of mutationLocks.values()) {
    for (const waiter of state.waiters) {
      clearTimeout(waiter.timeout);
    }
  }
  mutationLocks.clear();
}
