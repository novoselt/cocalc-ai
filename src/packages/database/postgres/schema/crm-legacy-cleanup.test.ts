/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { cleanupLegacyCrmBeforeSchemaSync } from "./crm-legacy-cleanup";

function mockDatabase({ nonempty }: { nonempty?: string } = {}) {
  const types: Record<string, string> = {
    "crm_support_messages.id": "integer",
    "crm_support_tickets.id": "integer",
    "crm_tags.id": "integer",
    "crm_leads.id": "integer",
    "crm_organizations.id": "integer",
    "crm_people.id": "integer",
    "crm_tasks.id": "integer",
    "commercial_orders.crm_organization_id": "integer",
    "commercial_order_contacts.crm_person_id": "integer",
  };
  const query = jest.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("information_schema.columns")) {
      const key = `${values?.[0]}.${values?.[1]}`;
      return { rows: types[key] ? [{ data_type: types[key] }] : [] };
    }
    const countTable = sql.match(/FROM ([a-z_]+)(?: WHERE|$)/)?.[1];
    if (sql.includes("count(*)") && countTable) {
      return { rows: [{ count: countTable === nonempty ? "1" : "0" }] };
    }
    return { rows: [] };
  });
  return { query };
}

const schema = {
  crm_organizations: { fields: { id: { type: "uuid" } } },
  commercial_orders: {
    fields: { crm_organization_id: { type: "uuid" } },
  },
  commercial_order_contacts: {
    fields: { crm_person_id: { type: "uuid" } },
  },
} as any;

describe("legacy CRM pre-schema cleanup", () => {
  it("drops only empty legacy tables and replaces empty integer references", async () => {
    const db = mockDatabase();
    await cleanupLegacyCrmBeforeSchemaSync(db as any, schema);
    expect(db.query).toHaveBeenCalledWith(
      "DROP TABLE crm_support_messages,crm_support_tickets,crm_tags,crm_leads,crm_organizations,crm_people,crm_tasks CASCADE",
    );
    expect(db.query).toHaveBeenCalledWith(
      "ALTER TABLE commercial_orders DROP COLUMN crm_organization_id",
    );
    expect(db.query).toHaveBeenCalledWith(
      "ALTER TABLE commercial_orders ADD COLUMN crm_organization_id UUID",
    );
    expect(db.query).toHaveBeenCalledWith(
      "ALTER TABLE commercial_order_contacts DROP COLUMN crm_person_id",
    );
    expect(db.query).toHaveBeenCalledWith(
      "ALTER TABLE commercial_order_contacts ADD COLUMN crm_person_id UUID",
    );
  });

  it("fails closed before dropping unexpected legacy data", async () => {
    const db = mockDatabase({ nonempty: "crm_people" });
    await expect(
      cleanupLegacyCrmBeforeSchemaSync(db as any, schema),
    ).rejects.toThrow("legacy crm_people contains 1 rows");
    expect(
      db.query.mock.calls.some(([sql]) => `${sql}`.startsWith("DROP TABLE")),
    ).toBe(false);
  });
});
