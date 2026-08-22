import { expiresAfterSeconds } from "./cache-headers";

test("converts cache seconds to milliseconds for Expires", () => {
  const now = Date.UTC(2026, 7, 20, 12, 0, 0);
  expect(expiresAfterSeconds(10, now)).toBe(
    new Date(now + 10_000).toUTCString(),
  );
  expect(expiresAfterSeconds(10 * 24 * 60 * 60, now)).toBe(
    new Date(now + 10 * 24 * 60 * 60 * 1000).toUTCString(),
  );
});
