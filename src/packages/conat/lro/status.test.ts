import { isLroTerminalStatus, LRO_TERMINAL_STATUSES } from "./status";

describe("LRO status", () => {
  it("classifies the shared terminal states", () => {
    expect([...LRO_TERMINAL_STATUSES]).toEqual([
      "succeeded",
      "failed",
      "canceled",
      "expired",
    ]);
    for (const status of LRO_TERMINAL_STATUSES) {
      expect(isLroTerminalStatus(status)).toBe(true);
    }
  });

  it("rejects active, missing, and unknown states", () => {
    expect(isLroTerminalStatus("queued")).toBe(false);
    expect(isLroTerminalStatus("running")).toBe(false);
    expect(isLroTerminalStatus("unknown")).toBe(false);
    expect(isLroTerminalStatus(null)).toBe(false);
    expect(isLroTerminalStatus()).toBe(false);
  });
});
