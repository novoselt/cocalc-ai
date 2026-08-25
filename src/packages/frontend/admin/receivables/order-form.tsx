/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Divider,
  Flex,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  Typography,
  type FormInstance,
  type TableColumnsType,
} from "antd";
import type { ReactNode } from "react";

import type {
  CommercialOrderCreateRequest,
  CommercialOrderUpdateRequest,
} from "@cocalc/conat/hub/api/commercial-orders";
import {
  COMMERCIAL_COLLECTION_MODES,
  COMMERCIAL_CONTACT_ROLES,
  COMMERCIAL_NEXT_ACTIONS,
  type CommercialCollectionMode,
  type CommercialContactRole,
  type CommercialNextAction,
  type CommercialOrder,
  type CommercialSiteLicensePlan,
  type CommercialWorkflowState,
} from "@cocalc/util/commercial-orders";
import { formatDate, formatMoney, humanizeKey } from "./shared";
import {
  SiteLicenseReference,
  SiteLicenseSelector,
} from "./site-license-reference";
import { AccountSelector } from "./account-selector";
import { AccountIdentity, useAccountDisplayNames } from "./account-names";
import { CustomerSelector, PersonSelector } from "../customers/selector";

const { Paragraph, Text, Title } = Typography;

interface CommercialItemFormValue {
  id?: string;
  description: string;
  quantity: string;
  unit_amount: string;
  subtotal: string;
  product_kind: string;
  product_reference?: string;
  service_start?: string;
  service_end?: string;
}

interface CommercialContactFormValue {
  id?: string;
  crm_person_id?: string;
  role: CommercialContactRole;
  name_snapshot: string;
  email_snapshot: string;
  organization_snapshot?: string;
}

interface CommercialPoolFormValue {
  membership_class: string;
  seat_limit: number;
  label?: string;
}

export interface CommercialOrderFormValues {
  organization_name: string;
  crm_organization_id?: string;
  customer_account_id?: string;
  stripe_customer_id?: string;
  site_license_id?: string;
  zendesk_ticket_ids?: string;
  workflow_state: "draft" | "awaiting_customer";
  collection_mode: CommercialCollectionMode;
  agreed_subtotal: string;
  agreed_total: string;
  service_starts_at?: string;
  service_ends_at?: string;
  payment_terms_days?: number;
  po_number?: string;
  customer_reference?: string;
  invoice_memo?: string;
  billing_address_line1?: string;
  billing_address_line2?: string;
  billing_address_city?: string;
  billing_address_state?: string;
  billing_address_postal_code?: string;
  billing_address_country?: string;
  assignee_account_id?: string;
  next_action: CommercialNextAction;
  next_action_due_at?: string;
  fulfillment_required: boolean;
  include_site_license_plan: boolean;
  site_license_name?: string;
  site_license_organization_name?: string;
  site_license_owner_account_id?: string;
  site_license_manager_account_ids?: string;
  site_license_allowed_domains?: string;
  site_license_starts_at?: string;
  site_license_expires_at?: string;
  site_license_custom_terms_url?: string;
  site_license_custom_policy_url?: string;
  site_license_terms_version_label?: string;
  site_license_renewal_policy?: string;
  site_license_overage_policy?: string;
  items: CommercialItemFormValue[];
  contacts: CommercialContactFormValue[];
  pools: CommercialPoolFormValue[];
  reason: string;
}

export type PreparedCommercialOrder = Omit<
  CommercialOrderCreateRequest,
  | "account_id"
  | "browser_id"
  | "session_hash"
  | "reason"
  | "source"
  | "idempotency_key"
  | "expected_version"
> &
  Required<
    Pick<
      CommercialOrderCreateRequest,
      | "agreed_total"
      | "collection_mode"
      | "currency"
      | "terms_snapshot"
      | "workflow_state"
    >
  >;

const moneyRule = {
  pattern: /^(?:0|[1-9]\d*)(?:\.\d{1,10})?$/,
  message: "Enter a nonnegative decimal amount without a currency symbol",
};

const optionalUuidRule = {
  pattern:
    /^$|^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  message: "Enter a UUID or leave this field blank",
};

function splitValues(value?: string): string[] {
  return [
    ...new Set(
      `${value ?? ""}`
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

function parseZendeskTicketIds(value?: string): number[] {
  const entries = splitValues(value);
  const ids = entries.map(Number);
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw Error("Zendesk ticket IDs must be positive integers");
  }
  return [...new Set(ids)];
}

function optional(value?: string): string | undefined {
  return `${value ?? ""}`.trim() || undefined;
}

function optionalIso(value?: string): string | undefined {
  const normalized = optional(value);
  if (!normalized) return undefined;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) throw Error(`Invalid date: ${value}`);
  return date.toISOString();
}

function requiredIso(value: string | undefined, label: string): string {
  const normalized = optionalIso(value);
  if (!normalized) throw Error(`${label} is required`);
  return normalized;
}

function localDate(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function localDateTime(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16) : "";
}

function getSiteLicensePlan(
  termsSnapshot: Record<string, unknown>,
): CommercialSiteLicensePlan | undefined {
  const value = termsSnapshot.site_license;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as CommercialSiteLicensePlan)
    : undefined;
}

function getInvoiceTerms(termsSnapshot: Record<string, unknown>): {
  memo?: string;
  billing_address?: Record<string, string>;
} {
  const value = termsSnapshot.invoice;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as {
        memo?: string;
        billing_address?: Record<string, string>;
      })
    : {};
}

export function prepareCommercialOrder(
  values: CommercialOrderFormValues,
): PreparedCommercialOrder {
  const organizationName = values.organization_name.trim();
  const items = values.items.map((item, position) => ({
    id: item.id,
    position,
    description: item.description.trim(),
    quantity: item.quantity.trim(),
    unit_amount: item.unit_amount.trim(),
    subtotal: item.subtotal.trim(),
    product_kind: item.product_kind.trim(),
    product_reference: optional(item.product_reference),
    service_start: optionalIso(item.service_start),
    service_end: optionalIso(item.service_end),
    metadata: {},
  }));
  const contacts = values.contacts.map((contact) => ({
    id: contact.id,
    ...(contact.crm_person_id ? { crm_person_id: contact.crm_person_id } : {}),
    role: contact.role,
    name_snapshot: contact.name_snapshot.trim(),
    email_snapshot: contact.email_snapshot.trim().toLowerCase(),
    organization_snapshot: optional(contact.organization_snapshot),
  }));
  const termsSnapshot: Record<string, unknown> = {
    fulfillment_required: values.fulfillment_required,
  };
  const billingAddress = Object.fromEntries(
    [
      ["line1", optional(values.billing_address_line1)],
      ["line2", optional(values.billing_address_line2)],
      ["city", optional(values.billing_address_city)],
      ["state", optional(values.billing_address_state)],
      ["postal_code", optional(values.billing_address_postal_code)],
      ["country", optional(values.billing_address_country)?.toUpperCase()],
    ].filter((entry): entry is [string, string] => entry[1] != null),
  );
  if (optional(values.invoice_memo) || Object.keys(billingAddress).length) {
    termsSnapshot.invoice = {
      memo: optional(values.invoice_memo),
      billing_address: billingAddress,
    };
  }
  if (values.include_site_license_plan) {
    termsSnapshot.site_license = {
      name: `${values.site_license_name ?? ""}`.trim(),
      organization_name:
        optional(values.site_license_organization_name) ?? organizationName,
      owner_account_id: `${values.site_license_owner_account_id ?? ""}`.trim(),
      manager_account_ids: splitValues(values.site_license_manager_account_ids),
      allowed_domains: splitValues(values.site_license_allowed_domains).map(
        (domain) => domain.toLowerCase(),
      ),
      pools: values.pools.map((pool) => ({
        membership_class: pool.membership_class.trim(),
        seat_limit: Number(pool.seat_limit),
        label: optional(pool.label),
      })),
      starts_at: requiredIso(
        values.site_license_starts_at,
        "Site license start date",
      ),
      expires_at: requiredIso(
        values.site_license_expires_at,
        "Site license expiration date",
      ),
      custom_terms_url: optional(values.site_license_custom_terms_url),
      custom_policy_url: optional(values.site_license_custom_policy_url),
      terms_version_label: optional(values.site_license_terms_version_label),
      renewal_policy: optional(values.site_license_renewal_policy),
      overage_policy: optional(values.site_license_overage_policy),
      metadata: {},
    } satisfies CommercialSiteLicensePlan;
  }
  return {
    organization_name: organizationName,
    crm_organization_id: values.crm_organization_id,
    customer_account_id: optional(values.customer_account_id),
    stripe_customer_id: optional(values.stripe_customer_id),
    site_license_id: optional(values.site_license_id),
    zendesk_ticket_ids: parseZendeskTicketIds(values.zendesk_ticket_ids),
    workflow_state: values.workflow_state,
    collection_mode: values.collection_mode,
    currency: "usd",
    agreed_subtotal: values.agreed_subtotal.trim(),
    agreed_total: values.agreed_total.trim(),
    service_starts_at: optionalIso(values.service_starts_at),
    service_ends_at: optionalIso(values.service_ends_at),
    payment_terms_days: values.payment_terms_days,
    po_number: optional(values.po_number),
    customer_reference: optional(values.customer_reference),
    terms_snapshot: termsSnapshot,
    assignee_account_id: optional(values.assignee_account_id),
    next_action: values.next_action,
    next_action_due_at: optionalIso(values.next_action_due_at),
    items,
    contacts,
  };
}

export function prepareCommercialRevision(
  values: CommercialOrderFormValues,
): Pick<CommercialOrderUpdateRequest, "changes" | "items" | "contacts"> {
  const prepared = prepareCommercialOrder(values);
  return {
    changes: {
      organization_name: prepared.organization_name,
      crm_organization_id: prepared.crm_organization_id ?? null,
      customer_account_id: prepared.customer_account_id ?? null,
      stripe_customer_id: prepared.stripe_customer_id ?? null,
      site_license_id: prepared.site_license_id ?? null,
      zendesk_ticket_ids: prepared.zendesk_ticket_ids,
      collection_mode: prepared.collection_mode,
      currency: prepared.currency,
      agreed_subtotal: prepared.agreed_subtotal,
      agreed_total: prepared.agreed_total,
      service_starts_at: prepared.service_starts_at ?? null,
      service_ends_at: prepared.service_ends_at ?? null,
      payment_terms_days: prepared.payment_terms_days ?? null,
      po_number: prepared.po_number ?? null,
      customer_reference: prepared.customer_reference ?? null,
      terms_snapshot: prepared.terms_snapshot,
      assignee_account_id: prepared.assignee_account_id ?? null,
      next_action: prepared.next_action,
      next_action_due_at: prepared.next_action_due_at ?? null,
    },
    items: prepared.items,
    contacts: prepared.contacts,
  };
}

export function commercialOrderInitialValues(
  order?: CommercialOrder,
): CommercialOrderFormValues {
  const plan = order ? getSiteLicensePlan(order.terms_snapshot) : undefined;
  const invoice = order ? getInvoiceTerms(order.terms_snapshot) : {};
  return {
    organization_name: order?.organization_name ?? "",
    crm_organization_id: order?.crm_organization_id ?? undefined,
    customer_account_id: order?.customer_account_id ?? "",
    stripe_customer_id: order?.stripe_customer_id ?? "",
    site_license_id: order?.site_license_id ?? "",
    zendesk_ticket_ids: order?.zendesk_ticket_ids.join(", ") ?? "",
    workflow_state:
      order?.workflow_state === "awaiting_customer"
        ? "awaiting_customer"
        : "draft",
    collection_mode: order?.collection_mode ?? "stripe_invoice",
    agreed_subtotal: order?.agreed_subtotal ?? "",
    agreed_total: order?.agreed_total ?? "",
    service_starts_at: localDate(order?.service_starts_at),
    service_ends_at: localDate(order?.service_ends_at),
    payment_terms_days: order?.payment_terms_days ?? 21,
    po_number: order?.po_number ?? "",
    customer_reference: order?.customer_reference ?? "",
    invoice_memo: invoice.memo ?? "",
    billing_address_line1: invoice.billing_address?.line1 ?? "",
    billing_address_line2: invoice.billing_address?.line2 ?? "",
    billing_address_city: invoice.billing_address?.city ?? "",
    billing_address_state: invoice.billing_address?.state ?? "",
    billing_address_postal_code: invoice.billing_address?.postal_code ?? "",
    billing_address_country: invoice.billing_address?.country ?? "",
    assignee_account_id: order?.assignee_account_id ?? "",
    next_action: order?.next_action ?? "Review agreement",
    next_action_due_at: localDateTime(order?.next_action_due_at),
    fulfillment_required: order?.terms_snapshot.fulfillment_required !== false,
    include_site_license_plan: plan != null,
    site_license_name: plan?.name ?? "",
    site_license_organization_name: plan?.organization_name ?? "",
    site_license_owner_account_id: plan?.owner_account_id ?? "",
    site_license_manager_account_ids:
      plan?.manager_account_ids?.join(", ") ?? "",
    site_license_allowed_domains: plan?.allowed_domains.join(", ") ?? "",
    site_license_starts_at: localDate(plan?.starts_at),
    site_license_expires_at: localDate(plan?.expires_at),
    site_license_custom_terms_url: plan?.custom_terms_url ?? "",
    site_license_custom_policy_url: plan?.custom_policy_url ?? "",
    site_license_terms_version_label: plan?.terms_version_label ?? "",
    site_license_renewal_policy: plan?.renewal_policy ?? "",
    site_license_overage_policy: plan?.overage_policy ?? "",
    items: order?.items.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unit_amount: item.unit_amount,
      subtotal: item.subtotal,
      product_kind: item.product_kind,
      product_reference: item.product_reference ?? "",
      service_start: localDate(item.service_start),
      service_end: localDate(item.service_end),
    })) ?? [
      {
        description: "Campus adoption pilot",
        quantity: "1",
        unit_amount: "",
        subtotal: "",
        product_kind: "site_license",
      },
    ],
    contacts: order?.contacts.map((contact) => ({
      id: contact.id,
      crm_person_id: contact.crm_person_id ?? undefined,
      role: contact.role,
      name_snapshot: contact.name_snapshot,
      email_snapshot: contact.email_snapshot,
      organization_snapshot: contact.organization_snapshot ?? "",
    })) ?? [
      {
        role: "billing",
        name_snapshot: "",
        email_snapshot: "",
      },
    ],
    pools: plan?.pools.map((pool) => ({ ...pool })) ?? [
      { membership_class: "student", seat_limit: 1, label: "Students" },
      { membership_class: "instructor", seat_limit: 1, label: "Instructors" },
    ],
    reason: "",
  };
}

function FormGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gap: "0 16px",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
      }}
    >
      {children}
    </div>
  );
}

export function CommercialOrderForm({
  form,
  mode,
  onPreview,
  reviewedSiteLicenseId,
  siteLicenseTargetLocked = false,
}: {
  form: FormInstance<CommercialOrderFormValues>;
  mode: "create" | "update" | "revise";
  onPreview: (values: CommercialOrderFormValues) => void;
  reviewedSiteLicenseId?: string | null;
  siteLicenseTargetLocked?: boolean;
}) {
  const includeSiteLicensePlan = Form.useWatch(
    "include_site_license_plan",
    form,
  );
  const crmOrganizationId = Form.useWatch("crm_organization_id", form);
  return (
    <Form
      form={form}
      initialValues={commercialOrderInitialValues()}
      layout="vertical"
      onFinish={onPreview}
      scrollToFirstError={{ behavior: "smooth", block: "center" }}
    >
      {mode === "revise" ? (
        <Alert
          showIcon
          type="warning"
          title="Revision requires a new review"
          description="Review every commercial term below. The server records the before/after agreement and requires fresh authentication. Approved orders must be approved again after a financial or fulfillment revision."
          style={{ marginBottom: 16 }}
        />
      ) : mode === "update" ? (
        <Alert
          showIcon
          type="info"
          title="Update the unapproved draft"
          description="Review every commercial term below. The order remains unapproved after this update, and the server records the before/after agreement with fresh authentication."
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Card title="Customer and source records" size="small">
        <FormGrid>
          <Form.Item
            label="Organization name"
            name="organization_name"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input autoComplete="organization" />
          </Form.Item>
          <Form.Item label="Customer record" name="crm_organization_id">
            <CustomerSelector />
          </Form.Item>
          <Form.Item
            label="Customer CoCalc account"
            name="customer_account_id"
            rules={[optionalUuidRule]}
          >
            <AccountSelector accountKind="customer" />
          </Form.Item>
          <Form.Item label="Stripe customer ID" name="stripe_customer_id">
            <Input placeholder="cus_..., if already reviewed" />
          </Form.Item>
          {siteLicenseTargetLocked ? (
            <div style={{ marginBottom: 24 }}>
              <Text strong>Reviewed site license target</Text>
              <br />
              <SiteLicenseReference
                emptyLabel="Create a new site license"
                siteLicenseId={reviewedSiteLicenseId}
              />
              <br />
              <Text type="secondary">
                The target cannot be changed after approval. Revise it only
                after voiding any invoice; the revised agreement requires
                approval again.
              </Text>
            </div>
          ) : (
            <Form.Item
              label="Existing site license"
              name="site_license_id"
              rules={[optionalUuidRule]}
              extra="Set this before approval when fulfillment must update an existing license."
            >
              <SiteLicenseSelector />
            </Form.Item>
          )}
          <Form.Item
            label="Zendesk ticket IDs"
            name="zendesk_ticket_ids"
            extra="Comma-separated positive ticket numbers."
            rules={[
              {
                validator: async (_, value) => {
                  parseZendeskTicketIds(value);
                },
              },
            ]}
          >
            <Input placeholder="20529, 20102" inputMode="numeric" />
          </Form.Item>
        </FormGrid>
      </Card>

      <Card title="Agreement and collection" size="small">
        <FormGrid>
          <Form.Item
            label="Initial workflow state"
            name="workflow_state"
            rules={[{ required: true }]}
          >
            <Select
              disabled={mode === "revise"}
              options={[
                { value: "draft", label: "Draft" },
                { value: "awaiting_customer", label: "Awaiting customer" },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="Collection mode"
            name="collection_mode"
            rules={[{ required: true }]}
          >
            <Select
              options={COMMERCIAL_COLLECTION_MODES.map((value) => ({
                value,
                label: humanizeKey(value),
              }))}
            />
          </Form.Item>
          <Form.Item label="Currency">
            <Input value="USD" disabled aria-label="Currency: USD only" />
          </Form.Item>
          <Form.Item
            label="Agreed subtotal (USD)"
            name="agreed_subtotal"
            rules={[{ required: true, whitespace: true }, moneyRule]}
          >
            <Input inputMode="decimal" placeholder="3900.00" />
          </Form.Item>
          <Form.Item
            label="Agreed total (USD)"
            name="agreed_total"
            dependencies={["agreed_subtotal"]}
            rules={[
              { required: true, whitespace: true },
              moneyRule,
              ({ getFieldValue }) => ({
                validator: async (_, value) => {
                  if (
                    value &&
                    Number(value) < Number(getFieldValue("agreed_subtotal"))
                  ) {
                    throw Error("Agreed total cannot be less than subtotal");
                  }
                },
              }),
            ]}
          >
            <Input inputMode="decimal" placeholder="3900.00" />
          </Form.Item>
          <Form.Item
            label="Payment terms (days)"
            name="payment_terms_days"
            rules={[{ required: true }]}
          >
            <InputNumber
              min={0}
              max={365}
              precision={0}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item label="Service starts" name="service_starts_at">
            <Input type="date" />
          </Form.Item>
          <Form.Item label="Service ends" name="service_ends_at">
            <Input type="date" />
          </Form.Item>
          <Form.Item label="PO number" name="po_number">
            <Input />
          </Form.Item>
          <Form.Item label="Customer reference" name="customer_reference">
            <Input />
          </Form.Item>
        </FormGrid>
      </Card>

      <Card title="Invoice delivery" size="small">
        <Paragraph>
          Store only the reviewed billing address and customer-visible invoice
          memo. Payment credentials must never be entered here.
        </Paragraph>
        <FormGrid>
          <Form.Item label="Invoice memo" name="invoice_memo">
            <Input.TextArea rows={2} maxLength={1000} />
          </Form.Item>
          <Form.Item
            label="Billing address line 1"
            name="billing_address_line1"
          >
            <Input autoComplete="address-line1" />
          </Form.Item>
          <Form.Item
            label="Billing address line 2"
            name="billing_address_line2"
          >
            <Input autoComplete="address-line2" />
          </Form.Item>
          <Form.Item label="Billing city" name="billing_address_city">
            <Input autoComplete="address-level2" />
          </Form.Item>
          <Form.Item
            label="Billing state / region"
            name="billing_address_state"
          >
            <Input autoComplete="address-level1" />
          </Form.Item>
          <Form.Item
            label="Billing postal code"
            name="billing_address_postal_code"
          >
            <Input autoComplete="postal-code" />
          </Form.Item>
          <Form.Item
            label="Billing country code"
            name="billing_address_country"
            rules={[
              {
                pattern: /^$|^[A-Za-z]{2}$/,
                message: "Use a two-letter ISO country code",
              },
            ]}
          >
            <Input autoComplete="country" maxLength={2} placeholder="US" />
          </Form.Item>
        </FormGrid>
      </Card>

      <Card title="Ownership and next action" size="small">
        <FormGrid>
          <Form.Item
            label="Assignee"
            name="assignee_account_id"
            rules={[optionalUuidRule]}
          >
            <AccountSelector accountKind="admin" />
          </Form.Item>
          <Form.Item
            label="Next action"
            name="next_action"
            rules={[{ required: true, whitespace: true }]}
          >
            <Select
              options={COMMERCIAL_NEXT_ACTIONS.filter(
                (value) => !["Complete", "Cancelled"].includes(value),
              ).map((value) => ({ label: value, value }))}
              placeholder="Select the next operational task"
            />
          </Form.Item>
          <Text type="secondary">
            Put customer-specific context in an audited internal note; this
            field is intentionally a standard queue task.
          </Text>
          <Form.Item label="Next action due" name="next_action_due_at">
            <Input type="datetime-local" />
          </Form.Item>
        </FormGrid>
      </Card>

      <Card title="Line items" size="small">
        <Paragraph>
          The line-item subtotals must add up exactly to the agreed subtotal.
        </Paragraph>
        <Form.List
          name="items"
          rules={[
            {
              validator: async (_, items) => {
                if (!items?.length) throw Error("Add at least one line item");
              },
            },
          ]}
        >
          {(fields, { add, remove }, { errors }) => (
            <Flex vertical gap="middle">
              {fields.map((field, index) => (
                <Card
                  key={field.key}
                  type="inner"
                  size="small"
                  title={`Line item ${index + 1}`}
                >
                  <FormGrid>
                    <Form.Item
                      label="CRM contact"
                      name={[field.name, "crm_person_id"]}
                      extra="Optional reviewed identity; name and email below remain immutable order snapshots."
                    >
                      <PersonSelector
                        organization={crmOrganizationId}
                        onSelectPerson={(person) => {
                          if (!person) return;
                          const primaryEmail =
                            person.emails.find(({ is_primary }) => is_primary)
                              ?.email_address ??
                            person.emails[0]?.email_address;
                          form.setFieldValue(
                            ["contacts", field.name, "name_snapshot"],
                            person.display_name,
                          );
                          if (primaryEmail)
                            form.setFieldValue(
                              ["contacts", field.name, "email_snapshot"],
                              primaryEmail,
                            );
                          const organizationName =
                            form.getFieldValue("organization_name");
                          if (organizationName)
                            form.setFieldValue(
                              ["contacts", field.name, "organization_snapshot"],
                              organizationName,
                            );
                        }}
                      />
                    </Form.Item>
                    <Form.Item
                      label="Description"
                      name={[field.name, "description"]}
                      rules={[{ required: true, whitespace: true }]}
                    >
                      <Input />
                    </Form.Item>
                    <Form.Item
                      label="Product kind"
                      name={[field.name, "product_kind"]}
                      rules={[{ required: true, whitespace: true }]}
                    >
                      <Input placeholder="site_license" />
                    </Form.Item>
                    <Form.Item
                      label="Quantity"
                      name={[field.name, "quantity"]}
                      rules={[{ required: true, whitespace: true }, moneyRule]}
                    >
                      <Input inputMode="decimal" />
                    </Form.Item>
                    <Form.Item
                      label="Unit amount (USD)"
                      name={[field.name, "unit_amount"]}
                      rules={[{ required: true, whitespace: true }, moneyRule]}
                    >
                      <Input inputMode="decimal" />
                    </Form.Item>
                    <Form.Item
                      label="Subtotal (USD)"
                      name={[field.name, "subtotal"]}
                      rules={[{ required: true, whitespace: true }, moneyRule]}
                    >
                      <Input inputMode="decimal" />
                    </Form.Item>
                    <Form.Item
                      label="Product reference"
                      name={[field.name, "product_reference"]}
                    >
                      <Input />
                    </Form.Item>
                    <Form.Item
                      label="Item service starts"
                      name={[field.name, "service_start"]}
                    >
                      <Input type="date" />
                    </Form.Item>
                    <Form.Item
                      label="Item service ends"
                      name={[field.name, "service_end"]}
                    >
                      <Input type="date" />
                    </Form.Item>
                  </FormGrid>
                  <Button
                    danger
                    disabled={fields.length === 1}
                    onClick={() => remove(field.name)}
                  >
                    Remove line item {index + 1}
                  </Button>
                </Card>
              ))}
              <Form.ErrorList errors={errors} />
              <Button
                onClick={() =>
                  add({
                    description: "",
                    quantity: "1",
                    unit_amount: "",
                    subtotal: "",
                    product_kind: "site_license",
                  })
                }
              >
                Add line item
              </Button>
            </Flex>
          )}
        </Form.List>
      </Card>

      <Card title="Contacts and invoice recipients" size="small">
        <Form.List
          name="contacts"
          rules={[
            {
              validator: async (_, contacts) => {
                if (!contacts?.length) throw Error("Add at least one contact");
              },
            },
          ]}
        >
          {(fields, { add, remove }, { errors }) => (
            <Flex vertical gap="middle">
              {fields.map((field, index) => (
                <Card
                  key={field.key}
                  type="inner"
                  size="small"
                  title={`Contact ${index + 1}`}
                >
                  <FormGrid>
                    <Form.Item
                      label="Role"
                      name={[field.name, "role"]}
                      rules={[{ required: true }]}
                    >
                      <Select
                        options={COMMERCIAL_CONTACT_ROLES.map((value) => ({
                          value,
                          label: humanizeKey(value),
                        }))}
                      />
                    </Form.Item>
                    <Form.Item
                      label="Name"
                      name={[field.name, "name_snapshot"]}
                      rules={[{ required: true, whitespace: true }]}
                    >
                      <Input autoComplete="name" />
                    </Form.Item>
                    <Form.Item
                      label="Email"
                      name={[field.name, "email_snapshot"]}
                      rules={[{ required: true, type: "email" }]}
                    >
                      <Input type="email" autoComplete="email" />
                    </Form.Item>
                    <Form.Item
                      label="Contact organization"
                      name={[field.name, "organization_snapshot"]}
                    >
                      <Input autoComplete="organization" />
                    </Form.Item>
                  </FormGrid>
                  <Button
                    danger
                    disabled={fields.length === 1}
                    onClick={() => remove(field.name)}
                  >
                    Remove contact {index + 1}
                  </Button>
                </Card>
              ))}
              <Form.ErrorList errors={errors} />
              <Button
                onClick={() =>
                  add({
                    role: "billing",
                    name_snapshot: "",
                    email_snapshot: "",
                  })
                }
              >
                Add contact
              </Button>
            </Flex>
          )}
        </Form.List>
      </Card>

      <Card title="Fulfillment terms" size="small">
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          <Form.Item
            name="fulfillment_required"
            valuePropName="checked"
            noStyle
          >
            <Checkbox>Fulfillment is required for this order</Checkbox>
          </Form.Item>
          <Form.Item
            name="include_site_license_plan"
            valuePropName="checked"
            noStyle
          >
            <Checkbox>Include an approved site-license plan</Checkbox>
          </Form.Item>
          {includeSiteLicensePlan ? (
            <>
              <Alert
                showIcon
                type="info"
                title="This plan is authoritative"
                description="Provisioning will create or reconcile exactly this license, including domains, managers, term, and pools. Set an existing license ID in Customer and source records before approval when linking an existing license."
              />
              <FormGrid>
                <Form.Item
                  label="Site license name"
                  name="site_license_name"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input />
                </Form.Item>
                <Form.Item
                  label="Site license organization"
                  name="site_license_organization_name"
                  extra="Defaults to the commercial order organization."
                >
                  <Input />
                </Form.Item>
                <Form.Item
                  label="Owner account ID"
                  name="site_license_owner_account_id"
                  rules={[
                    { required: true, whitespace: true },
                    optionalUuidRule,
                  ]}
                >
                  <Input />
                </Form.Item>
                <Form.Item
                  label="Manager account IDs"
                  name="site_license_manager_account_ids"
                  extra="Comma-separated CoCalc account UUIDs."
                >
                  <Input.TextArea rows={2} />
                </Form.Item>
                <Form.Item
                  label="Allowed email domains"
                  name="site_license_allowed_domains"
                  extra="Comma-separated domains without @."
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input.TextArea rows={2} placeholder="example.edu" />
                </Form.Item>
                <Form.Item
                  label="License starts"
                  name="site_license_starts_at"
                  rules={[{ required: true }]}
                >
                  <Input type="date" />
                </Form.Item>
                <Form.Item
                  label="License expires"
                  name="site_license_expires_at"
                  rules={[{ required: true }]}
                >
                  <Input type="date" />
                </Form.Item>
                <Form.Item
                  label="Custom terms URL"
                  name="site_license_custom_terms_url"
                  rules={[{ type: "url", warningOnly: true }]}
                >
                  <Input type="url" />
                </Form.Item>
                <Form.Item
                  label="Custom policy URL"
                  name="site_license_custom_policy_url"
                  rules={[{ type: "url", warningOnly: true }]}
                >
                  <Input type="url" />
                </Form.Item>
                <Form.Item
                  label="Terms version label"
                  name="site_license_terms_version_label"
                >
                  <Input />
                </Form.Item>
                <Form.Item
                  label="Renewal policy"
                  name="site_license_renewal_policy"
                >
                  <Input.TextArea rows={2} />
                </Form.Item>
                <Form.Item
                  label="Overage policy"
                  name="site_license_overage_policy"
                >
                  <Input.TextArea rows={2} />
                </Form.Item>
              </FormGrid>
              <Divider titlePlacement="start">Membership pools</Divider>
              <Form.List
                name="pools"
                rules={[
                  {
                    validator: async (_, pools) => {
                      if (!pools?.length) {
                        throw Error("Add at least one site-license pool");
                      }
                    },
                  },
                ]}
              >
                {(fields, { add, remove }, { errors }) => (
                  <Flex vertical gap="middle">
                    {fields.map((field, index) => (
                      <Card
                        key={field.key}
                        type="inner"
                        size="small"
                        title={`Pool ${index + 1}`}
                      >
                        <FormGrid>
                          <Form.Item
                            label="Membership class"
                            name={[field.name, "membership_class"]}
                            rules={[{ required: true, whitespace: true }]}
                          >
                            <Input placeholder="student" />
                          </Form.Item>
                          <Form.Item
                            label="Seat limit"
                            name={[field.name, "seat_limit"]}
                            rules={[{ required: true }]}
                          >
                            <InputNumber
                              min={1}
                              precision={0}
                              style={{ width: "100%" }}
                            />
                          </Form.Item>
                          <Form.Item
                            label="Pool label"
                            name={[field.name, "label"]}
                          >
                            <Input />
                          </Form.Item>
                        </FormGrid>
                        <Button
                          danger
                          disabled={fields.length === 1}
                          onClick={() => remove(field.name)}
                        >
                          Remove pool {index + 1}
                        </Button>
                      </Card>
                    ))}
                    <Form.ErrorList errors={errors} />
                    <Button
                      onClick={() =>
                        add({
                          membership_class: "student",
                          seat_limit: 1,
                          label: "",
                        })
                      }
                    >
                      Add membership pool
                    </Button>
                  </Flex>
                )}
              </Form.List>
            </>
          ) : null}
        </Space>
      </Card>

      <Card title="Audit" size="small">
        <Form.Item
          label="Audit reason"
          name="reason"
          extra="Explain the reviewed offer, source records, and why this order is being created or revised."
          rules={[{ required: true, min: 4, whitespace: true }]}
        >
          <Input.TextArea rows={3} maxLength={2000} />
        </Form.Item>
      </Card>

      <Button type="primary" htmlType="submit" size="large">
        Review{" "}
        {mode === "create"
          ? "new order"
          : mode === "update"
            ? "draft update"
            : "revision"}
      </Button>
    </Form>
  );
}

export function CommercialOrderRequestPreview({
  prepared,
  reason,
}: {
  prepared: PreparedCommercialOrder;
  reason: string;
}) {
  const plan = getSiteLicensePlan(prepared.terms_snapshot);
  const invoiceTerms = getInvoiceTerms(prepared.terms_snapshot);
  const accountNames = useAccountDisplayNames([
    prepared.assignee_account_id,
    prepared.customer_account_id,
  ]);
  const itemColumns: TableColumnsType<(typeof prepared.items)[number]> = [
    { title: "Description", dataIndex: "description" },
    { title: "Quantity", dataIndex: "quantity" },
    {
      title: "Unit amount",
      dataIndex: "unit_amount",
      render: (value) => formatMoney(value, "usd"),
    },
    {
      title: "Subtotal",
      dataIndex: "subtotal",
      render: (value) => formatMoney(value, "usd"),
    },
    { title: "Product", dataIndex: "product_kind" },
  ];
  return (
    <Flex vertical gap="middle">
      <Alert
        showIcon
        type="warning"
        title="Review the complete request before fresh-authenticated submission"
        description="No order has been changed yet. Confirm the customer, amount, recipients, dates, ownership, fulfillment plan, and audit reason."
      />
      <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
        <Descriptions.Item label="Organization">
          {prepared.organization_name}
        </Descriptions.Item>
        <Descriptions.Item label="Workflow">
          {humanizeKey(prepared.workflow_state ?? "draft")}
        </Descriptions.Item>
        <Descriptions.Item label="Collection mode">
          {humanizeKey(prepared.collection_mode ?? "stripe_invoice")}
        </Descriptions.Item>
        <Descriptions.Item label="Agreed subtotal">
          {formatMoney(prepared.agreed_subtotal, "usd")}
        </Descriptions.Item>
        <Descriptions.Item label="Agreed total">
          {formatMoney(
            prepared.agreed_total ?? prepared.agreed_subtotal,
            "usd",
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Payment terms">
          {prepared.payment_terms_days ?? 21} days
        </Descriptions.Item>
        <Descriptions.Item label="Service term">
          {formatDate(prepared.service_starts_at)} through{" "}
          {formatDate(prepared.service_ends_at)}
        </Descriptions.Item>
        <Descriptions.Item label="Next action">
          {prepared.next_action} ({formatDate(prepared.next_action_due_at)})
        </Descriptions.Item>
        <Descriptions.Item label="Assignee">
          <AccountIdentity
            accountId={prepared.assignee_account_id}
            names={accountNames}
            unknownLabel="Unassigned"
          />
        </Descriptions.Item>
        <Descriptions.Item label="Zendesk tickets">
          {prepared.zendesk_ticket_ids?.join(", ") || "None"}
        </Descriptions.Item>
        <Descriptions.Item label="Customer account">
          <AccountIdentity
            accountId={prepared.customer_account_id}
            names={accountNames}
            unknownLabel="Not linked"
          />
        </Descriptions.Item>
        <Descriptions.Item label="Stripe customer">
          {prepared.stripe_customer_id ?? "Not linked"}
        </Descriptions.Item>
        <Descriptions.Item label="Existing site license">
          <SiteLicenseReference
            emptyLabel="New or not applicable"
            siteLicenseId={prepared.site_license_id}
          />
        </Descriptions.Item>
        <Descriptions.Item label="PO / customer reference">
          {[prepared.po_number, prepared.customer_reference]
            .filter(Boolean)
            .join(" / ") || "Not set"}
        </Descriptions.Item>
        <Descriptions.Item label="Invoice memo">
          {invoiceTerms.memo ?? "Not set"}
        </Descriptions.Item>
        <Descriptions.Item label="Billing address">
          {invoiceTerms.billing_address
            ? [
                invoiceTerms.billing_address.line1,
                invoiceTerms.billing_address.line2,
                invoiceTerms.billing_address.city,
                invoiceTerms.billing_address.state,
                invoiceTerms.billing_address.postal_code,
                invoiceTerms.billing_address.country,
              ]
                .filter(Boolean)
                .join(", ")
            : "Not set"}
        </Descriptions.Item>
      </Descriptions>
      <div>
        <Title level={5}>Line items</Title>
        <Table
          aria-label="Reviewed commercial order line items"
          columns={itemColumns}
          dataSource={prepared.items}
          pagination={false}
          rowKey={(item) =>
            item.id ?? `${item.position ?? "item"}:${item.description}`
          }
          scroll={{ x: 700 }}
          size="small"
        />
      </div>
      <div>
        <Title level={5}>Contacts</Title>
        <ul>
          {prepared.contacts.map((contact, index) => (
            <li key={`${contact.email_snapshot}-${index}`}>
              {humanizeKey(contact.role)}: {contact.name_snapshot} &lt;
              {contact.email_snapshot}&gt;
              {contact.organization_snapshot
                ? `, ${contact.organization_snapshot}`
                : ""}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <Title level={5}>Fulfillment terms</Title>
        <Paragraph>
          Fulfillment required:{" "}
          {prepared.terms_snapshot.fulfillment_required === false
            ? "No"
            : "Yes"}
        </Paragraph>
        {plan ? (
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="License">
              {plan.name} for{" "}
              {plan.organization_name ?? prepared.organization_name}
            </Descriptions.Item>
            <Descriptions.Item label="Owner and managers">
              {plan.owner_account_id}; managers:{" "}
              {plan.manager_account_ids?.join(", ") || "none"}
            </Descriptions.Item>
            <Descriptions.Item label="Domains">
              {plan.allowed_domains.join(", ") || "None"}
            </Descriptions.Item>
            <Descriptions.Item label="Term">
              {formatDate(plan.starts_at)} through {formatDate(plan.expires_at)}
            </Descriptions.Item>
            <Descriptions.Item label="Pools">
              {plan.pools
                .map(
                  (pool) =>
                    `${pool.label ?? pool.membership_class}: ${pool.seat_limit} ${pool.membership_class}`,
                )
                .join("; ")}
            </Descriptions.Item>
            <Descriptions.Item label="Policies">
              {[
                plan.terms_version_label,
                plan.renewal_policy,
                plan.overage_policy,
              ]
                .filter(Boolean)
                .join("; ") || "Not set"}
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <Text type="secondary">No site-license plan is attached.</Text>
        )}
      </div>
      <div>
        <Title level={5}>Audit reason</Title>
        <Paragraph>{reason.trim()}</Paragraph>
      </div>
    </Flex>
  );
}

export function revisionWorkflowState(
  order: CommercialOrder,
): CommercialWorkflowState {
  return order.workflow_state;
}
