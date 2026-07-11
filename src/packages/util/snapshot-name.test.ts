import { assertValidSnapshotName } from "./snapshot-name";

describe("snapshot names", () => {
  it.each([
    "2026-07-11T12:34:56.000Z",
    "manual-before-upgrade",
    "restore-safety+1",
  ])("accepts a single safe path component: %s", (name) => {
    expect(assertValidSnapshotName(name)).toBe(name);
  });

  it.each([
    "",
    ".",
    "..",
    ".hidden",
    "../outside",
    "nested/name",
    "nested\\name",
    "name\0suffix",
  ])("rejects an unsafe snapshot name: %s", (name) => {
    expect(() => assertValidSnapshotName(name)).toThrow();
  });
});
