import { formatHourlyRate } from "./format-hourly-rate";

describe("formatHourlyRate", () => {
  it.each([
    ["0", "$0.00/hour"],
    ["0.1", "$0.10/hour"],
    ["0.145", "$0.15/hour"],
    ["0.01498", "$0.015/hour"],
    ["0.00983", "$0.0098/hour"],
    ["-0.01498", "-$0.015/hour"],
  ])("formats %s as %s", (rate, expected) => {
    expect(formatHourlyRate(rate)).toBe(expected);
  });
});
