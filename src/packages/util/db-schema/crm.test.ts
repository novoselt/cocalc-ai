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
    for (const field of [
      "website",
      "linkedin_url",
      "facebook_url",
      "x_url",
      "note",
    ]) {
      expect(SCHEMA.crm_people.fields[field]).toMatchObject({
        type: "string",
      });
      expect(SCHEMA.crm_people.fields[field].not_null).not.toBe(true);
    }
  });

  it("does not expose normalized CRM records through user_query", () => {
    for (const table of TABLES_WITH_CREATED_AT) {
      expect(SCHEMA[table].user_query).toBeUndefined();
    }
  });

  it("owns CRM sequences, relational constraints, and specialized indexes", () => {
    expect(SCHEMA.crm_organizations.pg_sequences).toEqual([
      "crm_customer_number_seq",
    ]);
    expect(SCHEMA.crm_organization_domains.pg_constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "crm_organization_domains_organization_domain_key",
          type: "unique",
        }),
        expect.objectContaining({
          name: "crm_organization_domains_organization_id_crm_fk",
          type: "foreign-key",
        }),
        expect.objectContaining({
          name: "crm_organization_domains_state_crm_check",
          type: "check",
        }),
      ]),
    );
    expect(SCHEMA.crm_organization_domains.pg_custom_indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "crm_one_verified_domain",
          unique: true,
        }),
      ]),
    );
    for (const table of TABLES_WITH_CREATED_AT) {
      expect(SCHEMA[table].pg_constraints?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
