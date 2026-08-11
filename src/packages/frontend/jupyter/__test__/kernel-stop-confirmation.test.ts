import { isKernelStopConfirmed } from "../kernel-stop-confirmation";

describe("Jupyter kernel stop confirmation", () => {
  it("accepts an authoritative stopped state", () => {
    expect(
      isKernelStopConfirmed({
        targetIdentity: "old-kernel",
        status: {
          backend_state: "closed",
          kernel_state: "idle",
          identity: "old-kernel",
        },
      }),
    ).toBe(true);
  });

  it("accepts a different running kernel generation", () => {
    expect(
      isKernelStopConfirmed({
        targetIdentity: "old-kernel",
        status: {
          backend_state: "running",
          kernel_state: "idle",
          identity: "replacement-kernel",
        },
      }),
    ).toBe(true);
  });

  it("rejects the same running kernel generation", () => {
    expect(
      isKernelStopConfirmed({
        targetIdentity: "old-kernel",
        status: {
          backend_state: "running",
          kernel_state: "idle",
          identity: "old-kernel",
        },
      }),
    ).toBe(false);
  });

  it("does not infer success without authoritative identity or status", () => {
    expect(
      isKernelStopConfirmed({
        targetIdentity: "old-kernel",
        status: { backend_state: "running", kernel_state: "idle" },
      }),
    ).toBe(false);
    expect(isKernelStopConfirmed({ targetIdentity: "old-kernel" })).toBe(false);
  });
});
