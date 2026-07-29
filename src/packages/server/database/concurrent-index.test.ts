/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const queryMock = jest.fn();
const releaseMock = jest.fn();
const connectMock = jest.fn();

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({
    connect: (...args: any[]) => connectMock(...args),
  }),
}));

describe("concurrent index maintenance", () => {
  beforeEach(() => {
    queryMock.mockReset();
    releaseMock.mockReset();
    connectMock.mockReset();
    connectMock.mockResolvedValue({
      query: (...args: any[]) => queryMock(...args),
      release: releaseMock,
    });
  });

  it("drops an invalid catalog entry and rebuilds without a statement timeout", async () => {
    let stateChecks = 0;
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_try_advisory_lock")) {
        return { rows: [{ locked: true }] };
      }
      if (sql.includes("FROM pg_index")) {
        stateChecks += 1;
        return {
          rows: [
            stateChecks === 1
              ? { indisready: false, indisvalid: false }
              : { indisready: true, indisvalid: true },
          ],
        };
      }
      return { rows: [] };
    });

    const { createIndexConcurrentlyBestEffort } =
      await import("./concurrent-index");
    await createIndexConcurrentlyBestEffort({
      name: "example_cover_idx",
      sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS example_cover_idx ON example(id)",
    });

    const statements = queryMock.mock.calls.map(([sql]) => `${sql}`.trim());
    expect(statements).toContain("SET statement_timeout = 0");
    expect(statements).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "example_cover_idx"',
    );
    expect(statements).toContain(
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS example_cover_idx ON example(id)",
    );
    expect(statements).toContain("RESET statement_timeout");
    expect(statements).toContain("SELECT pg_advisory_unlock(hashtext($1))");
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("does not build when another process owns the advisory lock", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ locked: false }] });

    const { createIndexConcurrentlyBestEffort } =
      await import("./concurrent-index");
    await createIndexConcurrentlyBestEffort({
      name: "example_idx",
      sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS example_idx ON example(id)",
    });

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("restores the pooled connection after a failed build", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_try_advisory_lock")) {
        return { rows: [{ locked: true }] };
      }
      if (sql.includes("FROM pg_index")) {
        return { rows: [] };
      }
      if (sql.includes("CREATE INDEX CONCURRENTLY")) {
        throw new Error("build failed");
      }
      return { rows: [] };
    });

    const { createIndexConcurrentlyBestEffort } =
      await import("./concurrent-index");
    await expect(
      createIndexConcurrentlyBestEffort({
        name: "example_idx",
        sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS example_idx ON example(id)",
      }),
    ).resolves.toBeUndefined();

    const statements = queryMock.mock.calls.map(([sql]) => `${sql}`.trim());
    expect(statements).toContain("RESET statement_timeout");
    expect(statements).toContain("SELECT pg_advisory_unlock(hashtext($1))");
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });
});
