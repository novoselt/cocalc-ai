/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { SCHEMA } from "./types";
import "./crm";

const TABLES_WITH_CREATED_AT = [
  "crm_organizations",
  "crm_organization_domains",
  "crm_people",
  "crm_person_emails",
  "crm_person_accounts",
  "crm_organization_people",
  "crm_external_references",
  "crm_opportunities",
  "crm_tasks",
  "crm_activities",
  "crm_metric_snapshots",
  "crm_mutation_events",
] as const;

describe("normalized CRM database schema", () => {
  it("creates timezone-aware timestamps with database defaults", () => {
    for (const table of TABLES_WITH_CREATED_AT) {
      expect(SCHEMA[table].fields.created_at).toMatchObject({
        pg_type: "TIMESTAMPTZ",
        pg_default: "now()",
        not_null: true,
      });
    }
    expect(SCHEMA.crm_organizations.fields.updated_at).toMatchObject({
      pg_type: "TIMESTAMPTZ",
      pg_default: "now()",
      not_null: true,
    });
  });

  it("declares write-critical defaults and nullability", () => {
    expect(SCHEMA.crm_organizations.fields.aliases).toMatchObject({
      pg_default: "'{}'::text[]",
      not_null: true,
    });
    expect(SCHEMA.crm_organizations.fields.status).toMatchObject({
      pg_default: "'active'::text",
      not_null: true,
    });
    expect(SCHEMA.crm_opportunities.fields.expected_value).toMatchObject({
      pg_type: "NUMERIC(20,10)",
      pg_default: "0",
      not_null: true,
    });
    expect(SCHEMA.crm_opportunities.fields.expected_close_date).toMatchObject({
      pg_type: "DATE",
      not_null: true,
    });
    expect(SCHEMA.crm_mutation_events.fields.metadata).toMatchObject({
      pg_default: "'{}'::jsonb",
      not_null: true,
    });
  });

  it("does not expose normalized CRM records through user_query", () => {
    for (const table of TABLES_WITH_CREATED_AT) {
      expect(SCHEMA[table].user_query).toBeUndefined();
    }
  });
});
