/*
 *  This file is part of CoCalc: Copyright © 2025 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  columnTypeFromInformationSchema,
  schemaNeedsSync,
  syncSchema,
} from "./sync";
import { createIndexesQueries } from "./indexes";
import { notNullGuardName } from "./column-invariants";
import { SCHEMA } from "@cocalc/util/schema";
import type { DBSchema, TableSchema } from "./types";
import { getClient } from "@cocalc/database/pool";

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  getClient: jest.fn(),
}));

jest.mock("./table", () => ({
  __esModule: true,
  primaryKeys: (table: string | { name?: string }) => {
    const name = typeof table === "string" ? table : table?.name;
    switch (name) {
      case "embedding_cache":
        return ["input_sha1"];
      case "registration_tokens":
        return ["token"];
      case "compute_resource_work":
        return ["id"];
      case "schema_invariant_test":
        return ["id"];
      default:
        return [];
    }
  },
}));

type ColumnRow = {
  column_name: string;
  column_default?: string | null;
  data_type: string;
  character_maximum_length?: number | null;
  is_nullable?: "YES" | "NO";
  numeric_precision?: number | null;
  numeric_scale?: number | null;
};

type QueryResult = { rows: Array<Record<string, any>> };

type MockClient = {
  connect: jest.Mock;
  end: jest.Mock;
  query: jest.Mock<Promise<QueryResult>, [string, ...any[]]>;
};

const embeddingSchemaDef: TableSchema = {
  name: "embedding_cache",
  primary_key: "input_sha1",
  fields: {
    input_sha1: { type: "string" },
    vector: { type: "array", pg_type: "TEXT[]" },
    model: { type: "string" },
    expire: { type: "timestamp" },
  },
  pg_indexes: ["expire"],
};

const embeddingSchema: DBSchema = {
  embedding_cache: embeddingSchemaDef,
};

const embeddingColumns: ColumnRow[] = [
  {
    column_name: "input_sha1",
    data_type: "text",
  },
  {
    column_name: "vector",
    data_type: "ARRAY",
  },
  {
    column_name: "model",
    data_type: "text",
  },
  {
    column_name: "expire",
    data_type: "timestamp without time zone",
  },
];

const embeddingIndexRows = createIndexesQueries(embeddingSchemaDef).map(
  ({ name }) => ({ name }),
);

const embeddingPrimaryKeyRows = [{ name: "input_sha1" }];

const registrationTokensSchema: DBSchema = {
  registration_tokens: SCHEMA.registration_tokens,
};

const registrationTokensColumns: ColumnRow[] = [
  { column_name: "token", data_type: "text" },
  { column_name: "descr", data_type: "text" },
  { column_name: "counter", data_type: "double precision" },
  { column_name: "expires", data_type: "timestamp without time zone" },
  { column_name: "limit", data_type: "double precision" },
  { column_name: "disabled", data_type: "boolean" },
  { column_name: "ephemeral", data_type: "double precision" },
  { column_name: "customize", data_type: "jsonb" },
];

const registrationTokensIndexRows = createIndexesQueries(
  SCHEMA.registration_tokens,
).map(({ name }) => ({ name }));

const registrationTokensPrimaryKeyRows = [{ name: "token" }];

const computeWorkSchema: DBSchema = {
  compute_resource_work: SCHEMA.compute_resource_work,
};

const invariantSchemaDef: TableSchema = {
  name: "schema_invariant_test",
  primary_key: "id",
  fields: {
    id: { type: "uuid" },
    state: {
      type: "map",
      pg_default: "'{}'::jsonb",
      not_null: true,
      pg_null_backfill: "'{}'::jsonb",
    },
    started_at: {
      type: "timestamp",
      pg_default: "now()",
      not_null: true,
      pg_null_backfill: "now()",
    },
  },
};

const invariantSchema: DBSchema = {
  schema_invariant_test: invariantSchemaDef,
};

const invariantPrimaryKeyRows = [{ name: "id" }];

describe("schema column type introspection", () => {
  it("preserves numeric precision and scale", () => {
    expect(
      columnTypeFromInformationSchema({
        column_name: "cost",
        data_type: "numeric",
        numeric_precision: 20,
        numeric_scale: 10,
      }),
    ).toBe("numeric(20,10)");
  });

  it("preserves unconstrained numeric and varchar types", () => {
    expect(
      columnTypeFromInformationSchema({
        column_name: "amount",
        data_type: "numeric",
        numeric_precision: null,
        numeric_scale: null,
      }),
    ).toBe("numeric");
    expect(
      columnTypeFromInformationSchema({
        column_name: "name",
        data_type: "character varying",
        character_maximum_length: 127,
      }),
    ).toBe("varchar(127)");
  });
});

describe("custom index generation", () => {
  it("wraps non-function expression indexes in expression parentheses", () => {
    const index = createIndexesQueries(SCHEMA.legacy_migration_accounts).find(
      ({ name }) =>
        name === "legacy_migration_accounts_gmail_canonical_email_idx",
    );

    expect(index?.query.trimStart().startsWith("((")).toBe(true);
    expect(index?.query).toContain("|| '@gmail.com'");
  });
});

function createMockClient(options: {
  tableName: string;
  columnRows: ColumnRow[];
  indexRows: Array<{ name: string }>;
  primaryKeyRows: Array<{ name: string }>;
  extraTables?: string[];
  hasLegacyAiUsageLogTable?: boolean;
  hasLegacyMembershipTierColumn?: boolean;
}): MockClient {
  const {
    tableName,
    columnRows,
    indexRows,
    primaryKeyRows,
    extraTables = [],
    hasLegacyAiUsageLogTable = false,
    hasLegacyMembershipTierColumn = false,
  } = options;

  const query = jest.fn(async (text: string, params?: any[]) => {
    if (text.includes("SELECT EXISTS") && text.includes("compute_servers")) {
      return { rows: [{ exists: false }] };
    }
    if (
      text.includes("SELECT EXISTS") &&
      text.includes("FROM pg_tables") &&
      text.includes("tablename = $1")
    ) {
      const table = params?.[0];
      return {
        rows: [
          {
            exists:
              table === "openai_chatgpt_log"
                ? hasLegacyAiUsageLogTable
                : table === "membership_tiers"
                  ? tableName === "membership_tiers" ||
                    extraTables.includes("membership_tiers")
                  : false,
          },
        ],
      };
    }
    if (text.includes("SELECT tablename FROM pg_tables")) {
      return {
        rows: [
          { tablename: tableName },
          ...extraTables.map((t) => ({ tablename: t })),
        ],
      };
    }
    if (text.includes("FROM information_schema.columns")) {
      if (text.includes("column_name = $2")) {
        return {
          rows: [
            {
              exists:
                params?.[0] === "membership_tiers" &&
                params?.[1] === "llm_limits"
                  ? hasLegacyMembershipTierColumn
                  : false,
            },
          ],
        };
      }
      return { rows: columnRows };
    }
    if (text.includes("FROM pg_constraint AS constraint_row")) {
      return { rows: [] };
    }
    if (text.includes("FROM pg_class AS a JOIN pg_index AS b")) {
      return { rows: indexRows };
    }
    if (text.includes("FROM   pg_index i")) {
      return { rows: primaryKeyRows };
    }
    if (text.includes("WITH batch AS MATERIALIZED")) {
      return { rows: [] };
    }
    if (
      text.includes("SELECT EXISTS") &&
      text.includes('FROM "schema_invariant_test"')
    ) {
      return { rows: [{ exists: false }] };
    }
    if (
      text.startsWith("ALTER TABLE ") ||
      text.startsWith("DROP INDEX ") ||
      text.startsWith("UPDATE ") ||
      text === "BEGIN" ||
      text === "COMMIT" ||
      text === "ROLLBACK"
    ) {
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${text}`);
  });

  return {
    connect: jest.fn().mockResolvedValue(undefined),
    end: jest.fn().mockResolvedValue(undefined),
    query,
  };
}

describe("schemaNeedsSync column actions", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("returns false when array column types match the schema", async () => {
    const client = createMockClient({
      tableName: "embedding_cache",
      columnRows: embeddingColumns,
      indexRows: embeddingIndexRows,
      primaryKeyRows: embeddingPrimaryKeyRows,
    });
    (getClient as jest.Mock).mockReturnValue(client);

    const result = await schemaNeedsSync(embeddingSchema);

    expect(result).toBe(false);
  });

  it("returns true when a non-array column type mismatches", async () => {
    const columnRows = embeddingColumns.map((row) =>
      row.column_name === "model" ? { ...row, data_type: "integer" } : row,
    );
    const client = createMockClient({
      tableName: "embedding_cache",
      columnRows,
      indexRows: embeddingIndexRows,
      primaryKeyRows: embeddingPrimaryKeyRows,
    });
    (getClient as jest.Mock).mockReturnValue(client);

    const result = await schemaNeedsSync(embeddingSchema);

    expect(result).toBe(true);
  });

  it("adds a missing BIGSERIAL column with its unique constraint", async () => {
    const client = createMockClient({
      tableName: "compute_resource_work",
      columnRows: Object.entries(SCHEMA.compute_resource_work.fields)
        .filter(([name]) => name !== "queue_order")
        .map(([column_name, field]) => ({
          column_name,
          data_type:
            field.pg_type === "UUID"
              ? "uuid"
              : field.type === "timestamp"
                ? "timestamp without time zone"
                : "text",
        })),
      indexRows: createIndexesQueries(SCHEMA.compute_resource_work).map(
        ({ name }) => ({ name }),
      ),
      primaryKeyRows: [{ name: "id" }],
    });
    (getClient as jest.Mock).mockReturnValue(client);

    await syncSchema(computeWorkSchema);

    expect(client.query).toHaveBeenCalledWith(
      'ALTER TABLE "compute_resource_work" ADD COLUMN "queue_order" BIGSERIAL UNIQUE',
    );
  });

  it("returns false when double precision types match number fields", async () => {
    const client = createMockClient({
      tableName: "registration_tokens",
      columnRows: registrationTokensColumns,
      indexRows: registrationTokensIndexRows,
      primaryKeyRows: registrationTokensPrimaryKeyRows,
    });
    (getClient as jest.Mock).mockReturnValue(client);

    const result = await schemaNeedsSync(registrationTokensSchema);

    expect(result).toBe(false);
  });

  it("returns true when a legacy ai usage log table rename is pending", async () => {
    const client = createMockClient({
      tableName: "embedding_cache",
      columnRows: embeddingColumns,
      indexRows: embeddingIndexRows,
      primaryKeyRows: embeddingPrimaryKeyRows,
      hasLegacyAiUsageLogTable: true,
    });
    (getClient as jest.Mock).mockReturnValue(client);

    const result = await schemaNeedsSync(embeddingSchema);

    expect(result).toBe(true);
  });

  it("returns true when a legacy membership tier ai_limits rename is pending", async () => {
    const client = createMockClient({
      tableName: "embedding_cache",
      columnRows: embeddingColumns,
      indexRows: embeddingIndexRows,
      primaryKeyRows: embeddingPrimaryKeyRows,
      extraTables: ["membership_tiers"],
      hasLegacyMembershipTierColumn: true,
    });
    (getClient as jest.Mock).mockReturnValue(client);

    const result = await schemaNeedsSync(embeddingSchema);

    expect(result).toBe(true);
  });

  it("renames legacy storage identifiers before syncing", async () => {
    const client = createMockClient({
      tableName: "embedding_cache",
      columnRows: embeddingColumns,
      indexRows: embeddingIndexRows,
      primaryKeyRows: embeddingPrimaryKeyRows,
      extraTables: ["membership_tiers"],
      hasLegacyAiUsageLogTable: true,
      hasLegacyMembershipTierColumn: true,
    });
    (getClient as jest.Mock).mockReturnValue(client);

    await syncSchema(embeddingSchema);

    expect(client.query).toHaveBeenCalledWith(
      "ALTER TABLE openai_chatgpt_log RENAME TO ai_usage_log",
    );
    expect(client.query).toHaveBeenCalledWith(
      "ALTER TABLE membership_tiers RENAME COLUMN llm_limits TO ai_limits",
    );
  });

  it("drops stale PGlite indexes without CONCURRENTLY", async () => {
    const originalDatabase = process.env.COCALC_DB;
    process.env.COCALC_DB = "pglite";
    const client = createMockClient({
      tableName: "embedding_cache",
      columnRows: embeddingColumns,
      indexRows: [...embeddingIndexRows, { name: "embedding_cache_stale_idx" }],
      primaryKeyRows: embeddingPrimaryKeyRows,
    });
    (getClient as jest.Mock).mockReturnValue(client);

    try {
      await syncSchema(embeddingSchema);
      expect(client.query).toHaveBeenCalledWith(
        'DROP INDEX IF EXISTS "embedding_cache_stale_idx"',
      );
    } finally {
      if (originalDatabase == null) {
        delete process.env.COCALC_DB;
      } else {
        process.env.COCALC_DB = originalDatabase;
      }
    }
  });

  it("detects and repairs declared defaults and nullability", async () => {
    const client = createMockClient({
      tableName: "schema_invariant_test",
      columnRows: [
        { column_name: "id", data_type: "uuid", is_nullable: "NO" },
        {
          column_name: "state",
          data_type: "jsonb",
          column_default: null,
          is_nullable: "YES",
        },
        {
          column_name: "started_at",
          data_type: "timestamp without time zone",
          column_default: null,
          is_nullable: "YES",
        },
      ],
      indexRows: [],
      primaryKeyRows: invariantPrimaryKeyRows,
    });
    (getClient as jest.Mock).mockReturnValue(client);

    expect(await schemaNeedsSync(invariantSchema)).toBe(true);
    await syncSchema(invariantSchema);

    expect(client.query).toHaveBeenCalledWith(
      `ALTER TABLE "schema_invariant_test" ALTER COLUMN "state" SET DEFAULT '{}'::jsonb`,
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining(
        `ADD CONSTRAINT "${notNullGuardName(
          "schema_invariant_test",
          "state",
        )}" CHECK ("state" IS NOT NULL) NOT VALID`,
      ),
    );
    expect(client.query).toHaveBeenCalledWith(
      `ALTER TABLE "schema_invariant_test" ALTER COLUMN "state" SET NOT NULL`,
    );
    expect(client.query).toHaveBeenCalledWith(
      `ALTER TABLE "schema_invariant_test" ALTER COLUMN "started_at" SET DEFAULT now()`,
    );
  });

  it("accepts PostgreSQL-normalized declared invariants", async () => {
    const client = createMockClient({
      tableName: "schema_invariant_test",
      columnRows: [
        { column_name: "id", data_type: "uuid", is_nullable: "NO" },
        {
          column_name: "state",
          data_type: "jsonb",
          column_default: "'{}'::jsonb",
          is_nullable: "NO",
        },
        {
          column_name: "started_at",
          data_type: "timestamp without time zone",
          column_default: "now()",
          is_nullable: "NO",
        },
      ],
      indexRows: [],
      primaryKeyRows: invariantPrimaryKeyRows,
    });
    (getClient as jest.Mock).mockReturnValue(client);

    expect(await schemaNeedsSync(invariantSchema)).toBe(false);
  });
});
