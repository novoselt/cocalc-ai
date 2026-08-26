/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { Command } from "commander";

import { COMMERCIAL_NEXT_ACTIONS } from "@cocalc/util/commercial-orders";
import {
  CRM_DOMAIN_KINDS,
  CRM_LIFECYCLE_STAGES,
  CRM_OPPORTUNITY_KINDS,
  CRM_OPPORTUNITY_STAGES,
  CRM_ORGANIZATION_TYPES,
  CRM_PERSON_ROLES,
  CRM_TASK_PRIORITIES,
  CRM_TASK_TYPES,
} from "@cocalc/util/crm";
import {
  CRM_OUTREACH_FOLLOW_UP_POLICIES,
  CRM_OUTREACH_KINDS,
  CRM_OUTREACH_SUPPRESSION_REASONS,
  CRM_OUTREACH_SUPPRESSION_SCOPES,
} from "@cocalc/util/crm-outreach";

export type CrmCommandDeps = {
  withContext: any;
  resolveAccountByIdentifier: any;
  isValidUUID: any;
};

type Json = Record<string, unknown>;
type MutationOptions = {
  commit?: boolean;
  reason?: string;
  expectedVersion?: string;
  idempotencyKey?: string;
};

function crmCliEnvelope(data: unknown): Json {
  return {
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
    data,
  };
}

function normalizeState(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, "_");
}

function requireReason(value: unknown): string {
  const reason = `${value ?? ""}`.trim();
  if (reason.length < 4)
    throw Error("--reason must contain at least 4 characters");
  if (reason.length > 2_000)
    throw Error("--reason must contain at most 2000 characters");
  return reason;
}

function readReason(value: unknown, fallback: string): string {
  const reason = `${value ?? ""}`.trim();
  return reason ? requireReason(reason) : fallback;
}

function positiveInteger(
  value: unknown,
  name: string,
  max?: number,
): number | undefined {
  if (value == null || `${value}`.trim() === "") return;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw Error(`${name} must be a positive integer`);
  if (max != null && parsed > max)
    throw Error(`${name} must be at most ${max}`);
  return parsed;
}

function nonnegativeInteger(value: unknown, name: string): number | undefined {
  if (value == null || `${value}`.trim() === "") return;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw Error(`${name} must be a nonnegative integer`);
  return parsed;
}

function csv(value: unknown): string[] | undefined {
  const values = `${value ?? ""}`
    .split(",")
    .map((x) => normalizeState(x))
    .filter(Boolean);
  return values.length ? [...new Set(values)] : undefined;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): T {
  const normalized = normalizeState(`${value ?? ""}`);
  if (!(allowed as readonly string[]).includes(normalized)) {
    throw Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return normalized as T;
}

function commercialNextAction(value: unknown): string {
  const normalized = `${value ?? ""}`
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "_");
  const action = COMMERCIAL_NEXT_ACTIONS.find(
    (candidate) =>
      candidate
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "_") === normalized,
  );
  if (!action) {
    throw Error(
      `--next-action must be one of: ${COMMERCIAL_NEXT_ACTIONS.join(", ")}`,
    );
  }
  return action;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Json)
        .filter(
          ([key]) =>
            !["commit", "expected_version", "idempotency_key"].includes(key),
        )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stable(child)]),
    );
  }
  return value;
}

function mutationKey(action: string, payload: Json, supplied?: string): string {
  const explicit = `${supplied ?? ""}`.trim();
  if (explicit) return explicit;
  return `cli:${action}:${createHash("sha256")
    .update(JSON.stringify(stable(payload)))
    .digest("hex")
    .slice(0, 32)}`;
}

function mutationRequest(
  action: string,
  opts: MutationOptions,
  payload: Json,
): Json {
  const reason = requireReason(opts.reason);
  const expectedVersion = opts.commit
    ? nonnegativeInteger(opts.expectedVersion, "--expected-version")
    : nonnegativeInteger(opts.expectedVersion, "--expected-version");
  if (opts.commit && expectedVersion == null) {
    throw Error(
      "--expected-version is required with --commit; use the value returned by the preview",
    );
  }
  const base = { ...payload, reason, source: "cli" as const };
  return {
    ...base,
    commit: opts.commit === true,
    expected_version: expectedVersion,
    idempotency_key: mutationKey(action, base, opts.idempotencyKey),
  };
}

function addMutationOptions(command: Command): Command {
  return command
    .option("--reason <text>", "human-readable immutable audit reason")
    .option("--expected-version <n>", "optimistic version returned by preview")
    .option("--idempotency-key <key>", "stable logical mutation key")
    .option("--commit", "apply the reviewed preview", false);
}

function addPageOptions(command: Command): Command {
  return command
    .option("--cursor <cursor>", "pagination cursor")
    .option("--limit <n>", "maximum rows (1-500)", "100")
    .option("--max-bytes <n>", "maximum response bytes")
    .option("--reason <text>", "audit reason for this admin read");
}

function page(opts: any): Json {
  return {
    cursor: `${opts.cursor ?? ""}`.trim() || undefined,
    limit: positiveInteger(opts.limit, "--limit", 500),
    max_bytes: positiveInteger(opts.maxBytes, "--max-bytes", 5_000_000),
  };
}

async function readJson(path: string): Promise<Json> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    throw Error(`failed to parse JSON from ${path}: ${err}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Error(`${path} must contain a JSON object`);
  }
  return value as Json;
}

async function resolveAccount(
  ctx: any,
  value: string,
  deps: CrmCommandDeps,
): Promise<string> {
  const identifier = `${value ?? ""}`.trim();
  if (!identifier) throw Error("account identifier is required");
  if (identifier === "me") return ctx.accountId;
  if (deps.isValidUUID(identifier)) return identifier;
  const result = await deps.resolveAccountByIdentifier(ctx, identifier);
  const accountId = `${result?.account_id ?? ""}`.trim();
  if (!accountId) throw Error(`unable to resolve account '${identifier}'`);
  return accountId;
}

function registerOrganizations(crm: Command, deps: CrmCommandDeps): void {
  const command = crm
    .command("organizations")
    .description("canonical customer organizations");
  addPageOptions(
    command
      .command("list")
      .description("list the customer queue")
      .option("--search <text>", "name, alias, or customer number")
      .option("--lifecycle <stages>", "comma-separated lifecycle stages")
      .option(
        "--status <states>",
        "comma-separated active, merged, or archived",
      )
      .option("--type <types>", "comma-separated organization types")
      .option(
        "--opportunity-kind <kinds>",
        "comma-separated active opportunity kinds",
      )
      .option("--owner <account>", "relationship owner, me, or unassigned")
      .option("--overdue", "only customers with overdue tasks")
      .option("--unassigned", "only unassigned customers"),
  ).action(async (opts: any, cmd: Command) =>
    deps.withContext(cmd, "admin crm organizations list", async (ctx) => {
      let owner: string | null | undefined;
      if (opts.owner)
        owner = ["unassigned", "none"].includes(normalizeState(opts.owner))
          ? null
          : await resolveAccount(ctx, opts.owner, deps);
      return await ctx.hub.adminCrm.listOrganizations({
        ...page(opts),
        reason: readReason(opts.reason, "Review CRM customer queue"),
        search: opts.search,
        lifecycle_stages: csv(opts.lifecycle),
        statuses: csv(opts.status),
        organization_types: csv(opts.type),
        opportunity_kinds: csv(opts.opportunityKind),
        owner_account_id: owner,
        has_overdue_tasks: opts.overdue || undefined,
        unassigned: opts.unassigned || undefined,
      });
    }),
  );
  addPageOptions(
    command
      .command("search")
      .description("search customers by human or external identifiers")
      .option(
        "--query <text>",
        "name, alias, domain, contact, or customer number",
      )
      .option("--domain <domain>", "institutional domain")
      .option("--email <email>", "contact email")
      .option("--account <account>", "CoCalc account or email")
      .option("--zendesk-ticket <id>", "Zendesk ticket id")
      .option("--commercial-order <id>", "order number or UUID")
      .option("--site-license <id>", "site license UUID"),
  ).action(async (opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm organizations search",
      async (ctx) =>
        await ctx.hub.adminCrm.searchOrganizations({
          ...page(opts),
          reason: readReason(opts.reason, "Search CRM customers"),
          query: opts.query,
          domain: opts.domain,
          email: opts.email,
          account_id: opts.account
            ? await resolveAccount(ctx, opts.account, deps)
            : undefined,
          zendesk_ticket_id: positiveInteger(
            opts.zendeskTicket,
            "--zendesk-ticket",
          ),
          commercial_order: opts.commercialOrder,
          site_license_id: opts.siteLicense,
        }),
    ),
  );
  command
    .command("show <organization>")
    .description("show Customer 360")
    .option("--activity-limit <n>", "maximum recent activities", "100")
    .option("--reason <text>", "audit reason for this admin read")
    .action(async (organization: string, opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        "admin crm organizations show",
        async (ctx) =>
          await ctx.hub.adminCrm.getOrganization({
            organization,
            activity_limit: positiveInteger(
              opts.activityLimit,
              "--activity-limit",
              500,
            ),
            reason: readReason(opts.reason, "Review CRM Customer 360"),
          }),
      ),
    );
  command
    .command("metrics <organization>")
    .description("show or refresh bounded customer metrics")
    .option("--refresh", "recompute and persist a current metric snapshot")
    .option("--reason <text>", "audit reason for this admin read")
    .action(async (organization: string, opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        "admin crm organizations metrics",
        async (ctx) =>
          await ctx.hub.adminCrm.getCustomerMetrics({
            organization,
            refresh: opts.refresh || undefined,
            reason: readReason(
              opts.reason,
              opts.refresh
                ? "Refresh CRM customer metrics"
                : "Review CRM customer metrics",
            ),
          }),
      ),
    );
  addMutationOptions(
    command
      .command("create")
      .description("preview or create a customer")
      .requiredOption("--name <name>", "display name")
      .requiredOption(
        "--type <type>",
        `organization type: ${CRM_ORGANIZATION_TYPES.join(", ")}`,
      )
      .option("--legal-name <name>", "legal name")
      .option("--aliases <names>", "comma-separated reviewed aliases")
      .option("--website <url>", "organization website")
      .option("--timezone <zone>", "IANA timezone")
      .option("--lifecycle <stage>", "initial lifecycle stage", "prospect")
      .option("--owner <account>", "relationship owner")
      .option("--parent <organization>", "parent organization"),
  ).action(async (opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm organizations create",
      async (ctx) =>
        await ctx.hub.adminCrm.createOrganization(
          mutationRequest("organization.create", opts, {
            display_name: opts.name,
            legal_name: opts.legalName,
            aliases: `${opts.aliases ?? ""}`
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
            website: opts.website,
            timezone: opts.timezone,
            organization_type: enumValue(
              opts.type,
              CRM_ORGANIZATION_TYPES,
              "--type",
            ),
            lifecycle_stage: enumValue(
              opts.lifecycle,
              CRM_LIFECYCLE_STAGES,
              "--lifecycle",
            ),
            relationship_owner_account_id: opts.owner
              ? await resolveAccount(ctx, opts.owner, deps)
              : undefined,
            parent_organization: opts.parent,
          }),
        ),
    ),
  );
  addMutationOptions(
    command
      .command("update <organization>")
      .description("preview or update customer fields from a JSON file")
      .requiredOption(
        "--file <path>",
        "JSON object containing reviewed changes",
      ),
  ).action(async (organization: string, opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm organizations update",
      async (ctx) =>
        await ctx.hub.adminCrm.updateOrganization(
          mutationRequest("organization.update", opts, {
            organization,
            changes: await readJson(opts.file),
          }),
        ),
    ),
  );
  addMutationOptions(
    command
      .command("archive <organization>")
      .description("preview or archive a customer"),
  ).action(async (organization: string, opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm organizations archive",
      async (ctx) =>
        await ctx.hub.adminCrm.archiveOrganization(
          mutationRequest("organization.archive", opts, { organization }),
        ),
    ),
  );
  addMutationOptions(
    command
      .command("merge <source> <destination>")
      .description(
        "preview or merge a duplicate customer into its canonical record",
      ),
  ).action(
    async (source: string, destination: string, opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        "admin crm organizations merge",
        async (ctx) =>
          await ctx.hub.adminCrm.mergeOrganizations(
            mutationRequest("organization.merge", opts, {
              source_organization: source,
              destination_organization: destination,
            }),
          ),
      ),
  );
}

function registerDomains(crm: Command, deps: CrmCommandDeps): void {
  const domains = crm
    .command("domains")
    .description("reviewed organization domains");
  for (const action of ["add", "verify", "reject", "retire"] as const) {
    const command = addMutationOptions(
      domains
        .command(`${action} <organization> <domain>`)
        .description(`preview or ${action} an organization domain`)
        .option(
          "--kind <kind>",
          `domain kind: ${CRM_DOMAIN_KINDS.join(", ")}`,
          "secondary",
        )
        .option("--verification-method <method>", "review method")
        .option("--evidence <reference>", "bounded evidence reference"),
    );
    command.action(
      async (organization: string, domain: string, opts: any, cmd: Command) =>
        deps.withContext(
          cmd,
          `admin crm domains ${action}`,
          async (ctx) =>
            await ctx.hub.adminCrm.mutateDomain(
              mutationRequest(`domain.${action}`, opts, {
                organization,
                domain,
                action,
                kind: enumValue(opts.kind, CRM_DOMAIN_KINDS, "--kind"),
                verification_method: opts.verificationMethod,
                evidence_reference: opts.evidence,
              }),
            ),
        ),
    );
  }
  addMutationOptions(
    domains
      .command("transfer <organization> <domain> <destination>")
      .description("preview or transfer a reviewed domain"),
  ).action(
    async (
      organization: string,
      domain: string,
      destination: string,
      opts: any,
      cmd: Command,
    ) =>
      deps.withContext(
        cmd,
        "admin crm domains transfer",
        async (ctx) =>
          await ctx.hub.adminCrm.mutateDomain(
            mutationRequest("domain.transfer", opts, {
              organization,
              domain,
              action: "transfer",
              destination_organization: destination,
            }),
          ),
      ),
  );
}

function registerPeople(crm: Command, deps: CrmCommandDeps): void {
  const people = crm
    .command("people")
    .description("customer contacts and reviewed identity links");
  for (const name of ["list", "search"] as const) {
    addPageOptions(
      people
        .command(name)
        .description(`${name} customer contacts`)
        .option("--organization <customer>", "customer selector")
        .option("--search <text>", "name or email")
        .option("--status <state>", "active, merged, or archived"),
    ).action(async (opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        `admin crm people ${name}`,
        async (ctx) =>
          await ctx.hub.adminCrm[
            name === "list" ? "listPeople" : "searchPeople"
          ]({
            ...page(opts),
            organization: opts.organization,
            search: opts.search,
            status: opts.status ? normalizeState(opts.status) : undefined,
            reason: readReason(
              opts.reason,
              `${name === "list" ? "Review" : "Search"} CRM contacts`,
            ),
          }),
      ),
    );
  }
  people
    .command("show <person>")
    .description("show one contact")
    .option("--reason <text>", "audit reason")
    .action(async (person: string, opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        "admin crm people show",
        async (ctx) =>
          await ctx.hub.adminCrm.getPerson({
            person,
            reason: readReason(opts.reason, "Review CRM contact"),
          }),
      ),
    );
  addMutationOptions(
    people
      .command("create")
      .description("preview or create a customer contact")
      .requiredOption("--name <name>", "display name")
      .option("--organization <customer>", "customer relationship")
      .option(
        "--roles <roles>",
        `comma-separated roles: ${CRM_PERSON_ROLES.join(", ")}`,
      )
      .option("--title <title>", "job title")
      .option("--department <department>", "department")
      .option("--email <email>", "email address")
      .option("--account <account>", "CoCalc account or email")
      .option("--timezone <zone>", "IANA timezone"),
  ).action(async (opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm people create",
      async (ctx) =>
        await ctx.hub.adminCrm.createPerson(
          mutationRequest("person.create", opts, {
            display_name: opts.name,
            organization: opts.organization,
            roles: csv(opts.roles),
            title: opts.title,
            department: opts.department,
            email: opts.email,
            cocalc_account_id: opts.account
              ? await resolveAccount(ctx, opts.account, deps)
              : undefined,
            timezone: opts.timezone,
          }),
        ),
    ),
  );
  addMutationOptions(
    people
      .command("update <person>")
      .description("preview or update a contact from a JSON file")
      .requiredOption("--file <path>", "JSON object containing changes"),
  ).action(async (person: string, opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm people update",
      async (ctx) =>
        await ctx.hub.adminCrm.updatePerson(
          mutationRequest("person.update", opts, {
            person,
            changes: await readJson(opts.file),
          }),
        ),
    ),
  );
  for (const action of ["link", "unlink"] as const) {
    addMutationOptions(
      people
        .command(`${action} <person>`)
        .description(`${action} a contact to a customer, account, or email`)
        .option("--organization <customer>", "customer selector")
        .option("--account <account>", "CoCalc account or email")
        .option("--email <email>", "contact email address")
        .option(
          "--email-kind <kind>",
          "work, billing, personal, or other",
          "work",
        )
        .option("--primary", "make this the primary contact email")
        .option("--roles <roles>", "comma-separated customer roles")
        .option("--title <title>", "job title")
        .option("--department <department>", "department")
        .option("--verify", "mark an account or email link verified"),
    ).action(async (person: string, opts: any, cmd: Command) =>
      deps.withContext(cmd, `admin crm people ${action}`, async (ctx) => {
        const targets = [opts.organization, opts.account, opts.email].filter(
          Boolean,
        );
        if (targets.length !== 1)
          throw Error(
            "specify exactly one of --organization, --account, or --email",
          );
        if (opts.organization)
          return await ctx.hub.adminCrm.mutateOrganizationPerson(
            mutationRequest(`organization-person.${action}`, opts, {
              person,
              organization: opts.organization,
              action,
              roles: csv(opts.roles),
              title: opts.title,
              department: opts.department,
            }),
          );
        if (opts.email)
          return await ctx.hub.adminCrm.mutatePersonEmail(
            mutationRequest(`person-email.${action}`, opts, {
              person,
              email: opts.email,
              action: action === "unlink" ? "remove" : "add",
              kind: enumValue(
                opts.emailKind,
                ["work", "billing", "personal", "other"] as const,
                "--email-kind",
              ),
              is_primary: opts.primary || undefined,
              verified: opts.verify || undefined,
            }),
          );
        return await ctx.hub.adminCrm.mutatePersonAccount(
          mutationRequest(`person-account.${action}`, opts, {
            person,
            linked_account_id: await resolveAccount(ctx, opts.account, deps),
            action:
              action === "unlink" ? "unlink" : opts.verify ? "verify" : "link",
          }),
        );
      }),
    );
  }
}

function registerOpportunities(crm: Command, deps: CrmCommandDeps): void {
  const opportunities = crm
    .command("opportunities")
    .description("reviewed commercial pipeline");
  addPageOptions(
    opportunities
      .command("list")
      .description("list opportunities")
      .option("--organization <customer>", "customer selector")
      .option("--stage <stages>", "comma-separated stages")
      .option("--kind <kinds>", "comma-separated kinds")
      .option("--owner <account>", "owner account"),
  ).action(async (opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm opportunities list",
      async (ctx) =>
        await ctx.hub.adminCrm.listOpportunities({
          ...page(opts),
          reason: readReason(opts.reason, "Review CRM opportunities"),
          organization: opts.organization,
          stages: csv(opts.stage),
          kinds: csv(opts.kind),
          owner_account_id: opts.owner
            ? await resolveAccount(ctx, opts.owner, deps)
            : undefined,
        }),
    ),
  );
  opportunities
    .command("show <opportunity>")
    .description("show one opportunity")
    .option("--reason <text>", "audit reason")
    .action(async (opportunity: string, opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        "admin crm opportunities show",
        async (ctx) =>
          await ctx.hub.adminCrm.getOpportunity({
            opportunity,
            reason: readReason(opts.reason, "Review CRM opportunity"),
          }),
      ),
    );
  addMutationOptions(
    opportunities
      .command("create <organization>")
      .description("preview or create an opportunity")
      .requiredOption("--name <name>", "opportunity name")
      .requiredOption(
        "--kind <kind>",
        `kind: ${CRM_OPPORTUNITY_KINDS.join(", ")}`,
      )
      .requiredOption("--owner <account>", "owner account")
      .requiredOption("--value <amount>", "expected value")
      .requiredOption("--close-date <date>", "expected close date")
      .option("--currency <code>", "currency", "usd")
      .option("--service-start <iso>", "service start")
      .option("--service-end <iso>", "service end")
      .option("--zendesk-tickets <ids>", "comma-separated ticket ids")
      .option("--description <text>", "bounded description"),
  ).action(async (organization: string, opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm opportunities create",
      async (ctx) =>
        await ctx.hub.adminCrm.createOpportunity(
          mutationRequest("opportunity.create", opts, {
            organization,
            name: opts.name,
            kind: enumValue(opts.kind, CRM_OPPORTUNITY_KINDS, "--kind"),
            owner_account_id: await resolveAccount(ctx, opts.owner, deps),
            expected_value: opts.value,
            currency: opts.currency,
            expected_close_date: opts.closeDate,
            service_starts_at: opts.serviceStart,
            service_ends_at: opts.serviceEnd,
            source_zendesk_ticket_ids: csv(opts.zendeskTickets)?.map(Number),
            description: opts.description,
          }),
        ),
    ),
  );
  addMutationOptions(
    opportunities
      .command("update <opportunity>")
      .description("preview or update from JSON")
      .requiredOption("--file <path>", "JSON changes"),
  ).action(async (opportunity: string, opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm opportunities update",
      async (ctx) =>
        await ctx.hub.adminCrm.updateOpportunity(
          mutationRequest("opportunity.update", opts, {
            opportunity,
            changes: await readJson(opts.file),
          }),
        ),
    ),
  );
  addMutationOptions(
    opportunities
      .command("transition <opportunity> <stage>")
      .description("preview or transition a pipeline stage")
      .option("--loss-reason <text>", "required for lost"),
  ).action(
    async (opportunity: string, stage: string, opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        "admin crm opportunities transition",
        async (ctx) =>
          await ctx.hub.adminCrm.transitionOpportunity(
            mutationRequest("opportunity.transition", opts, {
              opportunity,
              stage: enumValue(stage, CRM_OPPORTUNITY_STAGES, "stage"),
              loss_reason: opts.lossReason,
            }),
          ),
      ),
  );
}

function registerTasks(crm: Command, deps: CrmCommandDeps): void {
  const tasks = crm
    .command("tasks")
    .description("constrained internal customer follow-up");
  addPageOptions(
    tasks
      .command("list")
      .description("list CRM tasks")
      .option("--organization <customer>", "customer selector")
      .option("--opportunity <opportunity>", "opportunity selector")
      .option("--assignee <account>", "assignee")
      .option("--state <states>", "comma-separated states")
      .option("--type <types>", "comma-separated types")
      .option("--due-before <iso>", "due before timestamp")
      .option("--overdue", "only overdue open tasks"),
  ).action(async (opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm tasks list",
      async (ctx) =>
        await ctx.hub.adminCrm.listTasks({
          ...page(opts),
          reason: readReason(opts.reason, "Review CRM task queue"),
          organization: opts.organization,
          opportunity: opts.opportunity,
          assignee_account_id: opts.assignee
            ? await resolveAccount(ctx, opts.assignee, deps)
            : undefined,
          states: csv(opts.state),
          types: csv(opts.type),
          due_before: opts.dueBefore,
          overdue: opts.overdue || undefined,
        }),
    ),
  );
  tasks
    .command("show <task>")
    .description("show one task")
    .option("--reason <text>", "audit reason")
    .action(async (task: string, opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        "admin crm tasks show",
        async (ctx) =>
          await ctx.hub.adminCrm.getTask({
            task,
            reason: readReason(opts.reason, "Review CRM task"),
          }),
      ),
    );
  addMutationOptions(
    tasks
      .command("create <organization>")
      .description("preview or create a task")
      .requiredOption("--type <type>", `type: ${CRM_TASK_TYPES.join(", ")}`)
      .requiredOption("--assignee <account>", "assignee")
      .requiredOption("--due <iso>", "due timestamp")
      .requiredOption("--subject <text>", "short subject")
      .option(
        "--priority <priority>",
        `priority: ${CRM_TASK_PRIORITIES.join(", ")}`,
        "normal",
      )
      .option("--details <text>", "bounded details")
      .option("--person <person>", "contact selector")
      .option("--opportunity <opportunity>", "opportunity selector")
      .option("--commercial-order <uuid>", "commercial order UUID")
      .option("--zendesk-ticket <id>", "Zendesk ticket id"),
  ).action(async (organization: string, opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm tasks create",
      async (ctx) =>
        await ctx.hub.adminCrm.createTask(
          mutationRequest("task.create", opts, {
            organization,
            type: enumValue(opts.type, CRM_TASK_TYPES, "--type"),
            assignee_account_id: await resolveAccount(ctx, opts.assignee, deps),
            due_at: opts.due,
            priority: enumValue(
              opts.priority,
              CRM_TASK_PRIORITIES,
              "--priority",
            ),
            subject: opts.subject,
            details: opts.details,
            person: opts.person,
            opportunity: opts.opportunity,
            commercial_order_id: opts.commercialOrder,
            zendesk_ticket_id: positiveInteger(
              opts.zendeskTicket,
              "--zendesk-ticket",
            ),
          }),
        ),
    ),
  );
  for (const action of [
    "assign",
    "reschedule",
    "complete",
    "cancel",
  ] as const) {
    addMutationOptions(
      tasks
        .command(`${action} <task>`)
        .description(`preview or ${action} a task`)
        .option(
          "--assignee <account>",
          action === "assign" ? "new assignee (required)" : "optional assignee",
        )
        .option("--due <iso>", "new due timestamp (required for reschedule)"),
    ).action(async (task: string, opts: any, cmd: Command) =>
      deps.withContext(cmd, `admin crm tasks ${action}`, async (ctx) => {
        if (action === "assign" && !opts.assignee)
          throw Error("--assignee is required");
        if (action === "reschedule" && !opts.due)
          throw Error("--due is required");
        return await ctx.hub.adminCrm.transitionTask(
          mutationRequest(`task.${action}`, opts, {
            task,
            action,
            assignee_account_id: opts.assignee
              ? await resolveAccount(ctx, opts.assignee, deps)
              : undefined,
            due_at: opts.due,
          }),
        );
      }),
    );
  }
}

function registerActivities(crm: Command, deps: CrmCommandDeps): void {
  const activities = crm
    .command("activities")
    .description("append-only customer timeline");
  addPageOptions(
    activities
      .command("list <organization>")
      .description("list customer activity")
      .option("--kind <kinds>", "comma-separated activity kinds"),
  ).action(async (organization: string, opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm activities list",
      async (ctx) =>
        await ctx.hub.adminCrm.getCustomerTimeline({
          ...page(opts),
          organization,
          kinds: csv(opts.kind),
          reason: readReason(opts.reason, "Review CRM customer timeline"),
        }),
    ),
  );
  for (const kind of ["note", "call", "meeting"] as const) {
    addMutationOptions(
      activities
        .command(`${kind} <organization>`)
        .description(`preview or append a ${kind}`)
        .requiredOption("--summary <text>", "short summary")
        .option("--details <text>", "bounded details")
        .option("--person <person>", "contact selector")
        .option("--opportunity <opportunity>", "opportunity selector")
        .option("--task <task>", "task selector")
        .option("--occurred-at <iso>", "event timestamp"),
    ).action(async (organization: string, opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        `admin crm activities ${kind}`,
        async (ctx) =>
          await ctx.hub.adminCrm.addActivity(
            mutationRequest(`activity.${kind}`, opts, {
              organization,
              kind,
              summary: opts.summary,
              details: opts.details,
              person: opts.person,
              opportunity: opts.opportunity,
              task: opts.task,
              occurred_at: opts.occurredAt,
            }),
          ),
      ),
    );
  }
}

function registerLinks(crm: Command, deps: CrmCommandDeps): void {
  const links = crm
    .command("links")
    .description("reviewed external-system references");
  for (const commandName of ["add", "remove"] as const) {
    addMutationOptions(
      links
        .command(`${commandName} <organization>`)
        .description(`preview or ${commandName} an external reference`)
        .requiredOption("--provider <provider>", "zendesk, stripe, or cocalc")
        .requiredOption(
          "--kind <kind>",
          "ticket, customer, account, commercial-order, site-license, or project",
        )
        .requiredOption("--external-id <id>", "stable external identifier")
        .option("--person <person>", "contact selector")
        .option("--opportunity <opportunity>", "opportunity selector")
        .option("--label <text>", "redacted display label")
        .option("--metadata-file <path>", "bounded JSON metadata")
        .option("--verify", "mark the link reviewed and verified"),
    ).action(async (organization: string, opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        `admin crm links ${commandName}`,
        async (ctx) =>
          await ctx.hub.adminCrm.mutateExternalReference(
            mutationRequest(`external-reference.${commandName}`, opts, {
              organization,
              action:
                commandName === "remove"
                  ? "remove"
                  : opts.verify
                    ? "verify"
                    : "add",
              provider: normalizeState(opts.provider),
              object_kind: normalizeState(opts.kind),
              external_id: opts.externalId,
              person: opts.person,
              opportunity: opts.opportunity,
              label: opts.label,
              metadata: opts.metadataFile
                ? await readJson(opts.metadataFile)
                : undefined,
            }),
          ),
      ),
    );
  }
}

function registerOrder(crm: Command, deps: CrmCommandDeps): void {
  const order = crm
    .command("order")
    .description("opportunity-to-receivables handoff");
  addMutationOptions(
    order
      .command("create <opportunity>")
      .description("preview or create a commercial order from an opportunity")
      .requiredOption(
        "--next-action <action>",
        "constrained receivables next action",
      )
      .option("--next-action-due <iso>", "next-action due timestamp")
      .option(
        "--collection-mode <mode>",
        "stripe-invoice or manual-invoice",
        "stripe-invoice",
      )
      .option("--payment-terms-days <days>", "invoice payment terms", "21")
      .option("--billing-contact <person>", "billing contact selector"),
  ).action(async (opportunity: string, opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm order create",
      async (ctx) =>
        await ctx.hub.adminCrm.createCommercialOrderFromOpportunity(
          mutationRequest("opportunity.create-order", opts, {
            opportunity,
            next_action: commercialNextAction(opts.nextAction),
            next_action_due_at: opts.nextActionDue,
            collection_mode: normalizeState(opts.collectionMode),
            payment_terms_days: nonnegativeInteger(
              opts.paymentTermsDays,
              "--payment-terms-days",
            ),
            billing_contact_person: opts.billingContact,
          }),
        ),
    ),
  );
}

function registerTopLevel(crm: Command, deps: CrmCommandDeps): void {
  crm
    .command("support-context")
    .description("show deterministic CRM evidence for a support requester")
    .requiredOption("--ticket <id>", "Zendesk ticket id")
    .option("--email <email>", "requester email")
    .option("--account <account>", "requester CoCalc account or email")
    .option("--reason <text>", "audit reason for this admin read")
    .action(async (opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        "admin crm support-context",
        async (ctx) =>
          await ctx.hub.adminCrm.getSupportContext({
            ticket_id: positiveInteger(opts.ticket, "--ticket")!,
            requester_email: opts.email,
            requester_account_id: opts.account
              ? await resolveAccount(ctx, opts.account, deps)
              : undefined,
            reason: readReason(opts.reason, "Review CRM support context"),
          }),
      ),
    );
  addMutationOptions(
    crm
      .command("backfill")
      .description("preview or apply reviewed customer discovery candidates")
      .option(
        "--candidate <key>",
        "candidate key to apply (repeatable)",
        (value, previous: string[] = []) => [...previous, value],
        [],
      )
      .option("--limit <n>", "maximum candidates", "100"),
  ).action(async (opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm backfill",
      async (ctx) =>
        await ctx.hub.adminCrm.backfill(
          mutationRequest("backfill", opts, {
            candidate_keys: opts.candidate,
            limit: positiveInteger(opts.limit, "--limit", 500),
          }),
        ),
    ),
  );
  crm
    .command("digest")
    .description("show the deterministic daily customer work digest")
    .option("--as-of <iso>", "evaluate queues at this ISO timestamp")
    .option("--due-within-days <n>", "near-term follow-up window", "1")
    .option("--renewal-within-days <n>", "renewal look-ahead window", "90")
    .option("--assignee <account>", "limit work to an admin account")
    .option("--limit <n>", "maximum rows per section", "100")
    .option("--reason <text>", "audit reason")
    .action(async (opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        "admin crm digest",
        async (ctx) =>
          await ctx.hub.adminCrm.getDailyDigest({
            as_of: opts.asOf,
            due_within_days: nonnegativeInteger(
              opts.dueWithinDays,
              "--due-within-days",
            ),
            renewal_within_days: nonnegativeInteger(
              opts.renewalWithinDays,
              "--renewal-within-days",
            ),
            assignee_account_id: opts.assignee
              ? await resolveAccount(ctx, opts.assignee, deps)
              : undefined,
            limit: positiveInteger(opts.limit, "--limit", 500),
            reason: readReason(opts.reason, "Review daily CRM work digest"),
          }),
      ),
    );
  crm
    .command("diagnostics")
    .description("run bounded CRM consistency diagnostics")
    .option("--limit <n>", "maximum rows per review queue", "100")
    .option("--reason <text>", "audit reason")
    .action(async (opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        "admin crm diagnostics",
        async (ctx) =>
          await ctx.hub.adminCrm.getDiagnostics({
            limit: positiveInteger(opts.limit, "--limit", 500),
            reason: readReason(opts.reason, "Review CRM diagnostics"),
          }),
      ),
    );
  crm
    .command("export")
    .description("export a bounded sensitive CRM data set")
    .option("--organization <customer>", "one customer selector")
    .option("--include-people", "include contact PII", false)
    .option("--include-activities", "include customer timeline", false)
    .option("--limit <n>", "maximum customers", "100")
    .option("--max-bytes <n>", "maximum bytes", "5000000")
    .option(
      "--output-file <path>",
      "write sensitive JSON to a mode-0600 file instead of stdout",
    )
    .requiredOption("--reason <text>", "human-readable export reason")
    .action(async (opts: any, cmd: Command) =>
      deps.withContext(cmd, "admin crm export", async (ctx) => {
        const result = await ctx.hub.adminCrm.exportData({
          organization: opts.organization,
          include_people: opts.includePeople,
          include_activities: opts.includeActivities,
          limit: positiveInteger(opts.limit, "--limit", 500),
          max_bytes: positiveInteger(opts.maxBytes, "--max-bytes", 5_000_000),
          reason: requireReason(opts.reason),
        });
        if (opts.outputFile) {
          await writeFile(
            opts.outputFile,
            `${JSON.stringify(result, null, 2)}\n`,
            {
              mode: 0o600,
            },
          );
          return {
            ...result,
            organizations: undefined,
            output: opts.outputFile,
          };
        }
        return result;
      }),
    );
}

function registerOutreach(crm: Command, deps: CrmCommandDeps): void {
  const outreach = crm
    .command("outreach")
    .description("reviewed proactive Zendesk conversations")
    .addHelpText(
      "after",
      `\nOutreach runbook:\n  cocalc docs show admin/crm-outreach --include-admin\n  cocalc docs search "CRM outreach adoption pilot" --include-admin\n  cocalc docs skill-context --query "send reviewed prospect outreach" --include-admin\n\nQueue commits only create durable work. The seed worker performs rate-limited Zendesk calls. Full conversations remain in Zendesk; use 'cocalc admin support show|reply'.\n`,
    );

  addPageOptions(
    outreach
      .command("list")
      .description("list outreach deliveries")
      .option("--batch <batch>", "batch number or UUID")
      .option("--organization <customer>", "CRM customer")
      .option("--person <person>", "CRM contact or email")
      .option("--opportunity <opportunity>", "CRM opportunity")
      .option("--state <states>", "comma-separated delivery states")
      .option("--ticket <id>", "Zendesk ticket ID")
      .option(
        "--engagement <filter>",
        "viewed, unviewed, replied, or unreplied",
      )
      .option("--suggested-action <action>", "follow-up suggested action"),
  ).action(async (opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm outreach list",
      async (ctx) =>
        await ctx.hub.adminCrm.listOutreachDeliveries({
          ...page(opts),
          batch: opts.batch,
          organization: opts.organization,
          person: opts.person,
          opportunity: opts.opportunity,
          states: csv(opts.state),
          zendesk_ticket_id: positiveInteger(opts.ticket, "--ticket"),
          engagement: opts.engagement
            ? normalizeState(opts.engagement)
            : undefined,
          suggested_action: opts.suggestedAction
            ? normalizeState(opts.suggestedAction)
            : undefined,
          reason: readReason(opts.reason, "Review CRM outreach queue"),
        }),
    ),
  );
  outreach
    .command("show <delivery>")
    .description("show an outreach delivery by UUID, provider key, or ticket")
    .option("--reason <text>", "audit reason")
    .action(async (delivery: string, opts: any, cmd: Command) =>
      deps.withContext(cmd, "admin crm outreach show", async (ctx) => {
        const reason = readReason(opts.reason, "Review CRM outreach delivery");
        const [record, operations, engagement] = await Promise.all([
          ctx.hub.adminCrm.getOutreachDelivery({ delivery, reason }),
          ctx.hub.adminCrm.listOutreachProviderOperations({
            delivery,
            reason,
            limit: 100,
          }),
          ctx.hub.adminCrm.listOutreachEngagementEvents({
            delivery,
            reason,
            limit: 100,
          }),
        ]);
        return {
          delivery: record,
          provider_operations: operations,
          engagement,
          support_show_command: record.zendesk_ticket_id
            ? `cocalc admin support show ${record.zendesk_ticket_id}`
            : undefined,
        };
      }),
    );
  outreach
    .command("preview <batch>")
    .description("render exact recipients, content, preflight, and limits")
    .option("--reason <text>", "audit reason")
    .action(async (batch: string, opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        "admin crm outreach preview",
        async (ctx) =>
          await ctx.hub.adminCrm.previewOutreachBatch({
            batch,
            reason: readReason(opts.reason, "Preview CRM outreach batch"),
          }),
      ),
    );

  addMutationOptions(
    outreach
      .command("draft <batch>")
      .description("preview or add one reviewed recipient to a draft batch")
      .requiredOption("--person <person>", "reviewed CRM contact or email")
      .option(
        "--organization <customer>",
        "CRM organization when contact has several",
      )
      .option("--opportunity <opportunity>", "linked CRM opportunity")
      .option("--email <email>", "specific reviewed contact email")
      .option("--subject <subject>", "custom exact subject")
      .option("--body-file <path>", "custom Markdown body file")
      .option("--override-reason <text>", "reviewed cooldown warning override"),
  ).action(async (batch: string, opts: any, cmd: Command) =>
    deps.withContext(cmd, "admin crm outreach draft", async (ctx) => {
      const body = opts.bodyFile
        ? await readFile(opts.bodyFile, "utf8")
        : undefined;
      return await ctx.hub.adminCrm.addOutreachRecipient(
        mutationRequest("outreach.recipient.add", opts, {
          batch,
          person: opts.person,
          organization: opts.organization,
          opportunity: opts.opportunity,
          email: opts.email,
          subject: opts.subject,
          body_markdown: body,
          override_reason: opts.overrideReason,
        }),
      );
    }),
  );

  for (const action of [
    "approve",
    "queue",
    "pause",
    "resume",
    "cancel",
  ] as const) {
    addMutationOptions(
      outreach
        .command(`${action} <batch>`)
        .description(`preview or ${action} an outreach batch`),
    ).action(async (batch: string, opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        `admin crm outreach ${action}`,
        async (ctx) =>
          await ctx.hub.adminCrm.transitionOutreachBatch(
            mutationRequest(`outreach.batch.${action}`, opts, {
              batch,
              action,
            }),
          ),
      ),
    );
  }

  for (const action of ["retry", "reconcile"] as const) {
    addMutationOptions(
      outreach
        .command(`${action} <delivery>`)
        .description(`preview or ${action} one delivery`),
    ).action(async (delivery: string, opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        `admin crm outreach ${action}`,
        async (ctx) =>
          await ctx.hub.adminCrm.mutateOutreachDelivery(
            mutationRequest(`outreach.delivery.${action}`, opts, {
              delivery,
              action,
            }),
          ),
      ),
    );
  }

  outreach
    .command("limits")
    .description("show effective limits, rolling usage, and provider backoff")
    .option(
      "--domain <domain>",
      "include current usage for one recipient domain",
    )
    .option("--reason <text>", "audit reason")
    .action(async (opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        "admin crm outreach limits",
        async (ctx) =>
          await ctx.hub.adminCrm.getOutreachLimits({
            domain: opts.domain,
            reason: readReason(opts.reason, "Review CRM outreach limits"),
          }),
      ),
    );
  outreach
    .command("diagnostics")
    .description("show provider configuration and consistency diagnostics")
    .option("--reason <text>", "audit reason")
    .action(async (opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        "admin crm outreach diagnostics",
        async (ctx) =>
          await ctx.hub.adminCrm.getOutreachDiagnostics({
            reason: readReason(opts.reason, "Review CRM outreach diagnostics"),
          }),
      ),
    );

  const batches = outreach
    .command("batch")
    .alias("batches")
    .description("reviewed one-recipient and small-batch workflows");
  addPageOptions(
    batches
      .command("list")
      .description("list outreach batches")
      .option("--state <states>", "comma-separated batch states")
      .option("--kind <kinds>", "comma-separated outreach kinds")
      .option("--owner <account>", "batch owner")
      .option("--organization <customer>", "contains this customer")
      .option("--ticket <id>", "contains this Zendesk ticket"),
  ).action(async (opts: any, cmd: Command) =>
    deps.withContext(cmd, "admin crm outreach batch list", async (ctx) => {
      return await ctx.hub.adminCrm.listOutreachBatches({
        ...page(opts),
        states: csv(opts.state),
        kinds: csv(opts.kind),
        owner_account_id: opts.owner
          ? await resolveAccount(ctx, opts.owner, deps)
          : undefined,
        organization: opts.organization,
        zendesk_ticket_id: positiveInteger(opts.ticket, "--ticket"),
        reason: readReason(opts.reason, "Review CRM outreach batches"),
      });
    }),
  );
  batches
    .command("show <batch>")
    .description("show one batch and every recipient delivery")
    .option("--reason <text>", "audit reason")
    .action(async (batch: string, opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        "admin crm outreach batch show",
        async (ctx) =>
          await ctx.hub.adminCrm.getOutreachBatch({
            batch,
            reason: readReason(opts.reason, "Review CRM outreach batch"),
          }),
      ),
    );
  addMutationOptions(
    batches
      .command("create")
      .description("preview or create a draft outreach batch")
      .requiredOption("--name <name>", "batch name")
      .requiredOption("--purpose <purpose>", "reviewed business purpose")
      .requiredOption("--kind <kind>", CRM_OUTREACH_KINDS.join(", "))
      .requiredOption("--owner <account>", "responsible admin")
      .option(
        "--template <template>",
        "active template key, key@revision, or UUID",
      ),
  ).action(async (opts: any, cmd: Command) =>
    deps.withContext(cmd, "admin crm outreach batch create", async (ctx) => {
      return await ctx.hub.adminCrm.createOutreachBatch(
        mutationRequest("outreach.batch.create", opts, {
          name: opts.name,
          purpose: opts.purpose,
          kind: enumValue(opts.kind, CRM_OUTREACH_KINDS, "--kind"),
          owner_account_id: await resolveAccount(ctx, opts.owner, deps),
          template: opts.template,
        }),
      );
    }),
  );
  addMutationOptions(
    batches
      .command("update <batch>")
      .description("preview or update draft batch fields from JSON")
      .requiredOption("--file <path>", "JSON object with reviewed changes"),
  ).action(async (batch: string, opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm outreach batch update",
      async (ctx) =>
        await ctx.hub.adminCrm.updateOutreachBatch(
          mutationRequest("outreach.batch.update", opts, {
            batch,
            changes: await readJson(opts.file),
          }),
        ),
    ),
  );
  addMutationOptions(
    batches
      .command("remove <batch> <delivery>")
      .description("preview or remove a draft recipient"),
  ).action(async (batch: string, delivery: string, opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm outreach batch remove",
      async (ctx) =>
        await ctx.hub.adminCrm.removeOutreachRecipient(
          mutationRequest("outreach.recipient.remove", opts, {
            batch,
            delivery,
          }),
        ),
    ),
  );

  const templates = outreach
    .command("templates")
    .description("immutable outreach template revisions");
  addPageOptions(
    templates
      .command("list")
      .option("--key <key>", "stable template key")
      .option("--kind <kind>", "outreach kind")
      .option("--status <status>", "draft, active, or retired"),
  ).action(async (opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm outreach templates list",
      async (ctx) =>
        await ctx.hub.adminCrm.listOutreachTemplates({
          ...page(opts),
          template_key: opts.key,
          kind: opts.kind ? normalizeState(opts.kind) : undefined,
          status: opts.status ? normalizeState(opts.status) : undefined,
          reason: readReason(opts.reason, "Review CRM outreach templates"),
        }),
    ),
  );
  templates
    .command("show <template>")
    .description("show a template revision")
    .option("--reason <text>", "audit reason")
    .action(async (template: string, opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        "admin crm outreach templates show",
        async (ctx) =>
          await ctx.hub.adminCrm.getOutreachTemplate({
            template,
            reason: readReason(opts.reason, "Review CRM outreach template"),
          }),
      ),
    );
  addMutationOptions(
    templates
      .command("create")
      .alias("revise")
      .description("preview or create an immutable draft template revision")
      .requiredOption("--key <key>", "stable lower-case template key")
      .requiredOption("--name <name>", "human template name")
      .requiredOption("--kind <kind>", CRM_OUTREACH_KINDS.join(", "))
      .requiredOption("--subject <template>", "allowlisted merge-field subject")
      .requiredOption("--body-file <path>", "Markdown body template")
      .option("--required-fields <fields>", "comma-separated merge fields")
      .option(
        "--follow-up-policy <policy>",
        CRM_OUTREACH_FOLLOW_UP_POLICIES.join(", "),
        "no_response",
      )
      .option("--follow-up-after-days <n>", "override follow-up interval")
      .option("--max-followups <n>", "override reviewed follow-up maximum")
      .option(
        "--final-review-after-days <n>",
        "override final review interval",
      ),
  ).action(async (opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm outreach templates create",
      async (ctx) =>
        await ctx.hub.adminCrm.createOutreachTemplate(
          mutationRequest("outreach.template.create", opts, {
            template_key: opts.key,
            name: opts.name,
            kind: enumValue(opts.kind, CRM_OUTREACH_KINDS, "--kind"),
            subject_template: opts.subject,
            body_markdown_template: await readFile(opts.bodyFile, "utf8"),
            required_fields: `${opts.requiredFields ?? ""}`
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
            follow_up_policy: enumValue(
              opts.followUpPolicy,
              CRM_OUTREACH_FOLLOW_UP_POLICIES,
              "--follow-up-policy",
            ),
            follow_up_after_days: positiveInteger(
              opts.followUpAfterDays,
              "--follow-up-after-days",
              90,
            ),
            max_followups: positiveInteger(
              opts.maxFollowups,
              "--max-followups",
              5,
            ),
            final_review_after_days: positiveInteger(
              opts.finalReviewAfterDays,
              "--final-review-after-days",
              90,
            ),
          }),
        ),
    ),
  );
  for (const action of ["activate", "retire"] as const) {
    addMutationOptions(
      templates
        .command(`${action} <template>`)
        .description(`preview or ${action} a template revision`),
    ).action(async (template: string, opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        `admin crm outreach templates ${action}`,
        async (ctx) =>
          await ctx.hub.adminCrm.transitionOutreachTemplate(
            mutationRequest(`outreach.template.${action}`, opts, {
              template,
              action,
            }),
          ),
      ),
    );
  }

  const suppressions = outreach
    .command("suppressions")
    .description("shared opt-out, bounce, complaint, and manual suppressions");
  addPageOptions(
    suppressions
      .command("list")
      .option("--organization <customer>", "CRM customer")
      .option("--person <person>", "CRM person")
      .option("--scope <scope>", CRM_OUTREACH_SUPPRESSION_SCOPES.join(", "))
      .option("--search <text>", "scope value or note")
      .option("--inactive", "show revoked suppressions"),
  ).action(async (opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm outreach suppressions list",
      async (ctx) =>
        await ctx.hub.adminCrm.listContactSuppressions({
          ...page(opts),
          organization: opts.organization,
          person: opts.person,
          scope: opts.scope ? normalizeState(opts.scope) : undefined,
          search: opts.search,
          active: opts.inactive ? false : true,
          reason: readReason(opts.reason, "Review CRM outreach suppressions"),
        }),
    ),
  );
  addMutationOptions(
    suppressions
      .command("add")
      .requiredOption(
        "--scope <scope>",
        CRM_OUTREACH_SUPPRESSION_SCOPES.join(", "),
      )
      .option("--value <value>", "normalized email/domain or CRM ID")
      .option("--organization <customer>", "CRM organization")
      .option("--person <person>", "CRM person")
      .option("--email <email>", "reviewed email")
      .option(
        "--suppression-reason <reason>",
        CRM_OUTREACH_SUPPRESSION_REASONS.join(", "),
        "manual",
      )
      .option("--note <text>", "bounded internal note"),
  ).action(async (opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm outreach suppressions add",
      async (ctx) =>
        await ctx.hub.adminCrm.mutateContactSuppression(
          mutationRequest("outreach.suppression.add", opts, {
            action: "add",
            scope: enumValue(
              opts.scope,
              CRM_OUTREACH_SUPPRESSION_SCOPES,
              "--scope",
            ),
            value: opts.value,
            organization: opts.organization,
            person: opts.person,
            email: opts.email,
            suppression_reason: enumValue(
              opts.suppressionReason,
              CRM_OUTREACH_SUPPRESSION_REASONS,
              "--suppression-reason",
            ),
            note: opts.note,
          }),
        ),
    ),
  );
  addMutationOptions(
    suppressions
      .command("revoke <suppression>")
      .description("preview or revoke an active suppression"),
  ).action(async (suppression: string, opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm outreach suppressions revoke",
      async (ctx) =>
        await ctx.hub.adminCrm.mutateContactSuppression(
          mutationRequest("outreach.suppression.revoke", opts, {
            action: "revoke",
            suppression,
          }),
        ),
    ),
  );

  const followups = outreach
    .command("followups")
    .description("shared no-response follow-up work");
  addPageOptions(
    followups
      .command("list")
      .option("--organization <customer>", "CRM customer")
      .option("--opportunity <opportunity>", "CRM opportunity")
      .option("--assignee <account>", "task assignee")
      .option("--due-before <iso>", "task deadline")
      .option("--overdue", "only overdue tasks")
      .option("--viewed", "view observed")
      .option("--unviewed", "no view observed")
      .option("--replied", "requester replied")
      .option("--unreplied", "no requester reply"),
  ).action(async (opts: any, cmd: Command) =>
    deps.withContext(cmd, "admin crm outreach followups list", async (ctx) => {
      if (opts.viewed && opts.unviewed)
        throw Error("choose --viewed or --unviewed");
      if (opts.replied && opts.unreplied)
        throw Error("choose --replied or --unreplied");
      return await ctx.hub.adminCrm.listOutreachFollowups({
        ...page(opts),
        organization: opts.organization,
        opportunity: opts.opportunity,
        assignee_account_id: opts.assignee
          ? await resolveAccount(ctx, opts.assignee, deps)
          : undefined,
        due_before: opts.dueBefore,
        overdue: opts.overdue || undefined,
        viewed: opts.viewed ? true : opts.unviewed ? false : undefined,
        replied: opts.replied ? true : opts.unreplied ? false : undefined,
        reason: readReason(opts.reason, "Review CRM outreach follow-ups"),
      });
    }),
  );
  followups
    .command("show <delivery>")
    .description("show the linked delivery and follow-up task")
    .option("--reason <text>", "audit reason")
    .action(async (delivery: string, opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        "admin crm outreach followups show",
        async (ctx) => {
          const record = await ctx.hub.adminCrm.getOutreachDelivery({
            delivery,
            reason: readReason(opts.reason, "Review CRM outreach follow-up"),
          });
          const task = record.task_id
            ? await ctx.hub.adminCrm.getTask({
                task: record.task_id,
                reason: readReason(
                  opts.reason,
                  "Review CRM outreach follow-up task",
                ),
              })
            : undefined;
          return { delivery: record, task };
        },
      ),
    );
  followups
    .command("preview <delivery>")
    .alias("draft")
    .option("--body-file <path>", "reviewed follow-up body")
    .option("--reason <text>", "audit reason")
    .action(async (delivery: string, opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        "admin crm outreach followups preview",
        async (ctx) =>
          await ctx.hub.adminCrm.previewOutreachFollowup({
            delivery,
            body: opts.bodyFile
              ? await readFile(opts.bodyFile, "utf8")
              : undefined,
            reason: readReason(opts.reason, "Preview CRM outreach follow-up"),
          }),
      ),
    );
  addMutationOptions(
    followups
      .command("send <delivery>")
      .description("preview or queue a reviewed same-thread Zendesk comment")
      .requiredOption("--body-file <path>", "reviewed public follow-up body"),
  ).action(async (delivery: string, opts: any, cmd: Command) =>
    deps.withContext(
      cmd,
      "admin crm outreach followups send",
      async (ctx) =>
        await ctx.hub.adminCrm.sendOutreachFollowup(
          mutationRequest("outreach.followup.queue", opts, {
            delivery,
            body: await readFile(opts.bodyFile, "utf8"),
          }),
        ),
    ),
  );

  for (const action of ["reschedule", "complete", "cancel"] as const) {
    addMutationOptions(
      followups
        .command(`${action} <delivery>`)
        .description(`preview or ${action} the shared follow-up task`)
        .option("--due <iso>", "new due timestamp (required for reschedule)"),
    ).action(async (delivery: string, opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        `admin crm outreach followups ${action}`,
        async (ctx) => {
          if (action === "reschedule" && !opts.due)
            throw Error("--due is required");
          const record = await ctx.hub.adminCrm.getOutreachDelivery({
            delivery,
            reason: readReason(opts.reason, "Resolve outreach follow-up task"),
          });
          if (!record.task_id)
            throw Error("outreach delivery has no linked follow-up task");
          return await ctx.hub.adminCrm.transitionTask(
            mutationRequest(`task.${action}`, opts, {
              task: record.task_id,
              action,
              due_at: opts.due,
            }),
          );
        },
      ),
    );
  }

  const engagement = outreach
    .command("engagement <delivery>")
    .description("list immutable view observations for one opening message");
  addPageOptions(engagement).action(
    async (delivery: string, opts: any, cmd: Command) =>
      deps.withContext(
        cmd,
        "admin crm outreach engagement",
        async (ctx) =>
          await ctx.hub.adminCrm.listOutreachEngagementEvents({
            ...page(opts),
            delivery,
            reason: readReason(opts.reason, "Review CRM outreach engagement"),
          }),
      ),
  );
}

export function registerCrmCommand(
  admin: Command,
  deps: CrmCommandDeps,
): Command {
  const cliDeps: CrmCommandDeps = {
    ...deps,
    withContext: (
      command: unknown,
      label: string,
      fn: (ctx: unknown) => Promise<unknown>,
    ) =>
      deps.withContext(command, label, async (ctx: unknown) =>
        crmCliEnvelope(await fn(ctx)),
      ),
  };
  const crm = admin
    .command("crm")
    .description("seed-global customer relationship management")
    .addHelpText(
      "after",
      `\nAdmin runbooks:\n  cocalc docs show admin/crm --include-admin\n  cocalc docs show admin/crm-outreach --include-admin\n  cocalc docs search "customer relationship CRM" --include-admin\n  cocalc docs skill-context --query "institutional customer CRM" --include-admin\n\nMutations preview by default. Review the returned expected_version and idempotency_key, then re-run with --expected-version, --idempotency-key, and --commit. Committed writes and exports require browser-approved fresh authentication.\n`,
    );
  registerOrganizations(crm, cliDeps);
  registerDomains(crm, cliDeps);
  registerPeople(crm, cliDeps);
  registerOpportunities(crm, cliDeps);
  registerTasks(crm, cliDeps);
  registerActivities(crm, cliDeps);
  registerLinks(crm, cliDeps);
  registerOrder(crm, cliDeps);
  registerOutreach(crm, cliDeps);
  registerTopLevel(crm, cliDeps);
  return crm;
}
