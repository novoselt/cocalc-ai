/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import getPool, { type PoolClient } from "@cocalc/database/pool";

let schemaReady: Promise<void> | undefined;

async function columnType(
  client: PoolClient,
  table: string,
  column: string,
): Promise<string | undefined> {
  const { rows } = await client.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column],
  );
  return rows[0]?.data_type;
}

async function tableCount(client: PoolClient, table: string): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table}`,
  );
  return Number(rows[0]?.count ?? 0);
}

async function dropLegacyCrm(client: PoolClient): Promise<void> {
  await client.query(
    `DROP TABLE IF EXISTS
       crm_support_messages,
       crm_support_tickets,
       crm_tags,
       crm_leads
     CASCADE`,
  );
  for (const table of ["crm_organizations", "crm_people", "crm_tasks"]) {
    const type = await columnType(client, table, "id");
    if (type !== "integer" && type !== "bigint") continue;
    const count = await tableCount(client, table);
    if (count !== 0) {
      throw Error(
        `refusing to replace legacy ${table}: expected an empty table, found ${count} rows`,
      );
    }
    await client.query(`DROP TABLE ${table} CASCADE`);
  }
}

async function replaceUnusedIntegerReference(
  client: PoolClient,
  table: string,
  column: string,
): Promise<void> {
  const type = await columnType(client, table, column);
  if (type !== "integer" && type !== "bigint") return;
  const { rows } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table} WHERE ${column} IS NOT NULL`,
  );
  const count = Number(rows[0]?.count ?? 0);
  if (count !== 0) {
    throw Error(
      `refusing to replace ${table}.${column}: found ${count} non-null legacy references`,
    );
  }
  await client.query(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  await client.query(`ALTER TABLE ${table} ADD COLUMN ${column} UUID`);
}

async function hasConstraintForColumns(
  client: PoolClient,
  table: string,
  type: "f" | "u",
  columns: readonly string[],
): Promise<boolean> {
  const { rows } = await client.query<{ columns: string[] }>(
    `SELECT to_json(array_agg(attribute.attname ORDER BY key.ordinality)) AS columns
       FROM pg_constraint constraint_row
       CROSS JOIN LATERAL unnest(constraint_row.conkey)
         WITH ORDINALITY AS key(attnum, ordinality)
       JOIN pg_attribute attribute
         ON attribute.attrelid=constraint_row.conrelid
        AND attribute.attnum=key.attnum
      WHERE constraint_row.conrelid=to_regclass($1)
        AND constraint_row.contype=$2
      GROUP BY constraint_row.oid`,
    [table, type],
  );
  if (
    rows.some(
      (row) =>
        row.columns.length === columns.length &&
        row.columns.every((column, index) => column === columns[index]),
    )
  ) {
    return true;
  }
  if (type !== "u") return false;
  const indexes = await client.query<{ columns: string[] }>(
    `SELECT to_json(array_agg(attribute.attname ORDER BY key.ordinality)) AS columns
       FROM pg_index index_row
       CROSS JOIN LATERAL unnest(index_row.indkey::smallint[])
         WITH ORDINALITY AS key(attnum, ordinality)
       JOIN pg_attribute attribute
         ON attribute.attrelid=index_row.indrelid
        AND attribute.attnum=key.attnum
      WHERE index_row.indrelid=to_regclass($1)
        AND index_row.indisunique
        AND NOT index_row.indisprimary
      GROUP BY index_row.indexrelid`,
    [table],
  );
  return indexes.rows.some(
    (row) =>
      row.columns.length === columns.length &&
      row.columns.every((column, index) => column === columns[index]),
  );
}

async function ensureColumnConstraint(
  client: PoolClient,
  opts: {
    table: string;
    name: string;
    type: "f" | "u";
    columns: readonly string[];
    definition: string;
  },
): Promise<void> {
  if (
    await hasConstraintForColumns(client, opts.table, opts.type, opts.columns)
  ) {
    return;
  }
  await client.query(
    `ALTER TABLE ${opts.table} ADD CONSTRAINT ${opts.name} ${opts.definition}`,
  );
}

async function ensureCheckConstraints(
  client: PoolClient,
  table: string,
  checks: Array<{ name: string; expression: string }>,
): Promise<void> {
  const { rows } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM pg_constraint
      WHERE conrelid=to_regclass($1) AND contype='c'`,
    [table],
  );
  if (Number(rows[0]?.count ?? 0) !== 0) return;
  for (const check of checks) {
    await client.query(
      `ALTER TABLE ${table} ADD CONSTRAINT ${check.name} CHECK (${check.expression})`,
    );
  }
}

async function ensureRelationalConstraints(client: PoolClient): Promise<void> {
  const uniqueConstraints = [
    {
      table: "crm_organizations",
      name: "crm_organizations_customer_number_key",
      columns: ["customer_number"],
      definition: "UNIQUE (customer_number)",
    },
    {
      table: "crm_organization_domains",
      name: "crm_organization_domains_organization_domain_key",
      columns: ["organization_id", "normalized_domain"],
      definition: "UNIQUE (organization_id,normalized_domain)",
    },
    {
      table: "crm_person_emails",
      name: "crm_person_emails_person_email_key",
      columns: ["person_id", "normalized_email"],
      definition: "UNIQUE (person_id,normalized_email)",
    },
    {
      table: "crm_person_accounts",
      name: "crm_person_accounts_person_account_key",
      columns: ["person_id", "account_id"],
      definition: "UNIQUE (person_id,account_id)",
    },
    {
      table: "crm_organization_people",
      name: "crm_organization_people_organization_person_key",
      columns: ["organization_id", "person_id"],
      definition: "UNIQUE (organization_id,person_id)",
    },
    {
      table: "crm_external_references",
      name: "crm_external_references_provider_object_key",
      columns: ["provider", "object_kind", "external_id"],
      definition: "UNIQUE (provider,object_kind,external_id)",
    },
    {
      table: "crm_activities",
      name: "crm_activities_source_key",
      columns: ["organization_id", "source", "source_id"],
      definition: "UNIQUE (organization_id,source,source_id)",
    },
    {
      table: "crm_mutation_events",
      name: "crm_mutation_events_idempotency_key",
      columns: ["actor_account_id", "action", "idempotency_key"],
      definition: "UNIQUE (actor_account_id,action,idempotency_key)",
    },
  ] as const;
  for (const constraint of uniqueConstraints) {
    await ensureColumnConstraint(client, { ...constraint, type: "u" });
  }

  const foreignKeys = [
    ["crm_organizations", "parent_organization_id", "crm_organizations(id)"],
    [
      "crm_organizations",
      "merged_into_organization_id",
      "crm_organizations(id)",
    ],
    ["crm_organization_domains", "organization_id", "crm_organizations(id)"],
    ["crm_people", "merged_into_person_id", "crm_people(id)"],
    ["crm_person_emails", "person_id", "crm_people(id)"],
    ["crm_person_accounts", "person_id", "crm_people(id)"],
    ["crm_organization_people", "organization_id", "crm_organizations(id)"],
    ["crm_organization_people", "person_id", "crm_people(id)"],
    ["crm_opportunities", "organization_id", "crm_organizations(id)"],
    ["crm_tasks", "organization_id", "crm_organizations(id)"],
    ["crm_tasks", "person_id", "crm_people(id)"],
    ["crm_tasks", "opportunity_id", "crm_opportunities(id)"],
    ["crm_external_references", "organization_id", "crm_organizations(id)"],
    ["crm_external_references", "person_id", "crm_people(id)"],
    ["crm_external_references", "opportunity_id", "crm_opportunities(id)"],
    ["crm_activities", "organization_id", "crm_organizations(id)"],
    ["crm_activities", "person_id", "crm_people(id)"],
    ["crm_activities", "opportunity_id", "crm_opportunities(id)"],
    ["crm_activities", "task_id", "crm_tasks(id)"],
    ["crm_activities", "supersedes_activity_id", "crm_activities(id)"],
    ["crm_metric_snapshots", "organization_id", "crm_organizations(id)"],
    ["crm_mutation_events", "organization_id", "crm_organizations(id)"],
  ] as const;
  for (const [table, column, target] of foreignKeys) {
    await ensureColumnConstraint(client, {
      table,
      name: `${table}_${column}_crm_fk`.slice(0, 63),
      type: "f",
      columns: [column],
      definition: `FOREIGN KEY (${column}) REFERENCES ${target}`,
    });
  }

  await ensureCheckConstraints(client, "crm_organizations", [
    {
      name: "crm_organizations_status_crm_check",
      expression: "status IN ('active','merged','archived')",
    },
    { name: "crm_organizations_version_crm_check", expression: "version>0" },
    {
      name: "crm_organizations_parent_crm_check",
      expression: "id IS DISTINCT FROM parent_organization_id",
    },
    {
      name: "crm_organizations_merge_crm_check",
      expression: "id IS DISTINCT FROM merged_into_organization_id",
    },
  ]);
  await ensureCheckConstraints(client, "crm_organization_domains", [
    {
      name: "crm_organization_domains_kind_crm_check",
      expression: "kind IN ('primary','secondary','department','legacy')",
    },
    {
      name: "crm_organization_domains_state_crm_check",
      expression: "state IN ('suggested','verified','rejected','retired')",
    },
  ]);
  await ensureCheckConstraints(client, "crm_people", [
    {
      name: "crm_people_status_crm_check",
      expression: "status IN ('active','merged','archived')",
    },
    {
      name: "crm_people_merge_crm_check",
      expression: "id IS DISTINCT FROM merged_into_person_id",
    },
  ]);
  await ensureCheckConstraints(client, "crm_person_emails", [
    {
      name: "crm_person_emails_kind_crm_check",
      expression: "kind IN ('work','billing','personal','other')",
    },
  ]);
  await ensureCheckConstraints(client, "crm_person_accounts", [
    {
      name: "crm_person_accounts_state_crm_check",
      expression: "state IN ('suggested','verified','rejected','retired')",
    },
  ]);
  await ensureCheckConstraints(client, "crm_organization_people", [
    {
      name: "crm_organization_people_state_crm_check",
      expression: "state IN ('active','former','retired')",
    },
  ]);
  await ensureCheckConstraints(client, "crm_opportunities", [
    {
      name: "crm_opportunities_value_crm_check",
      expression: "expected_value>=0",
    },
  ]);
  await ensureCheckConstraints(client, "crm_tasks", [
    {
      name: "crm_tasks_state_crm_check",
      expression: "state IN ('open','waiting','completed','cancelled')",
    },
    {
      name: "crm_tasks_priority_crm_check",
      expression: "priority IN ('low','normal','high','urgent')",
    },
  ]);
  await ensureCheckConstraints(client, "crm_external_references", [
    {
      name: "crm_external_references_state_crm_check",
      expression:
        "verification_state IN ('suggested','verified','rejected','retired')",
    },
  ]);
}

async function createSchema(client: PoolClient): Promise<void> {
  await client.query(`CREATE SEQUENCE IF NOT EXISTS crm_customer_number_seq`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS crm_organizations (
      id UUID PRIMARY KEY,
      customer_number VARCHAR(40) NOT NULL UNIQUE,
      display_name VARCHAR(500) NOT NULL,
      legal_name VARCHAR(500),
      aliases TEXT[] NOT NULL DEFAULT '{}',
      website TEXT,
      timezone VARCHAR(100),
      organization_type VARCHAR(40) NOT NULL,
      lifecycle_stage VARCHAR(40) NOT NULL,
      relationship_owner_account_id UUID,
      parent_organization_id UUID REFERENCES crm_organizations(id),
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      merged_into_organization_id UUID REFERENCES crm_organizations(id),
      created_by_account_id UUID NOT NULL,
      updated_by_account_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      version INTEGER NOT NULL DEFAULT 1,
      CHECK (status IN ('active','merged','archived')),
      CHECK (version > 0),
      CHECK (id IS DISTINCT FROM parent_organization_id),
      CHECK (id IS DISTINCT FROM merged_into_organization_id)
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS crm_organization_domains (
      id UUID PRIMARY KEY,
      organization_id UUID NOT NULL REFERENCES crm_organizations(id),
      normalized_domain VARCHAR(253) NOT NULL,
      display_domain VARCHAR(253) NOT NULL,
      kind VARCHAR(24) NOT NULL,
      state VARCHAR(24) NOT NULL,
      verification_method VARCHAR(100),
      evidence_reference VARCHAR(1000),
      generic_domain BOOLEAN NOT NULL DEFAULT FALSE,
      created_by_account_id UUID NOT NULL,
      updated_by_account_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      verified_at TIMESTAMPTZ,
      retired_at TIMESTAMPTZ,
      version INTEGER NOT NULL DEFAULT 1,
      UNIQUE (organization_id, normalized_domain),
      CHECK (kind IN ('primary','secondary','department','legacy')),
      CHECK (state IN ('suggested','verified','rejected','retired'))
    )`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS crm_one_verified_domain
    ON crm_organization_domains(normalized_domain)
    WHERE state='verified'`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS crm_people (
      id UUID PRIMARY KEY,
      display_name VARCHAR(500) NOT NULL,
      timezone VARCHAR(100),
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      merged_into_person_id UUID REFERENCES crm_people(id),
      created_by_account_id UUID NOT NULL,
      updated_by_account_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      version INTEGER NOT NULL DEFAULT 1,
      CHECK (status IN ('active','merged','archived')),
      CHECK (id IS DISTINCT FROM merged_into_person_id)
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS crm_person_emails (
      id UUID PRIMARY KEY,
      person_id UUID NOT NULL REFERENCES crm_people(id),
      email_address VARCHAR(254) NOT NULL,
      normalized_email VARCHAR(254) NOT NULL,
      kind VARCHAR(20) NOT NULL DEFAULT 'work',
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      verified BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      version INTEGER NOT NULL DEFAULT 1,
      UNIQUE (person_id, normalized_email),
      CHECK (kind IN ('work','billing','personal','other'))
    )`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS crm_one_primary_email
    ON crm_person_emails(person_id) WHERE is_primary`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS crm_person_accounts (
      id UUID PRIMARY KEY,
      person_id UUID NOT NULL REFERENCES crm_people(id),
      account_id UUID NOT NULL,
      state VARCHAR(20) NOT NULL DEFAULT 'suggested',
      evidence_reference VARCHAR(1000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      version INTEGER NOT NULL DEFAULT 1,
      UNIQUE (person_id, account_id),
      CHECK (state IN ('suggested','verified','rejected','retired'))
    )`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS crm_one_verified_person_per_account
    ON crm_person_accounts(account_id) WHERE state='verified'`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS crm_organization_people (
      id UUID PRIMARY KEY,
      organization_id UUID NOT NULL REFERENCES crm_organizations(id),
      person_id UUID NOT NULL REFERENCES crm_people(id),
      roles TEXT[] NOT NULL DEFAULT '{}',
      title VARCHAR(300),
      department VARCHAR(300),
      state VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      version INTEGER NOT NULL DEFAULT 1,
      UNIQUE (organization_id, person_id),
      CHECK (state IN ('active','former','retired'))
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS crm_opportunities (
      id UUID PRIMARY KEY,
      organization_id UUID NOT NULL REFERENCES crm_organizations(id),
      name VARCHAR(500) NOT NULL,
      kind VARCHAR(40) NOT NULL,
      stage VARCHAR(40) NOT NULL DEFAULT 'discovery',
      owner_account_id UUID NOT NULL,
      expected_value NUMERIC(20,10) NOT NULL DEFAULT 0,
      currency CHAR(3) NOT NULL DEFAULT 'usd',
      expected_close_date DATE NOT NULL,
      service_starts_at TIMESTAMPTZ,
      service_ends_at TIMESTAMPTZ,
      loss_reason VARCHAR(1000),
      commercial_order_id UUID,
      source_zendesk_ticket_ids INTEGER[] NOT NULL DEFAULT '{}',
      description VARCHAR(10000),
      created_by_account_id UUID NOT NULL,
      updated_by_account_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      version INTEGER NOT NULL DEFAULT 1,
      CHECK (expected_value >= 0)
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS crm_tasks (
      id UUID PRIMARY KEY,
      organization_id UUID NOT NULL REFERENCES crm_organizations(id),
      person_id UUID REFERENCES crm_people(id),
      opportunity_id UUID REFERENCES crm_opportunities(id),
      commercial_order_id UUID,
      zendesk_ticket_id INTEGER,
      type VARCHAR(40) NOT NULL,
      state VARCHAR(20) NOT NULL DEFAULT 'open',
      assignee_account_id UUID NOT NULL,
      due_at TIMESTAMPTZ NOT NULL,
      priority VARCHAR(20) NOT NULL DEFAULT 'normal',
      subject VARCHAR(500) NOT NULL,
      details VARCHAR(10000),
      created_by_account_id UUID NOT NULL,
      updated_by_account_id UUID NOT NULL,
      completed_by_account_id UUID,
      cancelled_by_account_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      version INTEGER NOT NULL DEFAULT 1,
      CHECK (state IN ('open','waiting','completed','cancelled')),
      CHECK (priority IN ('low','normal','high','urgent'))
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS crm_external_references (
      id UUID PRIMARY KEY,
      organization_id UUID NOT NULL REFERENCES crm_organizations(id),
      person_id UUID REFERENCES crm_people(id),
      opportunity_id UUID REFERENCES crm_opportunities(id),
      provider VARCHAR(40) NOT NULL,
      object_kind VARCHAR(40) NOT NULL,
      external_id VARCHAR(500) NOT NULL,
      label VARCHAR(500),
      metadata JSONB NOT NULL DEFAULT '{}',
      verification_state VARCHAR(20) NOT NULL DEFAULT 'suggested',
      created_by_account_id UUID NOT NULL,
      updated_by_account_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      version INTEGER NOT NULL DEFAULT 1,
      UNIQUE (provider, object_kind, external_id),
      CHECK (verification_state IN ('suggested','verified','rejected','retired'))
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS crm_activities (
      id UUID PRIMARY KEY,
      organization_id UUID NOT NULL REFERENCES crm_organizations(id),
      person_id UUID REFERENCES crm_people(id),
      opportunity_id UUID REFERENCES crm_opportunities(id),
      task_id UUID REFERENCES crm_tasks(id),
      commercial_order_id UUID,
      site_license_id UUID,
      zendesk_ticket_id INTEGER,
      kind VARCHAR(40) NOT NULL,
      source VARCHAR(80) NOT NULL,
      source_id VARCHAR(500) NOT NULL,
      summary VARCHAR(1000) NOT NULL,
      details VARCHAR(10000),
      actor_account_id UUID,
      occurred_at TIMESTAMPTZ NOT NULL,
      supersedes_activity_id UUID REFERENCES crm_activities(id),
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, source, source_id)
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS crm_metric_snapshots (
      id UUID PRIMARY KEY,
      organization_id UUID NOT NULL REFERENCES crm_organizations(id),
      generated_at TIMESTAMPTZ NOT NULL,
      scope VARCHAR(100) NOT NULL,
      metrics JSONB NOT NULL,
      provenance JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS crm_mutation_events (
      id UUID PRIMARY KEY,
      organization_id UUID REFERENCES crm_organizations(id),
      actor_account_id UUID NOT NULL,
      action VARCHAR(100) NOT NULL,
      reason VARCHAR(2000) NOT NULL,
      idempotency_key VARCHAR(500) NOT NULL,
      payload_hash CHAR(64) NOT NULL,
      result_type VARCHAR(80) NOT NULL,
      result_id UUID,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (actor_account_id, action, idempotency_key)
    )`);

  await ensureRelationalConstraints(client);

  for (const statement of [
    "CREATE INDEX IF NOT EXISTS crm_org_name_idx ON crm_organizations(lower(display_name))",
    "CREATE INDEX IF NOT EXISTS crm_org_owner_idx ON crm_organizations(relationship_owner_account_id)",
    "CREATE INDEX IF NOT EXISTS crm_org_updated_idx ON crm_organizations(updated_at DESC,id)",
    "CREATE INDEX IF NOT EXISTS crm_domain_org_idx ON crm_organization_domains(organization_id)",
    "CREATE INDEX IF NOT EXISTS crm_people_name_idx ON crm_people(lower(display_name))",
    "CREATE INDEX IF NOT EXISTS crm_people_updated_idx ON crm_people(updated_at DESC,id)",
    "CREATE INDEX IF NOT EXISTS crm_email_normalized_idx ON crm_person_emails(normalized_email)",
    "CREATE INDEX IF NOT EXISTS crm_org_people_org_idx ON crm_organization_people(organization_id)",
    "CREATE INDEX IF NOT EXISTS crm_opportunity_org_idx ON crm_opportunities(organization_id,stage)",
    "CREATE INDEX IF NOT EXISTS crm_task_queue_idx ON crm_tasks(state,due_at,assignee_account_id)",
    "CREATE INDEX IF NOT EXISTS crm_activity_timeline_idx ON crm_activities(organization_id,occurred_at DESC,id)",
    "CREATE INDEX IF NOT EXISTS crm_external_org_idx ON crm_external_references(organization_id)",
    "CREATE INDEX IF NOT EXISTS crm_metric_org_idx ON crm_metric_snapshots(organization_id,generated_at DESC)",
  ]) {
    await client.query(statement);
  }

  if (await columnType(client, "commercial_orders", "id")) {
    await replaceUnusedIntegerReference(
      client,
      "commercial_orders",
      "crm_organization_id",
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS commercial_orders_crm_organization_id_idx
       ON commercial_orders(crm_organization_id)`,
    );
  }
  if (await columnType(client, "commercial_order_contacts", "id")) {
    await replaceUnusedIntegerReference(
      client,
      "commercial_order_contacts",
      "crm_person_id",
    );
  }
  if (await columnType(client, "site_licenses", "id")) {
    await client.query(
      `ALTER TABLE site_licenses ADD COLUMN IF NOT EXISTS crm_organization_id UUID`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS site_licenses_crm_organization_id_idx
       ON site_licenses(crm_organization_id)`,
    );
  }
}

async function ensureCrmSchemaInner(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [0x43524d31]);
    await dropLegacyCrm(client);
    await createSchema(client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function ensureCrmSchema(): Promise<void> {
  schemaReady ??= ensureCrmSchemaInner().catch((err) => {
    schemaReady = undefined;
    throw err;
  });
  return await schemaReady;
}

export const __test__ = { columnType, dropLegacyCrm };
