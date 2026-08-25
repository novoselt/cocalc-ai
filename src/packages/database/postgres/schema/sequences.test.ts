/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { DBSchema } from "./types";
import { schemaSequencesNeedSync, syncSchemaSequences } from "./sequences";

const schema: DBSchema = {
  sequence_test: {
    name: "sequence_test",
    primary_key: "id",
    fields: { id: { type: "uuid" } },
    pg_sequences: ["sequence_test_counter"],
  },
};

describe("declarative auxiliary sequences", () => {
  it("detects and creates a missing sequence", async () => {
    const check = {
      query: jest.fn().mockResolvedValue({ rows: [{ exists: false }] }),
    };
    expect(await schemaSequencesNeedSync(check as any, schema)).toBe(true);

    const create = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [{ exists: false }] })
        .mockResolvedValue({ rows: [] }),
    };
    await syncSchemaSequences(create as any, schema);
    expect(create.query).toHaveBeenLastCalledWith(
      'CREATE SEQUENCE "sequence_test_counter"',
    );
  });

  it("rejects duplicate sequence ownership", async () => {
    const duplicate: DBSchema = {
      ...schema,
      another_sequence_test: {
        name: "another_sequence_test",
        primary_key: "id",
        fields: { id: { type: "uuid" } },
        pg_sequences: ["sequence_test_counter"],
      },
    };
    await expect(
      schemaSequencesNeedSync({ query: jest.fn() } as any, duplicate),
    ).rejects.toThrow("database sequences must be declared once");
  });
});
