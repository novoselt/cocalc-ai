import {
  isGcpProjectHost,
  startGcpPreemptionWatcher,
  waitForGcpPreemption,
} from "./gcp-preemption";

describe("GCP Spot preemption watcher", () => {
  it("only enables itself on GCP project hosts", () => {
    expect(isGcpProjectHost({ PROJECT_HOST_CLOUD_PROVIDER: "gcp" })).toBe(true);
    expect(
      isGcpProjectHost({ COCALC_PROJECT_HOST_CLOUD_PROVIDER: "GCP" }),
    ).toBe(true);
    expect(isGcpProjectHost({ PROJECT_HOST_CLOUD_PROVIDER: "nebius" })).toBe(
      false,
    );
  });

  it("recognizes the metadata preemption value", async () => {
    const fetchImpl = jest.fn(async () => new Response("TRUE\n"));
    await expect(waitForGcpPreemption({ fetchImpl })).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("instance/preempted?wait_for_change=true"),
      expect.objectContaining({
        headers: { "Metadata-Flavor": "Google" },
      }),
    );
  });

  it("publishes one notice when GCP reports preemption", async () => {
    let resolveNotice!: () => void;
    const noticed = new Promise<void>((resolve) => {
      resolveNotice = resolve;
    });
    const onPreempted = jest.fn(resolveNotice);
    const stop = startGcpPreemptionWatcher({
      env: { PROJECT_HOST_CLOUD_PROVIDER: "gcp" },
      fetchImpl: jest.fn(async () => new Response("TRUE")),
      onPreempted,
    });
    await noticed;
    stop();
    expect(onPreempted).toHaveBeenCalledTimes(1);
  });
});
