/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";

import type * as Store from "./store";
import type { CrmMutationResult } from "@cocalc/util/crm";

const describePglite =
  process.env.COCALC_TEST_USE_PGLITE === "1" ? describe : describe.skip;

const actor = randomUUID();

const CRM_TABLES = [
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

function committed<T>(value: CrmMutationResult<T>): T {
  if (value.preview) throw Error("expected a committed CRM mutation");
  return value.result;
}

describePglite("integrated CRM store", () => {
  const originalEnv = {
    COCALC_BAY_ID: process.env.COCALC_BAY_ID,
    COCALC_CLUSTER_SEED_BAY_ID: process.env.COCALC_CLUSTER_SEED_BAY_ID,
    COCALC_DB: process.env.COCALC_DB,
    COCALC_PGLITE_DATA_DIR: process.env.COCALC_PGLITE_DATA_DIR,
  };
  let store: typeof Store;
  let pool: Awaited<
    ReturnType<(typeof import("@cocalc/database/pool"))["default"]>
  >;

  beforeAll(async () => {
    process.env.COCALC_BAY_ID = "crm-test-seed";
    process.env.COCALC_CLUSTER_SEED_BAY_ID = "crm-test-seed";
    process.env.COCALC_DB = "pglite";
    process.env.COCALC_PGLITE_DATA_DIR = "memory://";
    const getPool = (await import("@cocalc/database/pool")).default;
    pool = getPool();
    await pool.query(`CREATE TABLE commercial_orders (
      id UUID PRIMARY KEY,
      order_number TEXT,
      organization_name TEXT,
      workflow_state TEXT,
      collection_state TEXT,
      fulfillment_state TEXT,
      currency TEXT,
      agreed_total NUMERIC,
      assignee_account_id UUID,
      next_action TEXT,
      next_action_due_at TIMESTAMPTZ,
      crm_organization_id UUID,
      customer_account_id UUID,
      zendesk_ticket_ids INTEGER[] DEFAULT '{}',
      stripe_customer_id TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE commercial_order_contacts (
      id UUID PRIMARY KEY,
      crm_person_id UUID
    )`);
    await pool.query(`CREATE TABLE commercial_order_events (
      id UUID PRIMARY KEY,
      commercial_order_id UUID,
      event_type TEXT,
      actor_account_id UUID,
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE commercial_payments (
      id UUID PRIMARY KEY,
      commercial_order_id UUID,
      amount NUMERIC,
      status TEXT,
      received_at TIMESTAMPTZ
    )`);
    await pool.query(`CREATE TABLE commercial_invoices (
      id UUID PRIMARY KEY,
      commercial_order_id UUID,
      amount_due NUMERIC,
      amount_paid NUMERIC,
      status TEXT
    )`);
    await pool.query(`CREATE TABLE site_licenses (
      id UUID PRIMARY KEY,
      name TEXT,
      organization_name TEXT,
      owner_account_id UUID,
      allowed_domains TEXT[] DEFAULT '{}',
      starts_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      metadata JSONB DEFAULT '{}',
      crm_organization_id UUID,
      updated TIMESTAMPTZ DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE membership_packages (
      id UUID PRIMARY KEY,
      kind TEXT,
      membership_class TEXT,
      seat_count INTEGER,
      starts_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      metadata JSONB DEFAULT '{}'
    )`);
    const { SCHEMA } = await import("@cocalc/util/schema");
    const { schemaNeedsSync, syncSchema } =
      await import("@cocalc/database/postgres/schema/sync");
    const crmSchema = Object.fromEntries(
      CRM_TABLES.map((name) => [name, SCHEMA[name]]),
    );
    await syncSchema(crmSchema);
    expect(await schemaNeedsSync(crmSchema)).toBe(false);
    store = await import("./store");
  });

  afterAll(async () => {
    const { closePglite } = await import("@cocalc/database/pglite");
    await closePglite();
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("previews without writing and replays an exact committed create", async () => {
    const request = {
      account_id: actor,
      display_name: `Integration University ${randomUUID()}`,
      organization_type: "university" as const,
      lifecycle_stage: "prospect" as const,
      reason: "reviewed institutional inquiry",
      source: "cli" as const,
    };
    const before = await pool.query(
      "SELECT count(*)::int AS count FROM crm_organizations",
    );
    const preview = await store.createOrganization(request);
    expect(preview.preview).toBe(true);
    const afterPreview = await pool.query(
      "SELECT count(*)::int AS count FROM crm_organizations",
    );
    expect(afterPreview.rows[0].count).toBe(before.rows[0].count);
    if (!preview.preview) throw Error("expected preview");
    const commitRequest = {
      ...request,
      commit: true,
      expected_version: preview.expected_version,
      idempotency_key: preview.idempotency_key,
    };
    const created = committed(await store.createOrganization(commitRequest));
    const replay = await store.createOrganization(commitRequest);
    expect(replay.preview).toBe(false);
    if (replay.preview) throw Error("expected replay");
    expect(replay.replayed).toBe(true);
    expect(replay.result.id).toBe(created.id);
    expect(created.customer_number).toMatch(/^CRM-\d{4}-\d{6}$/);
  });

  it("enforces versions and evidence-based domain identity", async () => {
    const createdPreview = await store.createOrganization({
      account_id: actor,
      display_name: `Domain University ${randomUUID()}`,
      organization_type: "university",
      reason: "reviewed domain customer",
    });
    if (!createdPreview.preview) throw Error("expected preview");
    const organization = committed(
      await store.createOrganization({
        account_id: actor,
        display_name: createdPreview.proposed.display_name as string,
        organization_type: "university",
        reason: "reviewed domain customer",
        commit: true,
        expected_version: 0,
        idempotency_key: createdPreview.idempotency_key,
      }),
    );
    await expect(
      store.updateOrganization({
        account_id: actor,
        organization: organization.id,
        reason: "stale customer edit",
        commit: true,
        expected_version: organization.version + 1,
        idempotency_key: `stale-${randomUUID()}`,
        changes: { lifecycle_stage: "pilot" },
      }),
    ).rejects.toThrow("current version");

    const generic = await store.mutateDomain({
      account_id: actor,
      organization: organization.id,
      domain: "gmail.com",
      action: "verify",
      reason: "test generic identity guard",
    });
    expect(generic.preview).toBe(true);
    if (!generic.preview) throw Error("expected preview");
    expect(generic.warnings.join(" ")).toMatch(/generic/i);
    await expect(
      store.mutateDomain({
        account_id: actor,
        organization: organization.id,
        domain: "gmail.com",
        action: "verify",
        reason: "test generic identity guard",
        commit: true,
        expected_version: generic.expected_version,
        idempotency_key: generic.idempotency_key,
      }),
    ).rejects.toThrow(/generic/i);

    const domainPreview = await store.mutateDomain({
      account_id: actor,
      organization: organization.id,
      domain: "Example.EDU",
      action: "verify",
      verification_method: "institutional website",
      evidence_reference: "https://example.edu/about",
      reason: "review institutional domain evidence",
    });
    if (!domainPreview.preview) throw Error("expected preview");
    expect(domainPreview.proposed).toMatchObject({
      normalized_domain: "example.edu",
      verification_method: "institutional website",
      evidence_reference: "https://example.edu/about",
    });
  });

  it("links the intended customer account and builds Customer 360", async () => {
    const organizationPreview = await store.createOrganization({
      account_id: actor,
      display_name: `Customer 360 University ${randomUUID()}`,
      organization_type: "university",
      lifecycle_stage: "pilot",
      reason: "build customer 360 fixture",
    });
    if (!organizationPreview.preview) throw Error("expected preview");
    const organization = committed(
      await store.createOrganization({
        account_id: actor,
        display_name: organizationPreview.proposed.display_name as string,
        organization_type: "university",
        lifecycle_stage: "pilot",
        reason: "build customer 360 fixture",
        commit: true,
        expected_version: 0,
        idempotency_key: organizationPreview.idempotency_key,
      }),
    );
    const linkedAccount = randomUUID();
    const personPreview = await store.createPerson({
      account_id: actor,
      display_name: "Ada Procurement",
      organization: organization.id,
      roles: ["billing", "procurement"],
      title: "Procurement Manager",
      department: "Finance",
      email: "ada@example.edu",
      cocalc_account_id: linkedAccount,
      website: "ada.example.edu",
      linkedin_url: "https://www.linkedin.com/in/ada-procurement",
      facebook_url: "https://www.facebook.com/ada.procurement",
      note: "Primary procurement contact for the adoption pilot.",
      reason: "customer supplied billing contact",
    });
    if (!personPreview.preview) throw Error("expected preview");
    expect(personPreview.proposed).toMatchObject({
      title: "Procurement Manager",
      department: "Finance",
      website: "https://ada.example.edu/",
      linkedin_url: "https://www.linkedin.com/in/ada-procurement",
      note: "Primary procurement contact for the adoption pilot.",
    });
    const person = committed(
      await store.createPerson({
        account_id: actor,
        display_name: "Ada Procurement",
        organization: organization.id,
        roles: ["billing", "procurement"],
        title: "Procurement Manager",
        department: "Finance",
        email: "ada@example.edu",
        cocalc_account_id: linkedAccount,
        website: "ada.example.edu",
        linkedin_url: "https://www.linkedin.com/in/ada-procurement",
        facebook_url: "https://www.facebook.com/ada.procurement",
        note: "Primary procurement contact for the adoption pilot.",
        reason: "customer supplied billing contact",
        commit: true,
        expected_version: personPreview.expected_version,
        idempotency_key: personPreview.idempotency_key,
      }),
    );
    const loadedPerson = await store.getPerson({
      person: person.id,
      reason: "verify customer account relationship",
    });
    expect(loadedPerson.accounts[0]?.account_id).toBe(linkedAccount);
    expect(loadedPerson.accounts[0]?.account_id).not.toBe(actor);
    expect(loadedPerson).toMatchObject({
      website: "https://ada.example.edu/",
      linkedin_url: "https://www.linkedin.com/in/ada-procurement",
      facebook_url: "https://www.facebook.com/ada.procurement",
      note: "Primary procurement contact for the adoption pilot.",
    });

    const personUpdatePreview = await store.updatePerson({
      account_id: actor,
      person: person.id,
      changes: {
        x_url: "x.com/ada_procurement",
        note: "Coordinates procurement and pilot onboarding.",
      },
      reason: "review public profile and contact context",
    });
    if (!personUpdatePreview.preview) throw Error("expected preview");
    expect(personUpdatePreview.proposed).toMatchObject({
      x_url: "https://x.com/ada_procurement",
      note: "Coordinates procurement and pilot onboarding.",
    });
    const updatedPerson = committed(
      await store.updatePerson({
        account_id: actor,
        person: person.id,
        changes: {
          x_url: "x.com/ada_procurement",
          note: "Coordinates procurement and pilot onboarding.",
        },
        reason: "review public profile and contact context",
        commit: true,
        expected_version: personUpdatePreview.expected_version,
        idempotency_key: personUpdatePreview.idempotency_key,
      }),
    );
    expect(updatedPerson).toMatchObject({
      x_url: "https://x.com/ada_procurement",
      note: "Coordinates procurement and pilot onboarding.",
    });

    const emailPreview = await store.mutatePersonEmail({
      account_id: actor,
      person: person.id,
      email: "ada@example.edu",
      action: "update",
      verified: true,
      reason: "verify customer supplied contact email",
    });
    if (!emailPreview.preview) throw Error("expected preview");
    expect(emailPreview.proposed).toMatchObject({
      action: "update",
      kind: "work",
      is_primary: true,
      verified: true,
    });
    committed(
      await store.mutatePersonEmail({
        account_id: actor,
        person: person.id,
        email: "ada@example.edu",
        action: "update",
        verified: true,
        reason: "verify customer supplied contact email",
        commit: true,
        expected_version: emailPreview.expected_version,
        idempotency_key: emailPreview.idempotency_key,
      }),
    );
    const accountPreview = await store.mutatePersonAccount({
      account_id: actor,
      person: person.id,
      linked_account_id: linkedAccount,
      action: "verify",
      evidence_reference: "account owner confirmed the link",
      reason: "verify contact CoCalc account",
    });
    if (!accountPreview.preview) throw Error("expected preview");
    expect(accountPreview.proposed).toMatchObject({
      action: "verify",
      state: "verified",
      evidence_reference: "account owner confirmed the link",
    });
    committed(
      await store.mutatePersonAccount({
        account_id: actor,
        person: person.id,
        linked_account_id: linkedAccount,
        action: "verify",
        evidence_reference: "account owner confirmed the link",
        reason: "verify contact CoCalc account",
        commit: true,
        expected_version: accountPreview.expected_version,
        idempotency_key: accountPreview.idempotency_key,
      }),
    );
    const ticketPreview = await store.mutateExternalReference({
      account_id: actor,
      organization: organization.id,
      action: "verify",
      provider: "zendesk",
      object_kind: "ticket",
      external_id: "20529",
      label: "OES pilot inquiry",
      metadata: { status: "open" },
      reason: "link reviewed support request",
    });
    if (!ticketPreview.preview) throw Error("expected preview");
    expect(ticketPreview.proposed).toMatchObject({
      action: "verify",
      label: "OES pilot inquiry",
      metadata: { status: "open" },
    });
    committed(
      await store.mutateExternalReference({
        account_id: actor,
        organization: organization.id,
        action: "verify",
        provider: "zendesk",
        object_kind: "ticket",
        external_id: "20529",
        label: "OES pilot inquiry",
        metadata: { status: "open" },
        reason: "link reviewed support request",
        commit: true,
        expected_version: ticketPreview.expected_version,
        idempotency_key: ticketPreview.idempotency_key,
      }),
    );
    const supportContext = await store.getSupportContext({
      ticket_id: 20529,
      requester_email: "ada@example.edu",
      requester_account_id: linkedAccount,
      reason: "correlate reviewed support request",
    });
    expect(supportContext.candidates).toHaveLength(1);
    expect(supportContext.candidates[0].linked).toBe(true);
    expect(
      supportContext.candidates[0].evidence.map(({ kind }) => kind).sort(),
    ).toEqual(["cocalc_account", "verified_email", "zendesk_ticket"]);
    for (const query of [
      organization.id,
      organization.customer_number,
      organization.display_name,
    ]) {
      expect(
        (
          await store.searchOrganizations({
            account_id: actor,
            query,
            reason: "hydrate an existing customer selector",
          })
        ).organizations.map(({ id }) => id),
      ).toContain(organization.id);
    }
    expect(
      (
        await store.searchOrganizations({
          account_id: actor,
          linked_account_id: linkedAccount,
          reason: "find a customer by linked CoCalc account",
        })
      ).organizations.map(({ id }) => id),
    ).toContain(organization.id);
    expect(
      (
        await store.searchOrganizations({
          account_id: actor,
          query: organization.id,
          linked_account_id: randomUUID(),
          reason: "exclude a customer not linked to the requested account",
        })
      ).organizations,
    ).toHaveLength(0);
    expect(
      (
        await store.listPeople({
          organization: organization.id,
          search: person.id,
          reason: "hydrate an existing contact selector",
        })
      ).people.map(({ id }) => id),
    ).toContain(person.id);

    const opportunityPreview = await store.createOpportunity({
      account_id: actor,
      organization: organization.id,
      name: "Campus adoption pilot",
      kind: "adoption_pilot",
      owner_account_id: actor,
      expected_value: "3900",
      expected_close_date: "2026-09-30",
      service_starts_at: "2026-09-01T00:00:00Z",
      service_ends_at: "2027-06-30T23:59:59Z",
      source_zendesk_ticket_ids: [20529],
      reason: "reviewed growth opportunity",
    });
    if (!opportunityPreview.preview) throw Error("expected preview");
    expect(opportunityPreview.proposed).toMatchObject({
      service_starts_at: "2026-09-01T00:00:00.000Z",
      service_ends_at: "2027-06-30T23:59:59.000Z",
      source_zendesk_ticket_ids: [20529],
    });
    const opportunity = committed(
      await store.createOpportunity({
        account_id: actor,
        organization: organization.id,
        name: "Campus adoption pilot",
        kind: "adoption_pilot",
        owner_account_id: actor,
        expected_value: "3900",
        expected_close_date: "2026-09-30",
        service_starts_at: "2026-09-01T00:00:00Z",
        service_ends_at: "2027-06-30T23:59:59Z",
        source_zendesk_ticket_ids: [20529],
        reason: "reviewed growth opportunity",
        commit: true,
        expected_version: opportunityPreview.expected_version,
        idempotency_key: opportunityPreview.idempotency_key,
      }),
    );
    expect(opportunity).toMatchObject({
      expected_close_date: "2026-09-30",
      service_starts_at: "2026-09-01T00:00:00.000Z",
      service_ends_at: "2027-06-30T23:59:59.000Z",
      source_zendesk_ticket_ids: [20529],
    });
    const pilotCustomers = await store.listOrganizations({
      account_id: actor,
      opportunity_kinds: ["adoption_pilot"],
      reason: "review customers with open pilot opportunities",
    });
    expect(
      pilotCustomers.organizations.find(({ id }) => id === organization.id),
    ).toMatchObject({
      open_opportunity_count: 1,
      open_opportunity_kinds: ["adoption_pilot"],
    });
    const taskPreview = await store.createTask({
      account_id: actor,
      organization: organization.id,
      opportunity: opportunity.id,
      type: "procurement",
      assignee_account_id: actor,
      due_at: "2026-09-01T17:00:00.000Z",
      subject: "Obtain purchase order",
      zendesk_ticket_id: 20529,
      reason: "record explicit next action",
    });
    if (!taskPreview.preview) throw Error("expected preview");
    expect(taskPreview.proposed).toMatchObject({ zendesk_ticket_id: 20529 });
    const task = committed(
      await store.createTask({
        account_id: actor,
        organization: organization.id,
        opportunity: opportunity.id,
        type: "procurement",
        assignee_account_id: actor,
        due_at: "2026-09-01T17:00:00.000Z",
        subject: "Obtain purchase order",
        zendesk_ticket_id: 20529,
        reason: "record explicit next action",
        commit: true,
        expected_version: taskPreview.expected_version,
        idempotency_key: taskPreview.idempotency_key,
      }),
    );
    expect(task.zendesk_ticket_id).toBe(20529);
    const relationPreview = await store.mutateOrganizationPerson({
      account_id: actor,
      organization: organization.id,
      person: person.id,
      action: "update",
      roles: ["billing", "decision_maker"],
      title: "Senior Procurement Manager",
      department: "Central Finance",
      state: "active",
      reason: "update reviewed customer contact role",
    });
    if (!relationPreview.preview) throw Error("expected preview");
    expect(relationPreview.proposed).toMatchObject({
      action: "update",
      roles: ["billing", "decision_maker"],
      title: "Senior Procurement Manager",
      department: "Central Finance",
      state: "active",
    });
    const activityPreview = await store.addActivity({
      account_id: actor,
      organization: organization.id,
      person: person.id,
      opportunity: opportunity.id,
      task: task.id,
      kind: "meeting",
      summary: "Reviewed procurement timeline",
      details: "Customer expects a purchase order next week.",
      occurred_at: "2026-08-24T12:00:00Z",
      reason: "record customer meeting",
    });
    if (!activityPreview.preview) throw Error("expected preview");
    expect(activityPreview.proposed).toMatchObject({
      person_id: person.id,
      opportunity_id: opportunity.id,
      task_id: task.id,
      kind: "meeting",
      source: "manual",
      occurred_at: "2026-08-24T12:00:00.000Z",
    });
    await expect(
      store.createOrderFromOpportunity({
        account_id: actor,
        opportunity: opportunity.id,
        next_action: "Obtain purchase order",
        reason: "reject a premature receivables handoff",
      }),
    ).rejects.toThrow(/must be in procurement/);
    let acceptedOpportunity = opportunity;
    for (const stage of [
      "qualified",
      "proposal",
      "verbal_commitment",
      "procurement",
    ] as const) {
      const transitionPreview = await store.transitionOpportunity({
        account_id: actor,
        opportunity: opportunity.id,
        stage,
        reason: `advance reviewed opportunity to ${stage}`,
      });
      if (!transitionPreview.preview) throw Error("expected preview");
      acceptedOpportunity = committed(
        await store.transitionOpportunity({
          account_id: actor,
          opportunity: opportunity.id,
          stage,
          reason: `advance reviewed opportunity to ${stage}`,
          commit: true,
          expected_version: transitionPreview.expected_version,
          idempotency_key: transitionPreview.idempotency_key,
        }),
      );
    }
    expect(acceptedOpportunity.stage).toBe("procurement");
    const orderPreview = await store.createOrderFromOpportunity({
      account_id: actor,
      opportunity: opportunity.id,
      billing_contact_person: person.id,
      collection_mode: "stripe_invoice",
      payment_terms_days: 30,
      next_action: "Obtain purchase order",
      next_action_due_at: "2026-09-02T17:00:00Z",
      reason: "review accepted opportunity order snapshot",
    });
    if (!orderPreview.preview) throw Error("expected preview");
    expect(orderPreview.proposed).toMatchObject({
      opportunity_id: opportunity.id,
      opportunity_stage: "procurement",
      resulting_opportunity_stage: "won",
      collection_mode: "stripe_invoice",
      payment_terms_days: 30,
      next_action: "Obtain purchase order",
      next_action_due_at: "2026-09-02T17:00:00.000Z",
      contacts: [
        {
          crm_person_id: person.id,
          name_snapshot: "Ada Procurement",
          email_snapshot: "ada@example.edu",
        },
      ],
    });
    const orderId = randomUUID();
    await pool.query(
      `INSERT INTO commercial_orders
         (id,order_number,organization_name,workflow_state,collection_state,fulfillment_state,currency,agreed_total,crm_organization_id)
       VALUES($1,'AR-2026-TEST','Customer 360 University','awaiting_payment','invoiced','not_provisioned','usd',3900,$2)`,
      [orderId, organization.id],
    );
    await pool.query(
      `INSERT INTO commercial_order_events
         (id,commercial_order_id,event_type,actor_account_id,reason)
       VALUES($1,$2,'invoice-sent',$3,'invoice sent after procurement review')`,
      [randomUUID(), orderId, actor],
    );
    await pool.query(
      `INSERT INTO commercial_payments
         (id,commercial_order_id,amount,status,received_at)
       VALUES($1,$2,1200,'succeeded','2026-08-24T12:00:00Z'),
             ($3,$2,500,'failed','2026-08-24T13:00:00Z')`,
      [randomUUID(), orderId, randomUUID()],
    );
    const metrics = await store.getCustomerMetrics({
      organization: organization.id,
      reason: "verify canonical payment metrics",
    });
    expect(metrics.commercial_spend_by_year).toEqual({ "2026": "1200" });
    const customer = await store.getOrganization({
      organization: organization.customer_number,
      reason: "review customer 360 fixture",
    });
    expect(customer.people.map(({ display_name }) => display_name)).toContain(
      "Ada Procurement",
    );
    expect(customer.opportunities.map(({ id }) => id)).toContain(
      opportunity.id,
    );
    expect(customer.tasks.map(({ subject }) => subject)).toContain(
      "Obtain purchase order",
    );
    expect(customer.activities.length).toBeGreaterThanOrEqual(4);
    expect(
      customer.activities.some(
        ({ source, summary }) =>
          source === "commercial_order" && summary === "Invoice Sent",
      ),
    ).toBe(true);
  });

  it("merges overlapping domains and people without duplicate-key failures", async () => {
    const sourceId = randomUUID();
    const destinationId = randomUUID();
    const personId = randomUUID();
    await pool.query(
      `INSERT INTO crm_organizations
         (id,customer_number,display_name,organization_type,lifecycle_stage,created_by_account_id,updated_by_account_id)
       VALUES
         ($1,'CRM-2026-900001','Merge Source','university','prospect',$3,$3),
         ($2,'CRM-2026-900002','Merge Destination','university','customer',$3,$3)`,
      [sourceId, destinationId, actor],
    );
    await pool.query(
      `INSERT INTO crm_people
         (id,display_name,created_by_account_id,updated_by_account_id)
       VALUES($1,'Shared Contact',$2,$2)`,
      [personId, actor],
    );
    await pool.query(
      `INSERT INTO crm_organization_people
         (id,organization_id,person_id,roles,title)
       VALUES
         ($1,$3,$5,ARRAY['billing'],'Billing contact'),
         ($2,$4,$5,ARRAY['decision_maker'],'Dean')`,
      [randomUUID(), randomUUID(), sourceId, destinationId, personId],
    );
    await pool.query(
      `INSERT INTO crm_organization_domains
         (id,organization_id,normalized_domain,display_domain,kind,state,generic_domain,created_by_account_id,updated_by_account_id)
       VALUES
         ($1,$3,'merge.example.edu','merge.example.edu','primary','verified',FALSE,$5,$5),
         ($2,$4,'merge.example.edu','merge.example.edu','secondary','suggested',FALSE,$5,$5)`,
      [randomUUID(), randomUUID(), sourceId, destinationId, actor],
    );
    const preview = await store.mergeOrganizations({
      account_id: actor,
      source_organization: sourceId,
      destination_organization: destinationId,
      reason: "reviewed duplicate institutional records",
    });
    if (!preview.preview) throw Error("expected preview");
    committed(
      await store.mergeOrganizations({
        account_id: actor,
        source_organization: sourceId,
        destination_organization: destinationId,
        reason: "reviewed duplicate institutional records",
        commit: true,
        expected_version: preview.expected_version,
        idempotency_key: preview.idempotency_key,
      }),
    );
    const source = await pool.query(
      "SELECT status,merged_into_organization_id FROM crm_organizations WHERE id=$1",
      [sourceId],
    );
    expect(source.rows[0]).toMatchObject({
      status: "merged",
      merged_into_organization_id: destinationId,
    });
    const domains = await pool.query(
      "SELECT state FROM crm_organization_domains WHERE organization_id=$1 AND normalized_domain='merge.example.edu'",
      [destinationId],
    );
    expect(domains.rows).toEqual([{ state: "verified" }]);
    const relationship = await pool.query(
      "SELECT roles FROM crm_organization_people WHERE organization_id=$1 AND person_id=$2",
      [destinationId, personId],
    );
    expect(relationship.rows[0].roles.sort()).toEqual([
      "billing",
      "decision_maker",
    ]);
  });

  it("backfills a reviewed business customer once and safely replays the batch", async () => {
    const orderId = randomUUID();
    const licenseId = randomUUID();
    const customerAccountId = randomUUID();
    const organizationName = `Backfill University ${randomUUID()}`;
    await pool.query(
      `INSERT INTO commercial_orders
         (id,order_number,organization_name,workflow_state,collection_state,fulfillment_state,currency,agreed_total,customer_account_id,zendesk_ticket_ids,stripe_customer_id)
       VALUES($1,$2,$3,'accepted','not_invoiced','not_provisioned','usd',2730,$4,ARRAY[30529],'cus_crm_backfill')`,
      [orderId, `AR-${randomUUID()}`, organizationName, customerAccountId],
    );
    await pool.query(
      `INSERT INTO site_licenses
         (id,name,organization_name,owner_account_id,allowed_domains)
       VALUES($1,$2,$2,$3,ARRAY['backfill.example.edu'])`,
      [licenseId, organizationName, customerAccountId],
    );
    const preview = await store.backfill({
      account_id: actor,
      reason: "review business-system customer candidates",
      limit: 20,
    });
    expect(preview.preview).toBe(true);
    const candidate = preview.candidates.find(
      ({ display_name }) => display_name === organizationName,
    );
    expect(candidate).toMatchObject({
      confidence: "high",
      account_ids: [customerAccountId],
      commercial_order_ids: [orderId],
      site_license_ids: [licenseId],
    });
    const request = {
      account_id: actor,
      reason: "apply reviewed business-system customer candidate",
      commit: true,
      expected_version: 0,
      idempotency_key: `backfill-${randomUUID()}`,
      candidate_keys: [candidate!.candidate_key],
      limit: 20,
    };
    const committed = await store.backfill(request);
    expect(committed.preview).toBe(false);
    expect(committed.replayed).toBe(false);
    expect(committed.created).toHaveLength(1);
    expect(committed.skipped).toEqual([]);
    const organizationId = committed.created[0].id;
    const linked = await pool.query(
      `SELECT
         (SELECT crm_organization_id FROM commercial_orders WHERE id=$1) order_organization_id,
         (SELECT crm_organization_id FROM site_licenses WHERE id=$2) license_organization_id`,
      [orderId, licenseId],
    );
    expect(linked.rows[0]).toEqual({
      order_organization_id: organizationId,
      license_organization_id: organizationId,
    });
    const replay = await store.backfill(request);
    expect(replay.replayed).toBe(true);
    expect(replay.audit_id).toBe(committed.audit_id);
    const count = await pool.query(
      "SELECT count(*)::integer count FROM crm_organizations WHERE display_name=$1",
      [organizationName],
    );
    expect(count.rows[0].count).toBe(1);
  });

  it("builds a deterministic bounded daily work digest", async () => {
    const organizationId = randomUUID();
    await pool.query(
      `INSERT INTO crm_organizations
         (id,customer_number,display_name,organization_type,lifecycle_stage,
          created_by_account_id,updated_by_account_id)
       VALUES($1,$2,'Digest University','university','renewal',$3,$3)`,
      [organizationId, `CRM-DIGEST-${randomUUID().slice(0, 20)}`, actor],
    );
    await pool.query(
      `INSERT INTO crm_tasks
         (id,organization_id,type,assignee_account_id,due_at,priority,subject,
          created_by_account_id,updated_by_account_id)
       VALUES
         ($1,$3,'payment_follow_up',$4,'2026-08-23T09:00:00Z','urgent','Overdue payment',$4,$4),
         ($2,$3,'renewal',$4,'2026-08-25T08:00:00Z','high','Prepare renewal',$4,$4)`,
      [randomUUID(), randomUUID(), organizationId, actor],
    );
    await pool.query(
      `INSERT INTO crm_opportunities
         (id,organization_id,name,kind,stage,owner_account_id,expected_value,
          currency,expected_close_date,created_by_account_id,updated_by_account_id)
       VALUES
         ($1,$3,'Annual renewal','renewal','proposal',$4,12000,'usd','2026-09-15',$4,$4),
         ($2,$3,'Campus expansion','expansion','qualified',$4,18000,'usd','2026-10-01',$4,$4)`,
      [randomUUID(), randomUUID(), organizationId, actor],
    );
    await pool.query(
      `INSERT INTO commercial_orders
         (id,order_number,organization_name,workflow_state,collection_state,
          fulfillment_state,currency,agreed_total,assignee_account_id,next_action,
          next_action_due_at,crm_organization_id)
       VALUES($1,$2,'Digest University','awaiting_payment','open','provisioned',
              'usd',12000,$3,'Collect payment','2026-08-23T12:00:00Z',$4)`,
      [randomUUID(), `AR-DIGEST-${randomUUID()}`, actor, organizationId],
    );

    const digest = await store.getDailyDigest({
      reason: "review deterministic daily work",
      as_of: "2026-08-24T12:00:00Z",
      due_within_days: 1,
      renewal_within_days: 90,
      assignee_account_id: actor,
      limit: 10,
    });
    expect(digest.as_of).toBe("2026-08-24T12:00:00.000Z");
    expect(digest.overdue_tasks[0]).toMatchObject({
      task: { subject: "Overdue payment" },
      organization: { display_name: "Digest University" },
    });
    expect(digest.due_soon_tasks[0]?.task.subject).toBe("Prepare renewal");
    expect(digest.overdue_commercial_actions[0]).toMatchObject({
      next_action: "Collect payment",
      crm_organization_name: "Digest University",
    });
    expect(digest.renewal_opportunities[0]?.opportunity.name).toBe(
      "Annual renewal",
    );
    expect(digest.expansion_opportunities[0]?.opportunity.name).toBe(
      "Campus expansion",
    );
    expect(digest.truncated).toBe(false);
  });
});
