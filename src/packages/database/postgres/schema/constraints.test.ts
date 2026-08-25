/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { TableSchema } from "./types";
import {
  getConstraintActions,
  syncTableSchemaConstraints,
} from "./constraints";

const schema: TableSchema = {
  name: "constraint_test_children",
  primary_key: "id",
  fields: {
    id: { type: "uuid" },
    parent_id: { type: "uuid" },
    state: { type: "string" },
  },
  pg_constraints: [
    {
      name: "constraint_test_children_parent_fk",
      type: "foreign-key",
      columns: ["parent_id"],
      references: { table: "constraint_test_parents", columns: ["id"] },
    },
    {
      name: "constraint_test_children_state_check",
      type: "check",
      expression: "state IN ('open','closed')",
    },
  ],
};

function currentConstraint(overrides: Record<string, unknown>) {
  return {
    name: "constraint",
    type: "f",
    validated: true,
    columns: [],
    expression: null,
    referenced_table: null,
    referenced_columns: [],
    on_delete: "a",
    on_update: "a",
    ...overrides,
  };
}

describe("declarative table constraints", () => {
  it("recognizes structurally equivalent foreign keys and named checks", async () => {
    const db = {
      query: jest.fn().mockResolvedValue({
        rows: [
          currentConstraint({
            name: "legacy_parent_fk_name",
            columns: "{parent_id}",
            referenced_table: "constraint_test_parents",
            referenced_columns: "{id}",
          }),
          currentConstraint({
            name: "constraint_test_children_state_check",
            type: "c",
            columns: ["state"],
            expression: "(state = ANY (ARRAY['open'::text, 'closed'::text]))",
            on_delete: " ",
            on_update: " ",
          }),
        ],
      }),
    };

    expect(await getConstraintActions(db as any, schema)).toEqual([]);
  });

  it("adds missing constraints using quoted identifiers", async () => {
    const db = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({ rows: [] }),
    };

    await syncTableSchemaConstraints(db as any, {
      ...schema,
      pg_constraints: [schema.pg_constraints![0]],
    });

    expect(db.query).toHaveBeenLastCalledWith(
      'ALTER TABLE "constraint_test_children" ADD CONSTRAINT "constraint_test_children_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "constraint_test_parents" ("id")',
    );
  });
});
