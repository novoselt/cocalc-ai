import getLogger from "@cocalc/backend/logger";

const logger = getLogger("project-host:gcp-preemption");

const GCP_PREEMPTED_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/preempted?wait_for_change=true";
const DEFAULT_RETRY_MS = 5_000;

type Fetch = typeof fetch;

export function isGcpProjectHost(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    `${
      env.COCALC_PROJECT_HOST_CLOUD_PROVIDER ??
      env.PROJECT_HOST_CLOUD_PROVIDER ??
      ""
    }`
      .trim()
      .toLowerCase() === "gcp"
  );
}

export async function waitForGcpPreemption({
  fetchImpl = fetch,
  signal,
}: {
  fetchImpl?: Fetch;
  signal?: AbortSignal;
} = {}): Promise<boolean> {
  const response = await fetchImpl(GCP_PREEMPTED_URL, {
    headers: { "Metadata-Flavor": "Google" },
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `GCP metadata preemption check failed (${response.status})`,
    );
  }
  return (await response.text()).trim().toUpperCase() === "TRUE";
}

export function startGcpPreemptionWatcher({
  onPreempted,
  env = process.env,
  fetchImpl = fetch,
  retryMs = DEFAULT_RETRY_MS,
}: {
  onPreempted: () => Promise<void> | void;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: Fetch;
  retryMs?: number;
}): () => void {
  if (!isGcpProjectHost(env)) return () => {};

  let stopped = false;
  let controller: AbortController | undefined;
  let retryTimer: NodeJS.Timeout | undefined;

  const waitToRetry = async () =>
    await new Promise<void>((resolve) => {
      retryTimer = setTimeout(resolve, Math.max(100, retryMs));
      retryTimer.unref?.();
    });

  void (async () => {
    while (!stopped) {
      controller = new AbortController();
      try {
        if (
          await waitForGcpPreemption({
            fetchImpl,
            signal: controller.signal,
          })
        ) {
          logger.warn("GCP Spot preemption notice received");
          await onPreempted();
          return;
        }
      } catch (err) {
        if (stopped || controller.signal.aborted) return;
        logger.warn("GCP preemption metadata watch failed; retrying", {
          err: `${err}`,
          retry_ms: retryMs,
        });
      }
      await waitToRetry();
    }
  })();

  return () => {
    stopped = true;
    controller?.abort();
    if (retryTimer != null) clearTimeout(retryTimer);
  };
}
