import { Map } from "immutable";

import { compute_usage } from "./usage";

function computeMemoryUsage(values: Record<string, number>) {
  return compute_usage({
    kernel_usage: Map(values),
    backend_state: "running",
    cpu_runtime: 0,
    expected_cell_runtime: 3,
  });
}

describe("compute_usage memory limit", () => {
  it("uses the explicit project cgroup memory limit", () => {
    const usage = computeMemoryUsage({
      mem: 180,
      mem_chld: 0,
      mem_free: 0,
      mem_limit: 6400,
    });

    expect(usage.mem).toBe(180);
    expect(usage.mem_limit).toBe(6400);
    expect(usage.mem_pct).toBeCloseTo(2.8125);
    expect(usage.mem_alert).toBe("none");
  });

  it("falls back to free plus kernel memory for older backends", () => {
    const usage = computeMemoryUsage({
      mem: 180,
      mem_chld: 20,
      mem_free: 800,
    });

    expect(usage.mem).toBe(200);
    expect(usage.mem_limit).toBe(1000);
    expect(usage.mem_pct).toBe(20);
  });
});
