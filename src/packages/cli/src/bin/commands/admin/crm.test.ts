import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Command } from "commander";

import { registerCrmCommand } from "./crm";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

function setup(adminCrm: Record<string, any>) {
  let output: unknown;
  const program = new Command();
  const admin = program.command("admin");
  registerCrmCommand(admin, {
    withContext: async (_command: unknown, _label: string, fn: any) => {
      output = await fn({ accountId: ACCOUNT_ID, hub: { adminCrm } });
      return output;
    },
    resolveAccountByIdentifier: async (_ctx: unknown, identifier: string) => ({
      account_id:
        identifier === "owner@example.edu"
          ? "22222222-2222-4222-8222-222222222222"
          : undefined,
    }),
    isValidUUID: (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      ),
  });
  return { program, output: () => output };
}

test("CRM help exposes the packaged runbook and preview workflow", () => {
  const { program } = setup({});
  const admin = program.commands.find((command) => command.name() === "admin");
  const crm = admin?.commands.find((command) => command.name() === "crm");
  assert.ok(crm);
  let help = "";
  crm.configureOutput({ writeOut: (text) => (help += text) });
  crm.outputHelp();
  assert.match(help, /docs show admin\/crm --include-admin/);
  assert.match(help, /Mutations preview by default/);
  for (const family of [
    "organizations",
    "domains",
    "people",
    "opportunities",
    "tasks",
    "activities",
    "links",
    "order",
    "support-context",
    "backfill",
    "digest",
    "diagnostics",
    "export",
  ]) {
    assert.ok(crm.commands.some((command) => command.name() === family));
  }
});

test("organization create previews with a stable idempotency key", async () => {
  let captured: any;
  const response = {
    preview: true,
    expected_version: 0,
    idempotency_key: "server-key",
  };
  const { program, output } = setup({
    createOrganization: async (opts: any) => {
      captured = opts;
      return response;
    },
  });
  await program.parseAsync([
    "node",
    "test",
    "admin",
    "crm",
    "organizations",
    "create",
    "--name",
    "Example University",
    "--type",
    "university",
    "--owner",
    "owner@example.edu",
    "--reason",
    "reviewed institutional inquiry",
  ]);
  assert.equal(captured.commit, false);
  assert.equal(captured.organization_type, "university");
  assert.equal(
    captured.relationship_owner_account_id,
    "22222222-2222-4222-8222-222222222222",
  );
  assert.match(captured.idempotency_key, /^cli:organization\.create:/);
  assert.deepEqual(output(), {
    schema_version: 1,
    provenance: {
      authority: "seed",
      service: "adminCrm",
      source: "cli",
    },
    redaction: {
      profile: "bounded_admin",
      unrestricted_provider_payloads: false,
      payment_credentials: false,
    },
    data: response,
  });
});

test("committed CRM mutations require the reviewed expected version", async () => {
  const { program } = setup({ archiveOrganization: async () => ({}) });
  await assert.rejects(
    program.parseAsync([
      "node",
      "test",
      "admin",
      "crm",
      "organizations",
      "archive",
      "CRM-2026-000001",
      "--reason",
      "customer relationship ended",
      "--commit",
    ]),
    /--expected-version is required/,
  );
});

test("CRM search forwards external identifiers and bounded pagination", async () => {
  let captured: any;
  const { program } = setup({
    searchOrganizations: async (opts: any) => {
      captured = opts;
      return { organizations: [], truncated: false, result_bytes: 2 };
    },
  });
  await program.parseAsync([
    "node",
    "test",
    "admin",
    "crm",
    "organizations",
    "search",
    "--domain",
    "example.edu",
    "--zendesk-ticket",
    "20599",
    "--limit",
    "25",
  ]);
  assert.equal(captured.domain, "example.edu");
  assert.equal(captured.zendesk_ticket_id, 20599);
  assert.equal(captured.limit, 25);
  assert.equal(captured.reason, "Search CRM customers");
});

test("customer metrics can be refreshed through the CLI", async () => {
  let captured: any;
  const { program } = setup({
    getCustomerMetrics: async (opts: any) => {
      captured = opts;
      return { organization_id: opts.organization, generated_at: "now" };
    },
  });
  await program.parseAsync([
    "node",
    "test",
    "admin",
    "crm",
    "organizations",
    "metrics",
    "CRM-2026-000001",
    "--refresh",
  ]);
  assert.deepEqual(captured, {
    organization: "CRM-2026-000001",
    refresh: true,
    reason: "Refresh CRM customer metrics",
  });
});

test("support context resolves requester identity for agents", async () => {
  let captured: any;
  const { program } = setup({
    getSupportContext: async (opts: any) => {
      captured = opts;
      return { candidates: [] };
    },
  });
  await program.parseAsync([
    "node",
    "test",
    "admin",
    "crm",
    "support-context",
    "--ticket",
    "20529",
    "--email",
    "owner@example.edu",
    "--account",
    "owner@example.edu",
  ]);
  assert.deepEqual(captured, {
    ticket_id: 20529,
    requester_email: "owner@example.edu",
    requester_account_id: "22222222-2222-4222-8222-222222222222",
    reason: "Review CRM support context",
  });
});

test("people link manages reviewed email relationships without raw SQL", async () => {
  let captured: any;
  const { program } = setup({
    mutatePersonEmail: async (opts: any) => {
      captured = opts;
      return { preview: true, expected_version: 0 };
    },
  });
  await program.parseAsync([
    "node",
    "test",
    "admin",
    "crm",
    "people",
    "link",
    "ada@example.edu",
    "--email",
    "ada@billing.example.edu",
    "--email-kind",
    "billing",
    "--primary",
    "--verify",
    "--reason",
    "customer verified the billing contact",
  ]);
  assert.equal(captured.person, "ada@example.edu");
  assert.equal(captured.email, "ada@billing.example.edu");
  assert.equal(captured.action, "add");
  assert.equal(captured.kind, "billing");
  assert.equal(captured.is_primary, true);
  assert.equal(captured.verified, true);
  assert.equal(captured.commit, false);
});

test("order handoff preserves canonical receivables actions", async () => {
  let captured: any;
  const { program } = setup({
    createCommercialOrderFromOpportunity: async (opts: any) => {
      captured = opts;
      return { preview: true, expected_version: 5 };
    },
  });
  await program.parseAsync([
    "node",
    "test",
    "admin",
    "crm",
    "order",
    "create",
    "opportunity-id",
    "--next-action",
    "create-invoice",
    "--collection-mode",
    "stripe-invoice",
    "--payment-terms-days",
    "0",
    "--reason",
    "review accepted opportunity handoff",
  ]);
  assert.equal(captured.next_action, "Create invoice");
  assert.equal(captured.collection_mode, "stripe_invoice");
  assert.equal(captured.payment_terms_days, 0);
});

test("daily digest resolves assignees and forwards deterministic windows", async () => {
  let captured: any;
  const { program } = setup({
    getDailyDigest: async (opts: any) => {
      captured = opts;
      return { counts: {}, truncated: false };
    },
  });
  await program.parseAsync([
    "node",
    "test",
    "admin",
    "crm",
    "digest",
    "--as-of",
    "2026-08-24T12:00:00Z",
    "--due-within-days",
    "2",
    "--renewal-within-days",
    "120",
    "--assignee",
    "owner@example.edu",
    "--limit",
    "25",
  ]);
  assert.deepEqual(captured, {
    as_of: "2026-08-24T12:00:00Z",
    due_within_days: 2,
    renewal_within_days: 120,
    assignee_account_id: "22222222-2222-4222-8222-222222222222",
    limit: 25,
    reason: "Review daily CRM work digest",
  });
});

test("CRM export writes sensitive data to the requested private file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cocalc-crm-export-"));
  const outputFile = join(directory, "customer.json");
  const exported = {
    schema_version: 1,
    sensitive: true,
    organizations: [{ organization: { customer_number: "CRM-2026-000001" } }],
  };
  const { program, output } = setup({
    exportData: async () => exported,
  });
  await program.parseAsync([
    "node",
    "test",
    "admin",
    "crm",
    "export",
    "--organization",
    "CRM-2026-000001",
    "--output-file",
    outputFile,
    "--reason",
    "review customer export",
  ]);
  assert.deepEqual(JSON.parse(await readFile(outputFile, "utf8")), exported);
  assert.equal((await stat(outputFile)).mode & 0o777, 0o600);
  assert.deepEqual((output() as any).data, {
    ...exported,
    organizations: undefined,
    output: outputFile,
  });
});

test("outreach show includes durable provider and engagement evidence", async () => {
  const calls: string[] = [];
  const delivery = {
    id: "33333333-3333-4333-8333-333333333333",
    zendesk_ticket_id: 999999,
  };
  const { program, output } = setup({
    getOutreachDelivery: async () => {
      calls.push("delivery");
      return delivery;
    },
    listOutreachProviderOperations: async () => {
      calls.push("operations");
      return { operations: [{ id: "operation-1" }], truncated: false };
    },
    listOutreachEngagementEvents: async () => {
      calls.push("engagement");
      return { events: [{ id: "view-1" }], truncated: false };
    },
  });

  await program.parseAsync([
    "node",
    "test",
    "admin",
    "crm",
    "outreach",
    "show",
    delivery.id,
    "--reason",
    "review outreach provider recovery evidence",
  ]);

  assert.deepEqual(calls.sort(), ["delivery", "engagement", "operations"]);
  assert.deepEqual((output() as any).data, {
    delivery,
    provider_operations: {
      operations: [{ id: "operation-1" }],
      truncated: false,
    },
    engagement: { events: [{ id: "view-1" }], truncated: false },
    support_show_command: "cocalc admin support show 999999",
  });
});

test("outreach help exposes the shared runbook and operations families", () => {
  const { program } = setup({});
  const admin = program.commands.find((command) => command.name() === "admin");
  const crm = admin?.commands.find((command) => command.name() === "crm");
  const outreach = crm?.commands.find(
    (command) => command.name() === "outreach",
  );
  assert.ok(outreach);
  let help = "";
  outreach.configureOutput({ writeOut: (text) => (help += text) });
  outreach.outputHelp();
  assert.match(help, /docs show admin\/crm-outreach --include-admin/);
  for (const family of [
    "batch",
    "templates",
    "suppressions",
    "followups",
    "engagement",
    "diagnostics",
  ]) {
    assert.ok(outreach.commands.some((command) => command.name() === family));
  }
});
