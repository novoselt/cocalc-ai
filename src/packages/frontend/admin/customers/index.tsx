/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  DatePicker,
  Descriptions,
  Divider,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
  message,
} from "antd";
import { useEffect, useState } from "react";

import type { AdminSupportTicketSummary } from "@cocalc/conat/hub/api/admin-support";
import {
  FreshAuthModal,
  useFreshAuthAction,
} from "@cocalc/frontend/auth/fresh-auth";
import {
  ErrorDisplay,
  Icon,
  type IconName,
  TimeAgo,
} from "@cocalc/frontend/components";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import { COMMERCIAL_NEXT_ACTIONS } from "@cocalc/util/commercial-orders";
import {
  CRM_DOMAIN_KINDS,
  CRM_LIFECYCLE_STAGES,
  CRM_OPPORTUNITY_KINDS,
  CRM_ORGANIZATION_TYPES,
  CRM_PERSON_ROLES,
  CRM_TASK_PRIORITIES,
  CRM_TASK_TYPES,
  type CrmCustomer360,
  type CrmExternalObjectKind,
  type CrmExternalProvider,
  type CrmExternalReference,
  type CrmMutationResult,
  type CrmOrganizationSummary,
} from "@cocalc/util/crm";
import { COLORS } from "@cocalc/util/theme";
import { AccountSelector } from "../receivables/account-selector";
import {
  AccountIdentity,
  useAccountDisplayNames,
} from "../receivables/account-names";
import { SiteLicenseSelector } from "../receivables/site-license-reference";
import {
  crmMutationContext,
  filterCrmActivities,
  safeExternalHttpUrl,
} from "./helpers";
import { CustomerSelector } from "./selector";
import { TimelineFilter } from "./timeline-filter";
import {
  CustomerOutreachCard,
  OutreachAdmin,
  type QueueView,
} from "./outreach";
import "./customers.css";

export { CustomerSelector } from "./selector";

const { Paragraph, Text, Title } = Typography;

type CustomerView =
  | "active"
  | "prospects"
  | "pilots"
  | "customers"
  | "renewals"
  | "expansions"
  | "overdue"
  | "unassigned"
  | "all";

type ActionKind =
  | "create-customer"
  | "edit-customer"
  | "add-domain"
  | "add-person"
  | "create-opportunity"
  | "create-task"
  | "add-note"
  | "link"
  | "create-order"
  | "merge"
  | "archive";

type ActionState = { kind: ActionKind; title: string };

type MutationPreview = Extract<CrmMutationResult<any>, { preview: true }>;

const VIEW_OPTIONS: Array<{ label: string; value: CustomerView }> = [
  { label: "Active relationships", value: "active" },
  { label: "Prospects", value: "prospects" },
  { label: "Adoption pilots", value: "pilots" },
  { label: "Customers", value: "customers" },
  { label: "Renewals", value: "renewals" },
  { label: "Expansions", value: "expansions" },
  { label: "Overdue follow-up", value: "overdue" },
  { label: "Unassigned", value: "unassigned" },
  { label: "All records", value: "all" },
];

function humanize(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(value: string | number | undefined, currency = "usd"): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function ZendeskReference({ reference }: { reference: CrmExternalReference }) {
  const ticketId = Number(reference.external_id);
  const [ticket, setTicket] = useState<AdminSupportTicketSummary>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!Number.isSafeInteger(ticketId) || ticketId < 1) return;
    let cancelled = false;
    void webapp_client.conat_client.hub.adminSupport
      .show({
        ticket_id: ticketId,
        max_comments: 1,
        max_bytes: 64_000,
        reason: `Review Zendesk ticket ${ticketId} linked to CRM customer`,
      })
      .then((result) => {
        if (!cancelled) setTicket(result.ticket);
      })
      .catch((err) => {
        if (!cancelled) setError(`${err}`);
      });
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  const href =
    ticket?.agent_url ??
    `https://sagemathcloud.zendesk.com/agent/tickets/${reference.external_id}`;
  return (
    <Tag
      color={reference.verification_state === "verified" ? "green" : "default"}
    >
      <a href={href} rel="noreferrer" target="_blank">
        Zendesk ticket {reference.external_id} <Icon name="external-link" />
      </a>
      {ticket ? ` · ${humanize(ticket.status)} · ${ticket.subject}` : null}
      {error ? " · details unavailable" : null}
    </Tag>
  );
}

function viewRequest(view: CustomerView): Record<string, unknown> {
  switch (view) {
    case "prospects":
      return { lifecycle_stages: ["prospect"] };
    case "pilots":
      return { lifecycle_stages: ["pilot"] };
    case "customers":
      return { lifecycle_stages: ["customer"] };
    case "renewals":
      return { lifecycle_stages: ["renewal"] };
    case "expansions":
      return { opportunity_kinds: ["expansion"] };
    case "overdue":
      return { has_overdue_tasks: true };
    case "unassigned":
      return { unassigned: true };
    case "all":
      return {};
    default:
      return { statuses: ["active"] };
  }
}

function customerMatchesView(
  customer: CrmOrganizationSummary,
  view: CustomerView,
): boolean {
  switch (view) {
    case "prospects":
      return customer.lifecycle_stage === "prospect";
    case "pilots":
      return customer.lifecycle_stage === "pilot";
    case "customers":
      return customer.lifecycle_stage === "customer";
    case "renewals":
      return customer.lifecycle_stage === "renewal";
    case "expansions":
      return customer.open_opportunity_count > 0;
    case "overdue":
      return !!(
        customer.next_task && new Date(customer.next_task.due_at) < new Date()
      );
    case "unassigned":
      return !customer.relationship_owner_account_id;
    case "all":
      return true;
    default:
      return customer.status === "active";
  }
}

function LifecycleTag({ stage }: { stage: string }) {
  const colors: Record<string, string> = {
    prospect: "gold",
    pilot: "cyan",
    customer: "green",
    renewal: "blue",
    former_customer: "default",
    inactive: "default",
  };
  return <Tag color={colors[stage]}>{humanize(stage)}</Tag>;
}

function CustomerCard({
  customer,
  names,
  onOpen,
}: {
  customer: CrmOrganizationSummary;
  names: Record<string, string>;
  onOpen: () => void;
}) {
  return (
    <Card
      className="crm-record-card"
      styles={{ body: { padding: 18 } }}
      title={
        <Flex align="center" gap={8} justify="space-between" wrap>
          <Text className="crm-wrap-anywhere" strong>
            {customer.display_name}
          </Text>
          <LifecycleTag stage={customer.lifecycle_stage} />
        </Flex>
      }
    >
      <Flex vertical gap={12}>
        <Text type="secondary">{customer.customer_number}</Text>
        <Flex gap={4} wrap>
          {customer.verified_domains.slice(0, 4).map((domain) => (
            <Tag key={domain} bordered={false} color="geekblue">
              {domain}
            </Tag>
          ))}
          {!customer.verified_domains.length ? (
            <Text type="secondary">No verified domain</Text>
          ) : null}
        </Flex>
        <Descriptions column={1} size="small">
          <Descriptions.Item label="Owner">
            <AccountIdentity
              accountId={customer.relationship_owner_account_id}
              names={names}
              unknownLabel="Unassigned"
            />
          </Descriptions.Item>
          <Descriptions.Item label="Pipeline">
            {customer.open_opportunity_count} open opportunit
            {customer.open_opportunity_count === 1 ? "y" : "ies"}
          </Descriptions.Item>
          <Descriptions.Item label="Receivables">
            {money(customer.outstanding_receivables)} outstanding
          </Descriptions.Item>
          <Descriptions.Item label="Next action">
            {customer.next_task ? (
              <span>
                {customer.next_task.subject} ·{" "}
                <TimeAgo date={customer.next_task.due_at} />
              </span>
            ) : (
              <Text type="secondary">No open task</Text>
            )}
          </Descriptions.Item>
        </Descriptions>
        <Button onClick={onOpen} type="primary">
          Open Customer 360
        </Button>
      </Flex>
    </Card>
  );
}

function PreviewPanel({ preview }: { preview: MutationPreview }) {
  return (
    <Flex vertical gap={12}>
      <Alert
        showIcon
        type="info"
        title="Review the proposed CRM mutation"
        description="Nothing has changed yet. Confirming uses fresh authentication and the optimistic version below."
      />
      <Descriptions bordered column={1} size="small">
        <Descriptions.Item label="Action">{preview.action}</Descriptions.Item>
        <Descriptions.Item label="Expected version">
          {preview.expected_version}
        </Descriptions.Item>
        <Descriptions.Item label="Idempotency key">
          <Text className="crm-wrap-anywhere" copyable>
            {preview.idempotency_key}
          </Text>
        </Descriptions.Item>
      </Descriptions>
      {preview.warnings.map((warning) => (
        <Alert key={warning} showIcon type="warning" title={warning} />
      ))}
      <details>
        <summary>Proposed fields</summary>
        <pre
          style={{ maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap" }}
        >
          {JSON.stringify(preview.proposed, null, 2)}
        </pre>
      </details>
    </Flex>
  );
}

function CustomerActionModal({
  action,
  customer,
  onClose,
  onCommitted,
}: {
  action: ActionState | null;
  customer?: CrmCustomer360;
  onClose: () => void;
  onCommitted: (organizationId?: string) => Promise<void>;
}) {
  const api = webapp_client.conat_client.hub.adminCrm;
  const [form] = Form.useForm();
  const [preview, setPreview] = useState<MutationPreview | null>(null);
  const [request, setRequest] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>("");
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction();

  useEffect(() => {
    form.resetFields();
    setPreview(null);
    setRequest(null);
    setError("");
    if (!action) return;
    form.setFieldsValue({
      display_name: customer?.organization.display_name,
      legal_name: customer?.organization.legal_name,
      website: customer?.organization.website,
      organization_type:
        customer?.organization.organization_type ?? "university",
      lifecycle_stage: customer?.organization.lifecycle_stage ?? "prospect",
      relationship_owner_account_id:
        customer?.organization.relationship_owner_account_id,
      kind:
        action.kind === "add-domain"
          ? "primary"
          : action.kind === "create-opportunity"
            ? "adoption_pilot"
            : undefined,
      priority: "normal",
      type: "contact",
      currency: "usd",
      link_kind: "zendesk:ticket",
      verify: false,
      next_action: COMMERCIAL_NEXT_ACTIONS[0],
      payment_terms_days: 21,
    });
  }, [action, customer?.organization.id]);

  function organizationSelector(): string {
    if (!customer) throw Error("a customer is required for this action");
    return customer.organization.customer_number;
  }

  async function call(
    values: Record<string, any>,
    commit: boolean,
    previous?: MutationPreview,
  ) {
    const common = crmMutationContext({
      browserId: webapp_client.browser_id,
      commit,
      previous,
      reason: values.reason,
    });
    switch (action?.kind) {
      case "create-customer":
        return await api.createOrganization({
          ...common,
          display_name: values.display_name,
          legal_name: values.legal_name,
          aliases: `${values.aliases ?? ""}`
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          organization_type: values.organization_type,
          lifecycle_stage: values.lifecycle_stage,
          relationship_owner_account_id: values.relationship_owner_account_id,
          website: values.website,
        });
      case "edit-customer":
        return await api.updateOrganization({
          ...common,
          organization: organizationSelector(),
          changes: {
            display_name: values.display_name,
            legal_name: values.legal_name || null,
            website: values.website || null,
            lifecycle_stage: values.lifecycle_stage,
            relationship_owner_account_id:
              values.relationship_owner_account_id || null,
          },
        });
      case "add-domain":
        return await api.mutateDomain({
          ...common,
          organization: organizationSelector(),
          domain: values.domain,
          action: values.verify ? "verify" : "add",
          kind: values.kind,
          verification_method: values.verification_method,
          evidence_reference: values.evidence_reference,
        });
      case "add-person":
        return await api.createPerson({
          ...common,
          display_name: values.display_name,
          organization: organizationSelector(),
          roles: values.roles ?? [],
          title: values.title,
          department: values.department,
          email: values.email,
          cocalc_account_id: values.account_id,
        });
      case "create-opportunity":
        return await api.createOpportunity({
          ...common,
          organization: organizationSelector(),
          name: values.name,
          kind: values.kind,
          owner_account_id: values.owner_account_id,
          expected_value: `${values.expected_value}`,
          currency: values.currency,
          expected_close_date: values.expected_close_date.format("YYYY-MM-DD"),
          service_starts_at: values.service_dates?.[0]?.toISOString(),
          service_ends_at: values.service_dates?.[1]?.toISOString(),
          source_zendesk_ticket_ids: values.zendesk_ticket_id
            ? [Number(values.zendesk_ticket_id)]
            : [],
          description: values.description,
        });
      case "create-task":
        return await api.createTask({
          ...common,
          organization: organizationSelector(),
          type: values.type,
          assignee_account_id: values.assignee_account_id,
          due_at: values.due_at.toISOString(),
          priority: values.priority,
          subject: values.subject,
          details: values.details,
          person: values.person,
          opportunity: values.opportunity,
          zendesk_ticket_id: values.zendesk_ticket_id
            ? Number(values.zendesk_ticket_id)
            : undefined,
        });
      case "add-note":
        return await api.addActivity({
          ...common,
          organization: organizationSelector(),
          kind: "note",
          summary: values.summary,
          details: values.details,
          person: values.person,
          opportunity: values.opportunity,
        });
      case "link": {
        const [provider, objectKind] = `${values.link_kind}`.split(":");
        return await api.mutateExternalReference({
          ...common,
          organization: organizationSelector(),
          action: values.verify ? "verify" : "add",
          provider: provider as CrmExternalProvider,
          object_kind: objectKind as CrmExternalObjectKind,
          external_id:
            objectKind === "site_license"
              ? values.site_license_id
              : values.external_id,
          label: values.label,
          metadata: {},
        });
      }
      case "create-order":
        return await api.createCommercialOrderFromOpportunity({
          ...common,
          opportunity: values.opportunity,
          next_action: values.next_action,
          next_action_due_at: values.next_action_due_at?.toISOString(),
          collection_mode: values.collection_mode ?? "stripe_invoice",
          payment_terms_days: values.payment_terms_days,
          billing_contact_person: values.billing_contact_person,
        });
      case "merge":
        return await api.mergeOrganizations({
          ...common,
          source_organization: organizationSelector(),
          destination_organization: values.destination_organization,
        });
      case "archive":
        return await api.archiveOrganization({
          ...common,
          organization: organizationSelector(),
        });
      default:
        throw Error("unsupported customer action");
    }
  }

  async function submit() {
    setError("");
    setBusy(true);
    try {
      if (!preview) {
        const values = await form.validateFields();
        const result = await call(values, false);
        if (!result.preview) throw Error("CRM preview unexpectedly committed");
        setRequest(values);
        setPreview(result);
        return;
      }
      const completed = await runFreshAuthAction(async () => {
        const result = await call(request ?? {}, true, preview);
        if (result.preview)
          throw Error("CRM commit unexpectedly returned a preview");
        const organizationId =
          action?.kind === "create-customer"
            ? (result.result as { id?: string }).id
            : customer?.organization.id;
        message.success("Customer relationship updated");
        await onCommitted(organizationId);
        onClose();
      });
      if (!completed) return;
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function personOptions() {
    return customer?.people.map((person) => ({
      label: person.display_name,
      value: person.id,
    }));
  }

  function opportunityOptions() {
    return customer?.opportunities
      .filter((opportunity) => !opportunity.commercial_order_id)
      .map((opportunity) => ({
        label: `${opportunity.name} · ${humanize(opportunity.stage)}`,
        value: opportunity.id,
      }));
  }

  function fields() {
    if (!action) return null;
    switch (action.kind) {
      case "create-customer":
      case "edit-customer":
        return (
          <>
            <Form.Item
              label="Display name"
              name="display_name"
              rules={[{ required: true }]}
              initialValue={customer?.organization.display_name}
            >
              <Input autoComplete="organization" />
            </Form.Item>
            <Form.Item
              label="Legal name"
              name="legal_name"
              initialValue={customer?.organization.legal_name}
            >
              <Input autoComplete="organization" />
            </Form.Item>
            {action.kind === "create-customer" ? (
              <>
                <Form.Item
                  label="Organization type"
                  name="organization_type"
                  rules={[{ required: true }]}
                >
                  <Select
                    options={CRM_ORGANIZATION_TYPES.map((value) => ({
                      value,
                      label: humanize(value),
                    }))}
                  />
                </Form.Item>
                <Form.Item
                  label="Aliases"
                  name="aliases"
                  extra="Comma-separated reviewed names."
                >
                  <Input />
                </Form.Item>
              </>
            ) : null}
            <Form.Item
              label="Lifecycle"
              name="lifecycle_stage"
              rules={[{ required: true }]}
            >
              <Select
                options={CRM_LIFECYCLE_STAGES.map((value) => ({
                  value,
                  label: humanize(value),
                }))}
              />
            </Form.Item>
            <Form.Item
              label="Relationship owner"
              name="relationship_owner_account_id"
            >
              <AccountSelector accountKind="admin" />
            </Form.Item>
            <Form.Item
              label="Website"
              name="website"
              initialValue={customer?.organization.website}
            >
              <Input type="url" />
            </Form.Item>
          </>
        );
      case "add-domain":
        return (
          <>
            <Form.Item
              label="Institutional domain"
              name="domain"
              rules={[{ required: true }]}
            >
              <Input prefix="@" autoComplete="off" />
            </Form.Item>
            <Form.Item
              label="Domain kind"
              name="kind"
              rules={[{ required: true }]}
            >
              <Select
                options={CRM_DOMAIN_KINDS.map((value) => ({
                  value,
                  label: humanize(value),
                }))}
              />
            </Form.Item>
            <Form.Item label="Verification method" name="verification_method">
              <Input placeholder="e.g. procurement email, public institution record" />
            </Form.Item>
            <Form.Item label="Evidence reference" name="evidence_reference">
              <Input placeholder="Ticket, URL, or concise reference" />
            </Form.Item>
            <Form.Item label="Review state" name="verify">
              <Select
                options={[
                  { value: false, label: "Suggested only" },
                  { value: true, label: "Verified after review" },
                ]}
              />
            </Form.Item>
          </>
        );
      case "add-person":
        return (
          <>
            <Form.Item
              label="Contact name"
              name="display_name"
              rules={[{ required: true }]}
            >
              <Input autoComplete="name" />
            </Form.Item>
            <Form.Item label="Email" name="email">
              <Input type="email" autoComplete="email" />
            </Form.Item>
            <Form.Item label="CoCalc account" name="account_id">
              <AccountSelector accountKind="customer" />
            </Form.Item>
            <Form.Item label="Customer roles" name="roles">
              <Select
                mode="multiple"
                options={CRM_PERSON_ROLES.map((value) => ({
                  value,
                  label: humanize(value),
                }))}
              />
            </Form.Item>
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item label="Title" name="title">
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item label="Department" name="department">
                  <Input />
                </Form.Item>
              </Col>
            </Row>
          </>
        );
      case "create-opportunity":
        return (
          <>
            <Form.Item
              label="Opportunity name"
              name="name"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              label="Opportunity kind"
              name="kind"
              rules={[{ required: true }]}
            >
              <Select
                options={CRM_OPPORTUNITY_KINDS.map((value) => ({
                  value,
                  label: humanize(value),
                }))}
              />
            </Form.Item>
            <Form.Item
              label="Owner"
              name="owner_account_id"
              rules={[{ required: true }]}
            >
              <AccountSelector accountKind="admin" />
            </Form.Item>
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item
                  label="Expected value"
                  name="expected_value"
                  rules={[{ required: true }]}
                >
                  <InputNumber
                    min={0}
                    precision={2}
                    prefix="$"
                    style={{ width: "100%" }}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  label="Expected close"
                  name="expected_close_date"
                  rules={[{ required: true }]}
                >
                  <DatePicker style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="Zendesk ticket" name="zendesk_ticket_id">
              <InputNumber min={1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="Description" name="description">
              <Input.TextArea maxLength={10000} rows={3} />
            </Form.Item>
          </>
        );
      case "create-task":
        return (
          <>
            <Form.Item
              label="Subject"
              name="subject"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              label="Task type"
              name="type"
              rules={[{ required: true }]}
            >
              <Select
                options={CRM_TASK_TYPES.map((value) => ({
                  value,
                  label: humanize(value),
                }))}
              />
            </Form.Item>
            <Form.Item
              label="Assignee"
              name="assignee_account_id"
              rules={[{ required: true }]}
            >
              <AccountSelector accountKind="admin" />
            </Form.Item>
            <Row gutter={12}>
              <Col xs={24} sm={14}>
                <Form.Item
                  label="Due"
                  name="due_at"
                  rules={[{ required: true }]}
                >
                  <DatePicker showTime style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={10}>
                <Form.Item label="Priority" name="priority">
                  <Select
                    options={CRM_TASK_PRIORITIES.map((value) => ({
                      value,
                      label: humanize(value),
                    }))}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item label="Contact" name="person">
                  <Select allowClear options={personOptions()} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item label="Opportunity" name="opportunity">
                  <Select
                    allowClear
                    options={customer?.opportunities.map((x) => ({
                      label: x.name,
                      value: x.id,
                    }))}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="Details" name="details">
              <Input.TextArea maxLength={10000} rows={3} />
            </Form.Item>
          </>
        );
      case "add-note":
        return (
          <>
            <Form.Item
              label="Summary"
              name="summary"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Form.Item label="Details" name="details">
              <Input.TextArea maxLength={10000} rows={5} />
            </Form.Item>
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item label="Contact" name="person">
                  <Select allowClear options={personOptions()} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item label="Opportunity" name="opportunity">
                  <Select
                    allowClear
                    options={customer?.opportunities.map((x) => ({
                      label: x.name,
                      value: x.id,
                    }))}
                  />
                </Form.Item>
              </Col>
            </Row>
          </>
        );
      case "link":
        return (
          <>
            <Form.Item
              label="Reference type"
              name="link_kind"
              rules={[{ required: true }]}
            >
              <Select
                options={[
                  { value: "zendesk:ticket", label: "Zendesk ticket" },
                  {
                    value: "cocalc:site_license",
                    label: "CoCalc site license",
                  },
                  {
                    value: "cocalc:commercial_order",
                    label: "Commercial order",
                  },
                  { value: "stripe:customer", label: "Stripe customer" },
                ]}
              />
            </Form.Item>
            <Form.Item
              noStyle
              shouldUpdate={(previous, current) =>
                previous.link_kind !== current.link_kind
              }
            >
              {({ getFieldValue }) =>
                getFieldValue("link_kind") === "cocalc:site_license" ? (
                  <Form.Item
                    label="Existing site license"
                    name="site_license_id"
                    rules={[{ required: true }]}
                  >
                    <SiteLicenseSelector />
                  </Form.Item>
                ) : (
                  <Form.Item
                    label="External identifier"
                    name="external_id"
                    rules={[{ required: true }]}
                  >
                    <Input placeholder="Ticket number, order number/UUID, or Stripe customer ID" />
                  </Form.Item>
                )
              }
            </Form.Item>
            <Form.Item label="Display label" name="label">
              <Input />
            </Form.Item>
            <Form.Item label="Review state" name="verify">
              <Select
                options={[
                  { value: false, label: "Suggested" },
                  { value: true, label: "Verified" },
                ]}
              />
            </Form.Item>
          </>
        );
      case "create-order":
        return (
          <>
            <Form.Item
              label="Won opportunity"
              name="opportunity"
              rules={[{ required: true }]}
            >
              <Select options={opportunityOptions()} />
            </Form.Item>
            <Form.Item label="Billing contact" name="billing_contact_person">
              <Select allowClear options={personOptions()} />
            </Form.Item>
            <Form.Item
              label="Next receivables action"
              name="next_action"
              rules={[{ required: true }]}
            >
              <Select
                options={COMMERCIAL_NEXT_ACTIONS.map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </Form.Item>
            <Form.Item
              label="Next-action due"
              name="next_action_due_at"
              rules={[{ required: true }]}
            >
              <DatePicker showTime style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              label="Collection mode"
              name="collection_mode"
              initialValue="stripe_invoice"
            >
              <Select
                options={[
                  { value: "stripe_invoice", label: "Stripe invoice" },
                  { value: "manual_invoice", label: "Manual invoice" },
                ]}
              />
            </Form.Item>
            <Form.Item label="Payment terms" name="payment_terms_days">
              <InputNumber
                min={1}
                max={365}
                addonAfter="days"
                style={{ width: "100%" }}
              />
            </Form.Item>
          </>
        );
      case "merge":
        return (
          <>
            <Alert
              showIcon
              type="warning"
              title="The current customer becomes a merged redirect"
              description="Contacts, opportunities, tasks, links, orders, licenses, and timeline entries move to the destination. Review the server plan carefully."
            />
            <Form.Item
              label="Canonical destination"
              name="destination_organization"
              rules={[{ required: true }]}
            >
              <CustomerSelector />
            </Form.Item>
          </>
        );
      case "archive":
        return (
          <Alert
            showIcon
            type="warning"
            title="Archive this customer"
            description="History remains searchable, but the relationship leaves normal active views."
          />
        );
    }
  }

  return (
    <>
      <Modal
        destroyOnHidden
        open={action != null}
        title={action?.title}
        okText={preview ? "Confirm with fresh auth" : "Review change"}
        okButtonProps={{
          danger: action?.kind === "archive" || action?.kind === "merge",
          loading: busy,
        }}
        cancelButtonProps={{ disabled: busy }}
        onCancel={onClose}
        onOk={() => void submit()}
        width={680}
      >
        {error ? (
          <ErrorDisplay
            error={error}
            onClose={() => setError("")}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        {preview ? (
          <PreviewPanel preview={preview} />
        ) : (
          <Form form={form} layout="vertical" requiredMark="optional">
            {fields()}
            <Form.Item
              label="Audit reason"
              name="reason"
              rules={[{ required: true, min: 4 }]}
              extra="Written to the immutable CRM audit history."
            >
              <Input.TextArea maxLength={2000} rows={3} />
            </Form.Item>
          </Form>
        )}
      </Modal>
      <FreshAuthModal {...freshAuthModalProps} />
    </>
  );
}

function CustomerQueue({
  onCreate,
  onOpen,
}: {
  onCreate: () => void;
  onOpen: (id: string) => void;
}) {
  const api = webapp_client.conat_client.hub.adminCrm;
  const [customers, setCustomers] = useState<CrmOrganizationSummary[]>([]);
  const [view, setView] = useState<CustomerView>("active");
  const [search, setSearch] = useState("");
  const [draftSearch, setDraftSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>("");
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const ownerNames = useAccountDisplayNames(
    customers.map((x) => x.relationship_owner_account_id),
  );

  async function load() {
    setLoading(true);
    setError("");
    try {
      const result = search
        ? await api.searchOrganizations({
            query: search,
            reason: "Search CRM customer queue",
            limit: 100,
          })
        : await api.listOrganizations({
            ...viewRequest(view),
            reason: "Review CRM customer queue",
            limit: 100,
          });
      setCustomers(
        search
          ? result.organizations.filter((customer) =>
              customerMatchesView(customer, view),
            )
          : result.organizations,
      );
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [view, search]);

  async function loadDiagnostics() {
    try {
      setDiagnostics(
        await api.getDiagnostics({
          reason: "Review CRM queue diagnostics",
          limit: 25,
        }),
      );
    } catch (err) {
      setError(err);
    }
  }

  const totals = {
    visible: customers.length,
    pipeline: customers.reduce((sum, x) => sum + x.open_opportunity_count, 0),
    overdue: customers.filter(
      (x) => x.next_task && new Date(x.next_task.due_at) < new Date(),
    ).length,
    outstanding: customers.reduce(
      (sum, x) => sum + Number(x.outstanding_receivables),
      0,
    ),
  };

  return (
    <Flex className="crm-shell" vertical gap={18}>
      <section className="crm-hero" aria-labelledby="crm-queue-title">
        <Flex align="center" gap={20} justify="space-between" wrap>
          <div style={{ maxWidth: 720 }}>
            <div className="crm-eyebrow">Customer relationships</div>
            <Title id="crm-queue-title" level={2} style={{ margin: "8px 0" }}>
              One customer, one operational story
            </Title>
            <Paragraph style={{ fontSize: 16, marginBottom: 0 }}>
              Reviewed identity, contacts, opportunities, follow-up,
              receivables, licenses, and support references in one record.
            </Paragraph>
          </div>
          <Space wrap>
            <Button
              ghost
              href="/app-docs/admin/crm-ui"
              icon={<Icon name="book" />}
              size="large"
            >
              UI guide
            </Button>
            <Button ghost href="/app-docs/admin/crm" size="large">
              Agent and CLI runbook
            </Button>
            <Button icon={<Icon name="plus" />} onClick={onCreate} size="large">
              Create customer
            </Button>
          </Space>
        </Flex>
      </section>

      <div className="crm-summary-grid" aria-label="Customer queue summary">
        {[
          ["Visible customers", totals.visible, "users"],
          ["Open opportunities", totals.pipeline, "line-chart"],
          ["Overdue follow-up", totals.overdue, "clock"],
          ["Outstanding", money(totals.outstanding), "shopping-cart"],
        ].map(([label, value, icon]) => (
          <Card className="crm-metric-card" key={`${label}`} size="small">
            <Flex align="center" gap={10}>
              <Icon
                name={icon as any}
                style={{ color: COLORS.FEATURE_TEAL, fontSize: 20 }}
              />
              <Statistic title={label} value={value as any} />
            </Flex>
          </Card>
        ))}
      </div>

      <div className="crm-filter-panel">
        <Flex align="end" gap={12} wrap>
          <div style={{ flex: "0 1 230px" }}>
            <label htmlFor="crm-view">
              <Text strong>Views</Text>
            </label>
            <Select
              id="crm-view"
              onChange={setView}
              options={VIEW_OPTIONS}
              style={{ width: "100%" }}
              value={view}
            />
          </div>
          <div style={{ flex: "1 1 280px" }}>
            <label htmlFor="crm-search">
              <Text strong>Search customers</Text>
            </label>
            <Input.Search
              id="crm-search"
              allowClear
              enterButton="Search"
              onChange={(event) => setDraftSearch(event.target.value)}
              onSearch={(value) => setSearch(value.trim())}
              placeholder="Name, alias, domain, contact, customer number"
              value={draftSearch}
            />
          </div>
          <Button icon={<Icon name="refresh" />} onClick={() => void load()}>
            Refresh
          </Button>
        </Flex>
      </div>

      {error ? (
        <ErrorDisplay error={error} onClose={() => setError("")} />
      ) : null}
      {loading ? (
        <Spin description="Loading customers" />
      ) : customers.length ? (
        <div className="crm-record-grid">
          {customers.map((customer) => (
            <CustomerCard
              key={customer.id}
              customer={customer}
              names={ownerNames}
              onOpen={() => onOpen(customer.id)}
            />
          ))}
        </div>
      ) : (
        <div className="crm-empty-panel">
          <Empty description="No customers match this view" />
        </div>
      )}

      <Collapse
        items={[
          {
            key: "diagnostics",
            label: "Data quality and follow-up diagnostics",
            children: diagnostics ? (
              <div className="crm-summary-grid">
                {[
                  [
                    "Unowned customers",
                    diagnostics.active_organizations_without_owner.length,
                  ],
                  ["Overdue tasks", diagnostics.overdue_tasks.length],
                  [
                    "Opportunities without tasks",
                    diagnostics.open_opportunities_without_task.length,
                  ],
                  [
                    "Unlinked orders",
                    diagnostics.commercial_orders_without_organization.length,
                  ],
                  [
                    "Unlinked licenses",
                    diagnostics.site_licenses_without_organization.length,
                  ],
                ].map(([label, value]) => (
                  <Card key={`${label}`} size="small">
                    <Statistic title={label} value={value} />
                  </Card>
                ))}
              </div>
            ) : (
              <Button onClick={() => void loadDiagnostics()}>
                Run diagnostics
              </Button>
            ),
          },
        ]}
      />
    </Flex>
  );
}

function SectionHeader({
  action,
  children,
  icon,
  onAction,
}: {
  action?: string;
  children: string;
  icon: IconName;
  onAction?: () => void;
}) {
  return (
    <Flex align="center" gap={8} justify="space-between" wrap>
      <Title level={4} style={{ margin: 0 }}>
        <Icon
          name={icon}
          style={{ color: COLORS.FEATURE_TEAL, marginRight: 8 }}
        />
        {children}
      </Title>
      {action ? (
        <Button onClick={onAction} size="small">
          {action}
        </Button>
      ) : null}
    </Flex>
  );
}

function CustomerDetail({
  customerId,
  onAction,
  onBack,
  onOpenOutreach,
}: {
  customerId: string;
  onAction: (action: ActionState) => void;
  onBack: () => void;
  onOpenOutreach: (create?: boolean, view?: QueueView) => void;
}) {
  const [customer, setCustomer] = useState<CrmCustomer360 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>("");
  const [timelineFilter, setTimelineFilter] = useState("");
  const accountIds = customer
    ? [
        customer.organization.relationship_owner_account_id,
        ...customer.opportunities.map((x) => x.owner_account_id),
        ...customer.tasks.map((x) => x.assignee_account_id),
        ...customer.people.flatMap((person) =>
          person.accounts.map((x) => x.account_id),
        ),
      ]
    : [];
  const names = useAccountDisplayNames(accountIds);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setCustomer(
        await webapp_client.conat_client.hub.adminCrm.getOrganization({
          organization: customerId,
          reason: "Review CRM Customer 360",
          activity_limit: 150,
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [customerId]);

  if (loading) return <Spin description="Loading Customer 360" />;
  if (error)
    return (
      <ErrorDisplay
        error={error}
        onClose={onBack}
        title="Customer could not be loaded"
      />
    );
  if (!customer) return <Empty description="Customer not found" />;

  const organization = customer.organization;
  const websiteUrl = safeExternalHttpUrl(organization.website);
  const closedPipeline = customer.opportunities.filter((x) =>
    ["won", "lost"].includes(x.stage),
  ).length;
  const pipelineProgress = customer.opportunities.length
    ? Math.round((closedPipeline / customer.opportunities.length) * 100)
    : 0;
  const filteredActivities = filterCrmActivities(
    customer.activities,
    timelineFilter,
  );
  const visibleActivities = filteredActivities.slice(
    0,
    timelineFilter.trim() ? 100 : 40,
  );

  return (
    <Flex className="crm-shell" vertical gap={18}>
      <Flex align="center" gap={8} justify="space-between" wrap>
        <Button icon={<Icon name="arrow-left" />} onClick={onBack}>
          Customer queue
        </Button>
        <Space wrap>
          <Button
            href="/app-docs/admin/crm-ui"
            icon={<Icon name="book" />}
            size="small"
          >
            UI guide
          </Button>
          <Button href="/app-docs/admin/crm" size="small">
            Agent and CLI runbook
          </Button>
        </Space>
      </Flex>
      <section className="crm-hero" aria-labelledby="crm-customer-title">
        <Flex align="start" gap={18} justify="space-between" wrap>
          <div>
            <div className="crm-eyebrow">{organization.customer_number}</div>
            <Title
              id="crm-customer-title"
              level={2}
              style={{ margin: "8px 0" }}
            >
              {organization.display_name}
            </Title>
            <Flex gap={6} wrap>
              <LifecycleTag stage={organization.lifecycle_stage} />
              <Tag>{humanize(organization.organization_type)}</Tag>
              {customer.domains
                .filter((x) => x.state === "verified")
                .map((domain) => (
                  <Tag key={domain.id} color="geekblue">
                    {domain.normalized_domain}
                  </Tag>
                ))}
            </Flex>
          </div>
          <Space wrap>
            <Button
              onClick={() =>
                onAction({
                  kind: "edit-customer",
                  title: "Edit customer profile",
                })
              }
            >
              Edit profile
            </Button>
            <Button
              onClick={() =>
                onAction({ kind: "add-note", title: "Add timeline note" })
              }
            >
              Add note
            </Button>
            <Button
              type="primary"
              onClick={() =>
                onAction({
                  kind: "create-task",
                  title: "Create follow-up task",
                })
              }
            >
              Next action
            </Button>
          </Space>
        </Flex>
      </section>

      <div className="crm-summary-grid">
        <Card className="crm-metric-card">
          <Statistic
            title="Historical spend"
            value={money(
              Object.values(customer.metrics.commercial_spend_by_year).reduce(
                (sum, value) => sum + Number(value),
                0,
              ),
            )}
          />
        </Card>
        <Card className="crm-metric-card">
          <Statistic
            title="Outstanding receivables"
            value={money(customer.metrics.outstanding_receivables)}
          />
        </Card>
        <Card className="crm-metric-card">
          <Statistic
            title="Linked accounts"
            value={customer.metrics.linked_account_count}
          />
        </Card>
        <Card className="crm-metric-card">
          <Statistic
            title="Active licenses"
            value={customer.metrics.active_site_license_count}
          />
        </Card>
      </div>

      <div className="crm-detail-grid">
        <Flex vertical gap={14} style={{ minWidth: 0 }}>
          <Card className="crm-section-card">
            <SectionHeader
              action="Add contact"
              icon="users"
              onAction={() =>
                onAction({ kind: "add-person", title: "Add customer contact" })
              }
            >
              People
            </SectionHeader>
            <Divider />
            {customer.people.length ? (
              <Flex vertical gap={12}>
                {customer.people.map((person) => {
                  const relationship = customer.relationships.find(
                    (x) => x.person_id === person.id,
                  );
                  return (
                    <Card key={person.id} size="small">
                      <Flex align="start" gap={12} justify="space-between" wrap>
                        <div>
                          <Text strong>{person.display_name}</Text>
                          <br />
                          {relationship?.title ? (
                            <Text type="secondary">
                              {relationship.title}
                              {relationship.department
                                ? ` · ${relationship.department}`
                                : ""}
                            </Text>
                          ) : null}
                          <Flex gap={4} style={{ marginTop: 6 }} wrap>
                            {relationship?.roles.map((role) => (
                              <Tag key={role}>{humanize(role)}</Tag>
                            ))}
                          </Flex>
                        </div>
                        <div>
                          {person.emails.map((email) => (
                            <div key={email.id}>
                              <Text copyable={{ text: email.email_address }}>
                                {email.email_address}
                              </Text>
                            </div>
                          ))}
                          {person.accounts
                            .filter((x) => x.state === "verified")
                            .map((account) => (
                              <div key={account.id}>
                                <Icon name="user" />{" "}
                                <AccountIdentity
                                  accountId={account.account_id}
                                  names={names}
                                />
                              </div>
                            ))}
                        </div>
                      </Flex>
                    </Card>
                  );
                })}
              </Flex>
            ) : (
              <Empty description="No reviewed contacts" />
            )}
          </Card>

          <Card className="crm-section-card">
            <SectionHeader
              action="New opportunity"
              icon="line-chart"
              onAction={() =>
                onAction({
                  kind: "create-opportunity",
                  title: "Create opportunity",
                })
              }
            >
              Pipeline
            </SectionHeader>
            <Divider />
            <Progress
              percent={pipelineProgress}
              size="small"
              strokeColor="#117865"
            />
            <Flex vertical gap={10} style={{ marginTop: 14 }}>
              {customer.opportunities.map((opportunity) => (
                <Card key={opportunity.id} size="small">
                  <Flex align="start" gap={12} justify="space-between" wrap>
                    <div>
                      <Text strong>{opportunity.name}</Text>
                      <br />
                      <Text type="secondary">
                        {humanize(opportunity.kind)} · closes{" "}
                        {opportunity.expected_close_date}
                      </Text>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <Tag
                        color={
                          opportunity.stage === "won"
                            ? "green"
                            : opportunity.stage === "lost"
                              ? "default"
                              : "blue"
                        }
                      >
                        {humanize(opportunity.stage)}
                      </Tag>
                      <br />
                      <Text>
                        {money(
                          opportunity.expected_value,
                          opportunity.currency,
                        )}
                      </Text>
                      <br />
                      <Text type="secondary">
                        <AccountIdentity
                          accountId={opportunity.owner_account_id}
                          names={names}
                        />
                      </Text>
                    </div>
                  </Flex>
                </Card>
              ))}
              {!customer.opportunities.length ? (
                <Empty description="No opportunities yet" />
              ) : null}
            </Flex>
            {customer.opportunities.some((x) => !x.commercial_order_id) ? (
              <Button
                block
                onClick={() =>
                  onAction({
                    kind: "create-order",
                    title: "Create commercial order from opportunity",
                  })
                }
                style={{ marginTop: 14 }}
              >
                Hand off to Accounts Receivable
              </Button>
            ) : null}
          </Card>

          <Card className="crm-section-card">
            <SectionHeader
              action="Add task"
              icon="check-square"
              onAction={() =>
                onAction({
                  kind: "create-task",
                  title: "Create follow-up task",
                })
              }
            >
              Follow-up
            </SectionHeader>
            <Divider />
            <Flex vertical gap={10}>
              {customer.tasks
                .filter((task) => ["open", "waiting"].includes(task.state))
                .map((task) => (
                  <Card key={task.id} size="small">
                    <Flex align="start" justify="space-between" gap={12} wrap>
                      <div>
                        <Text strong>{task.subject}</Text>
                        <br />
                        <Text type="secondary">
                          {humanize(task.type)} ·{" "}
                          <AccountIdentity
                            accountId={task.assignee_account_id}
                            names={names}
                          />
                        </Text>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <Tag
                          color={
                            task.priority === "urgent"
                              ? "red"
                              : task.priority === "high"
                                ? "orange"
                                : "default"
                          }
                        >
                          {humanize(task.priority)}
                        </Tag>
                        <br />
                        <Text
                          type={
                            new Date(task.due_at) < new Date()
                              ? "danger"
                              : "secondary"
                          }
                        >
                          Due <TimeAgo date={task.due_at} />
                        </Text>
                      </div>
                    </Flex>
                  </Card>
                ))}
            </Flex>
            {!customer.tasks.some((task) =>
              ["open", "waiting"].includes(task.state),
            ) ? (
              <Empty description="No open follow-up" />
            ) : null}
          </Card>

          <Card className="crm-section-card">
            <SectionHeader
              action="Link system"
              icon="link"
              onAction={() =>
                onAction({ kind: "link", title: "Link an external system" })
              }
            >
              Commercial and support systems
            </SectionHeader>
            <Divider />
            <Row gutter={[12, 12]}>
              <Col xs={24} md={12}>
                <Title level={5}>Commercial orders</Title>
                {customer.commercial_orders.map((order: any) => (
                  <Card key={order.id} size="small" style={{ marginBottom: 8 }}>
                    <Text strong>{order.order_number}</Text>
                    <br />
                    <Text>
                      {money(order.agreed_total, order.currency)}
                    </Text> · <Tag>{humanize(order.collection_state)}</Tag>
                  </Card>
                ))}
                {!customer.commercial_orders.length ? (
                  <Text type="secondary">None linked</Text>
                ) : null}
              </Col>
              <Col xs={24} md={12}>
                <Title level={5}>Site licenses</Title>
                {customer.site_licenses.map((license: any) => (
                  <Card
                    key={license.id}
                    size="small"
                    style={{ marginBottom: 8 }}
                  >
                    <Text strong>{license.name}</Text>
                    <br />
                    <Text type="secondary">
                      {license.allowed_domains?.join(", ") || "No domains"}
                    </Text>
                    {license.pools?.length ? (
                      <Flex gap={4} style={{ marginTop: 6 }} wrap>
                        {license.pools.map((pool: any) => (
                          <Tag key={pool.id}>
                            {pool.pool_name || humanize(pool.membership_class)}{" "}
                            · {pool.seat_count} seats
                          </Tag>
                        ))}
                      </Flex>
                    ) : null}
                  </Card>
                ))}
                {!customer.site_licenses.length ? (
                  <Text type="secondary">None linked</Text>
                ) : null}
              </Col>
            </Row>
            <Divider />
            <Flex gap={6} wrap>
              {customer.external_references.map((reference) =>
                reference.provider === "zendesk" &&
                reference.object_kind === "ticket" ? (
                  <ZendeskReference key={reference.id} reference={reference} />
                ) : (
                  <Tag
                    key={reference.id}
                    color={
                      reference.verification_state === "verified"
                        ? "green"
                        : "default"
                    }
                  >
                    <Icon name="external-link" /> {reference.provider}:{" "}
                    {reference.label || reference.external_id}
                  </Tag>
                ),
              )}
            </Flex>
          </Card>

          <CustomerOutreachCard
            onOpenOutreach={onOpenOutreach}
            organization={organization.id}
          />
        </Flex>

        <Flex vertical gap={14} style={{ minWidth: 0 }}>
          <Card className="crm-section-card">
            <SectionHeader icon="address-card">Relationship</SectionHeader>
            <Divider />
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Owner">
                <AccountIdentity
                  accountId={organization.relationship_owner_account_id}
                  names={names}
                  unknownLabel="Unassigned"
                />
              </Descriptions.Item>
              <Descriptions.Item label="Legal name">
                {organization.legal_name || "Not recorded"}
              </Descriptions.Item>
              <Descriptions.Item label="Aliases">
                {organization.aliases.length
                  ? organization.aliases.join(", ")
                  : "None"}
              </Descriptions.Item>
              <Descriptions.Item label="Parent customer">
                {customer.parent_organization
                  ? `${customer.parent_organization.display_name} (${customer.parent_organization.customer_number})`
                  : "None"}
              </Descriptions.Item>
              <Descriptions.Item label="Website">
                {websiteUrl ? (
                  <a href={websiteUrl} rel="noreferrer" target="_blank">
                    {organization.website} <Icon name="external-link" />
                  </a>
                ) : (
                  organization.website || "Not recorded"
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Updated">
                <TimeAgo date={organization.updated_at} />
              </Descriptions.Item>
            </Descriptions>
            <Divider />
            <Button
              block
              onClick={() =>
                onAction({
                  kind: "add-domain",
                  title: "Add institutional domain",
                })
              }
            >
              Add domain
            </Button>
          </Card>

          <Card className="crm-section-card">
            <SectionHeader
              action="Add note"
              icon="history"
              onAction={() =>
                onAction({ kind: "add-note", title: "Add timeline note" })
              }
            >
              Timeline
            </SectionHeader>
            <Divider />
            {customer.activities.length ? (
              <Flex vertical gap={12}>
                <TimelineFilter
                  matchingCount={filteredActivities.length}
                  onChange={setTimelineFilter}
                  totalCount={customer.activities.length}
                  value={timelineFilter}
                  visibleCount={visibleActivities.length}
                />
                {visibleActivities.length ? (
                  <div className="crm-activity-rail">
                    {visibleActivities.map((activity) => (
                      <div className="crm-activity-item" key={activity.id}>
                        <Text strong>{activity.summary}</Text>
                        <br />
                        <Text type="secondary">
                          {humanize(activity.kind)} ·{" "}
                          <TimeAgo date={activity.occurred_at} />
                        </Text>
                        {activity.details ? (
                          <Paragraph
                            ellipsis={{ rows: 3, expandable: true }}
                            style={{ margin: "6px 0 0" }}
                          >
                            {activity.details}
                          </Paragraph>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty description="No timeline events match this filter" />
                )}
              </Flex>
            ) : (
              <Empty description="No customer activity" />
            )}
          </Card>

          <Card
            className="crm-section-card"
            style={{ borderColor: COLORS.GRAY_L }}
          >
            <SectionHeader icon="lock">Record controls</SectionHeader>
            <Divider />
            <Flex vertical gap={8}>
              <Button
                onClick={() =>
                  onAction({ kind: "merge", title: "Merge duplicate customer" })
                }
              >
                Merge duplicate
              </Button>
              <Button
                danger
                onClick={() =>
                  onAction({ kind: "archive", title: "Archive customer" })
                }
              >
                Archive customer
              </Button>
            </Flex>
          </Card>
        </Flex>
      </div>
    </Flex>
  );
}

export function CustomersAdmin({
  customerId,
  onBack,
  onOpenCustomer,
}: {
  customerId?: string;
  onBack: () => void;
  onOpenCustomer: (id: string) => void;
}) {
  const [action, setAction] = useState<ActionState | null>(null);
  const [detail, setDetail] = useState<CrmCustomer360 | undefined>();
  const [reloadKey, setReloadKey] = useState(0);
  const [workspace, setWorkspace] = useState<"relationships" | "outreach">(
    "relationships",
  );
  const [outreachOrganization, setOutreachOrganization] = useState<string>();
  const [outreachView, setOutreachView] = useState<QueueView>("deliveries");
  const [outreachStartNewKey, setOutreachStartNewKey] = useState(0);

  useEffect(() => {
    if (!customerId) {
      setDetail(undefined);
      return;
    }
    let cancelled = false;
    void webapp_client.conat_client.hub.adminCrm
      .getOrganization({
        organization: customerId,
        reason: "Prepare CRM customer action",
        activity_limit: 20,
      })
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [customerId, reloadKey]);

  async function committed(organizationId?: string) {
    setReloadKey((value) => value + 1);
    if (!customerId && organizationId) onOpenCustomer(organizationId);
  }

  return (
    <>
      <Flex vertical gap={14}>
        <Segmented
          aria-label="Customer administration workspace"
          onChange={(value) => {
            const next = value as "relationships" | "outreach";
            if (next === "outreach" && customerId)
              setOutreachOrganization(customerId);
            setWorkspace(next);
          }}
          options={[
            {
              label: (
                <Space>
                  <Icon name="address-card" /> Relationships
                </Space>
              ),
              value: "relationships",
            },
            {
              label: (
                <Space>
                  <Icon name="paper-plane" /> Outreach
                </Space>
              ),
              value: "outreach",
            },
          ]}
          value={workspace}
        />
        {workspace === "outreach" ? (
          <OutreachAdmin
            initialOrganization={outreachOrganization}
            initialView={outreachView}
            startNewKey={outreachStartNewKey}
          />
        ) : customerId ? (
          <CustomerDetail
            key={`${customerId}:${reloadKey}`}
            customerId={customerId}
            onAction={setAction}
            onBack={onBack}
            onOpenOutreach={(create, view) => {
              setOutreachOrganization(customerId);
              setOutreachView(view ?? "deliveries");
              if (create) setOutreachStartNewKey((value) => value + 1);
              setWorkspace("outreach");
            }}
          />
        ) : (
          <CustomerQueue
            onCreate={() =>
              setAction({ kind: "create-customer", title: "Create customer" })
            }
            onOpen={onOpenCustomer}
          />
        )}
      </Flex>
      <CustomerActionModal
        action={action}
        customer={detail}
        onClose={() => setAction(null)}
        onCommitted={committed}
      />
    </>
  );
}
