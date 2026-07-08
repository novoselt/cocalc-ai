import {
  closeDatabase,
  getDatabase,
  initDatabase,
  upsertRow,
} from "@cocalc/lite/hub/sqlite/database";
import { querySqlite } from "./admin-query";

describe("project-host admin SQLite query", () => {
  beforeEach(() => {
    process.env.COCALC_LITE_SQLITE_FILENAME = ":memory:";
    closeDatabase();
    initDatabase();
  });

  afterEach(() => {
    closeDatabase();
    delete process.env.COCALC_LITE_SQLITE_FILENAME;
  });

  it("runs bounded read-only SELECT queries", () => {
    upsertRow("projects", "project-1", { project_id: "project-1" });
    upsertRow("projects", "project-2", { project_id: "project-2" });

    const result = querySqlite({
      sql: "select table_name, pk from data order by pk",
      limit: 1,
    });

    expect(result.fields.map((field) => field.name)).toEqual([
      "table_name",
      "pk",
    ]);
    expect(result.rows).toEqual([["projects", "project-1"]]);
    expect(result.truncated).toBe(true);
    expect(result.executed_sql).toContain("LIMIT 2");
  });

  it("rejects write and multi-statement queries", () => {
    expect(() => querySqlite({ sql: "delete from data", limit: 1 })).toThrow(
      /only supports SELECT or WITH/,
    );
    expect(() =>
      querySqlite({ sql: "select * from data; select * from data", limit: 1 }),
    ).toThrow(/exactly one statement/);

    expect(
      getDatabase().prepare("SELECT count(*) AS count FROM data").get(),
    ).toEqual({ count: 0 });
  });
});
