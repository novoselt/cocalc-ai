/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Typography,
  message,
  type TableColumnsType,
} from "antd";
import { useEffect, useState } from "react";

import { Icon, type IconName, TimeAgo } from "@cocalc/frontend/components";
import {
  FreshAuthModal,
  useFreshAuthAction,
} from "@cocalc/frontend/auth/fresh-auth";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import {
  COMMERCIAL_COLLECTION_STATES,
  COMMERCIAL_FULFILLMENT_STATES,
  COMMERCIAL_WORKFLOW_STATES,
  type CommercialCollectionState,
  type CommercialFulfillmentState,
  type CommercialOrderDiagnostics,
  type CommercialOrderSummary,
  type CommercialWorkflowState,
} from "@cocalc/util/commercial-orders";
import { COLORS } from "@cocalc/util/theme";
import {
  COLLECTION_LABELS,
  ExternalLink,
  FULFILLMENT_LABELS,
  formatDate,
  formatMoney,
  formatReceivablesError,
  formatShortId,
  humanizeKey,
  IndependentStateAlerts,
  StateTriplet,
  WORKFLOW_LABELS,
} from "./shared";
import { AccountIdentity, loadAccountDisplayNames } from "./account-names";
import { AccountSelector } from "./account-selector";
import "./receivables.css";

const { Paragraph, Text, Title } = Typography;

type SavedView =
  | "needs-action"
  | "unassigned"
  | "awaiting-customer"
  | "ready-to-invoice"
  | "open-invoices"
  | "overdue"
  | "paid-not-provisioned"
  | "provisioned-not-paid"
  | "stale-next-action"
  | "completed"
  | "all";

interface QueueFilters {
  search: string;
  organization: string;
  assignee: string;
  unassigned: boolean;
  workflowStates: CommercialWorkflowState[];
  collectionStates: CommercialCollectionState[];
  fulfillmentStates: CommercialFulfillmentState[];
  minAmount?: number | null;
  maxAmount?: number | null;
}

const EMPTY_FILTERS: QueueFilters = {
  search: "",
  organization: "",
  assignee: "",
  unassigned: false,
  workflowStates: [],
  collectionStates: [],
  fulfillmentStates: [],
};

const SAVED_VIEW_OPTIONS: Array<{ label: string; value: SavedView }> = [
  { value: "needs-action", label: "Needs action" },
  { value: "unassigned", label: "Unassigned" },
  { value: "awaiting-customer", label: "Awaiting customer" },
  { value: "ready-to-invoice", label: "Ready to invoice" },
  { value: "open-invoices", label: "Open invoices" },
  { value: "overdue", label: "Overdue" },
  { value: "paid-not-provisioned", label: "Paid but not provisioned" },
  { value: "provisioned-not-paid", label: "Provisioned but not paid" },
  { value: "stale-next-action", label: "Stale next action" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
];

const UNPAID_COLLECTION_STATES: CommercialCollectionState[] = [
  "not_invoiced",
  "draft_invoice",
  "open",
  "partially_paid",
  "overdue",
  "void",
  "uncollectible",
];

function savedViewRequest(view: SavedView) {
  switch (view) {
    case "needs-action":
      return { needs_action: true };
    case "unassigned":
      return { assignee_account_id: null, needs_action: true };
    case "awaiting-customer":
      return {
        workflow_states: ["awaiting_customer"] as CommercialWorkflowState[],
      };
    case "ready-to-invoice":
      return {
        workflow_states: ["ready_to_invoice"] as CommercialWorkflowState[],
      };
    case "open-invoices":
      return {
        collection_states: [
          "open",
          "partially_paid",
        ] as CommercialCollectionState[],
      };
    case "overdue":
      return {
        collection_states: ["overdue"] as CommercialCollectionState[],
      };
    case "paid-not-provisioned":
      return {
        collection_states: ["paid"] as CommercialCollectionState[],
        fulfillment_states: ["not_provisioned"] as CommercialFulfillmentState[],
      };
    case "provisioned-not-paid":
      return {
        collection_states: UNPAID_COLLECTION_STATES,
        fulfillment_states: ["provisioned"] as CommercialFulfillmentState[],
      };
    case "stale-next-action":
      return {
        needs_action: true,
        next_action_due_before: new Date().toISOString(),
      };
    case "completed":
      return {
        workflow_states: ["complete"] as CommercialWorkflowState[],
      };
    case "all":
      return {};
  }
}

function metricValue(value: number | undefined): string {
  return new Intl.NumberFormat().format(value ?? 0);
}

function invoiceTiming(order: CommercialOrderSummary): string | undefined {
  const due = order.latest_invoice_due_at
    ? new Date(order.latest_invoice_due_at).getTime()
    : undefined;
  if (
    due != null &&
    due < Date.now() &&
    order.latest_invoice_status === "open"
  ) {
    const days = Math.max(1, Math.floor((Date.now() - due) / 86_400_000));
    return `${days} day${days === 1 ? "" : "s"} overdue`;
  }
  const started =
    order.latest_invoice_sent_at ?? order.latest_invoice_created_at;
  if (!started) return;
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(started).getTime()) / 86_400_000),
  );
  return `Invoice age: ${days} day${days === 1 ? "" : "s"}`;
}

function DiagnosticSummary({
  diagnostics,
}: {
  diagnostics: CommercialOrderDiagnostics;
}) {
  const metrics = [
    {
      label: "Open orders",
      value: metricValue(diagnostics.counts.open_orders),
      detail: formatMoney(diagnostics.amounts.open_amount ?? "0", "usd"),
      icon: "shopping-cart" as IconName,
    },
    {
      label: "Unassigned",
      value: metricValue(diagnostics.counts.unassigned),
      detail: "Open orders without an owner",
      icon: "users" as IconName,
    },
    {
      label: "Overdue",
      value: metricValue(diagnostics.counts.overdue),
      detail: formatMoney(diagnostics.amounts.overdue_amount ?? "0", "usd"),
      icon: "clock" as IconName,
    },
    {
      label: "Paid, not provisioned",
      value: metricValue(diagnostics.counts.paid_not_provisioned),
      detail: "Requires fulfillment",
      icon: "server" as IconName,
    },
    {
      label: "Provisioned, not paid",
      value: metricValue(diagnostics.counts.provisioned_not_paid),
      detail: formatMoney(
        diagnostics.amounts.fulfilled_unpaid_amount ?? "0",
        "usd",
      ),
      icon: "credit-card" as IconName,
    },
  ];
  return (
    <div
      className="receivables-summary-grid"
      aria-label="Accounts receivable summary"
    >
      {metrics.map(({ label, value, detail, icon }) => (
        <Card className="receivables-metric-card" key={label} size="small">
          <Flex align="flex-start" gap={10}>
            <Icon
              className="receivables-metric-icon"
              name={icon}
              style={{ color: COLORS.FEATURE_TEAL }}
            />
            <div>
              <Statistic title={label} value={value} />
              <Text className="receivables-metric-detail">{detail}</Text>
            </div>
          </Flex>
        </Card>
      ))}
    </div>
  );
}

export function ReceivablesQueue({
  onCreateOrder,
  onOpenOrder,
}: {
  onCreateOrder: () => void;
  onOpenOrder: (id: string) => void;
}) {
  const api = webapp_client.conat_client.hub.commercialOrders;
  const [orders, setOrders] = useState<CommercialOrderSummary[]>([]);
  const [assigneeNames, setAssigneeNames] = useState<Record<string, string>>(
    {},
  );
  const [diagnostics, setDiagnostics] =
    useState<CommercialOrderDiagnostics | null>(null);
  const [savedView, setSavedView] = useState<SavedView>("needs-action");
  const [draftFilters, setDraftFilters] = useState<QueueFilters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<QueueFilters>(EMPTY_FILTERS);
  const [cursor, setCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>(
    [],
  );
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryEvent, setRetryEvent] = useState<{
    event_id: string;
    attempt_count: number;
  } | null>(null);
  const [retryReason, setRetryReason] = useState("");
  const [retryReviewed, setRetryReviewed] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction();

  async function retryStripeEvent() {
    if (!retryEvent || !retryReviewed || retryReason.trim().length < 4) return;
    setRetryBusy(true);
    try {
      const completed = await runFreshAuthAction(async () => {
        await api.retryStripeEvent({
          event_id: retryEvent.event_id,
          reason: retryReason.trim(),
          source: "admin-ui",
          idempotency_key: `admin-ui:stripe-event-retry:${retryEvent.event_id}:attempt-${retryEvent.attempt_count}`,
        });
      });
      if (!completed) return;
      message.success("Stripe event requeued");
      setRetryEvent(null);
      setRetryReason("");
      setRetryReviewed(false);
      await loadDiagnostics();
    } catch (err) {
      setError(formatReceivablesError(err));
    } finally {
      setRetryBusy(false);
    }
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const assignee = filters.assignee.trim();
      const request = {
        ...savedViewRequest(savedView),
        reason: "Review accounts receivable queue",
        cursor,
        limit: 100,
        search: filters.search.trim() || undefined,
        organization: filters.organization.trim() || undefined,
        assignee_account_id: filters.unassigned ? null : assignee || undefined,
        workflow_states: filters.workflowStates.length
          ? filters.workflowStates
          : savedViewRequest(savedView).workflow_states,
        collection_states: filters.collectionStates.length
          ? filters.collectionStates
          : savedViewRequest(savedView).collection_states,
        fulfillment_states: filters.fulfillmentStates.length
          ? filters.fulfillmentStates
          : savedViewRequest(savedView).fulfillment_states,
        min_amount:
          filters.minAmount == null ? undefined : `${filters.minAmount}`,
        max_amount:
          filters.maxAmount == null ? undefined : `${filters.maxAmount}`,
      };
      const response = await api.list(request);
      setOrders(response.orders);
      const accountIds = [
        ...new Set(
          response.orders
            .map(({ assignee_account_id }) => assignee_account_id)
            .filter((id): id is string => !!id),
        ),
      ];
      if (accountIds.length) {
        try {
          setAssigneeNames(await loadAccountDisplayNames(accountIds));
        } catch {
          setAssigneeNames({});
        }
      } else {
        setAssigneeNames({});
      }
      setNextCursor(response.next_cursor);
    } catch (err) {
      setError(formatReceivablesError(err));
      setOrders([]);
      setNextCursor(undefined);
    } finally {
      setLoading(false);
    }
  }

  async function loadDiagnostics() {
    try {
      setDiagnostics(
        await api.diagnostics({
          reason: "Review accounts receivable operational diagnostics",
        }),
      );
    } catch (err) {
      setError((current) => current || formatReceivablesError(err));
    }
  }

  useEffect(() => {
    void load();
  }, [savedView, filters, cursor]);

  useEffect(() => {
    void loadDiagnostics();
  }, []);

  function applyFilters() {
    setCursor(undefined);
    setCursorHistory([]);
    setFilters({ ...draftFilters });
  }

  function resetFilters() {
    setCursor(undefined);
    setCursorHistory([]);
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
  }

  function selectSavedView(value: SavedView) {
    setSavedView(value);
    setCursor(undefined);
    setCursorHistory([]);
  }

  function previousPage() {
    const history = [...cursorHistory];
    setCursor(history.pop());
    setCursorHistory(history);
  }

  function nextPage() {
    if (!nextCursor) return;
    setCursorHistory((history) => [...history, cursor]);
    setCursor(nextCursor);
  }

  const columns: TableColumnsType<CommercialOrderSummary> = [
    {
      title: "Order",
      key: "order",
      width: 230,
      render: (_, order) => (
        <Space orientation="vertical" size={0}>
          <Text strong>{order.order_number}</Text>
          <Text>{order.organization_name}</Text>
          {order.billing_email ? (
            <Text type="secondary">{order.billing_email}</Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "Amount",
      key: "amount",
      width: 130,
      render: (_, order) => formatMoney(order.agreed_total, order.currency),
    },
    {
      title: "Independent states",
      key: "states",
      width: 230,
      render: (_, order) => <StateTriplet order={order} compact />,
    },
    {
      title: "Owner and next action",
      key: "action",
      width: 280,
      render: (_, order) => (
        <Space orientation="vertical" size={0}>
          <Text>
            Assignee:{" "}
            <AccountIdentity
              accountId={order.assignee_account_id}
              names={assigneeNames}
              unknownLabel="Unassigned"
            />
          </Text>
          <Text>{order.next_action || "No next action recorded"}</Text>
          <Text type="secondary">
            Due: {formatDate(order.next_action_due_at)}
          </Text>
        </Space>
      ),
    },
    {
      title: "Linked records",
      key: "links",
      width: 210,
      render: (_, order) => (
        <Space orientation="vertical" size={0}>
          {order.zendesk_ticket_ids.map((ticketId) => (
            <ExternalLink
              key={ticketId}
              href={`https://sagemathcloud.zendesk.com/agent/tickets/${ticketId}`}
            >
              Zendesk ticket {ticketId} (external)
            </ExternalLink>
          ))}
          <Text>
            Site license:{" "}
            {order.site_license_id
              ? formatShortId(order.site_license_id)
              : "Not linked"}
          </Text>
          <Text>Invoice: {order.latest_invoice_status ?? "Not created"}</Text>
          {order.latest_invoice_amount_due ? (
            <Text>
              Due:{" "}
              {formatMoney(order.latest_invoice_amount_due, order.currency)}
            </Text>
          ) : null}
          {invoiceTiming(order) ? (
            <Text
              type={
                order.collection_state === "overdue" ? "danger" : "secondary"
              }
            >
              {invoiceTiming(order)}
            </Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "Activity",
      key: "activity",
      width: 130,
      render: (_, order) => <TimeAgo date={order.last_activity_at} />,
    },
    {
      title: "Actions",
      key: "actions",
      fixed: "right",
      width: 72,
      align: "center",
      render: (_, order) => (
        <Button
          size="small"
          type="link"
          aria-label={`Open ${order.order_number}`}
          onClick={() => onOpenOrder(order.id)}
          style={{ paddingInline: 4 }}
        >
          Open
        </Button>
      ),
    },
  ];

  return (
    <Flex className="receivables-shell" vertical gap={18}>
      <section
        className="receivables-hero"
        aria-labelledby="receivables-queue-title"
      >
        <Flex align="center" gap={20} justify="space-between" wrap>
          <div className="receivables-hero-copy">
            <div className="receivables-eyebrow">Commercial operations</div>
            <Title
              id="receivables-queue-title"
              level={2}
              style={{ margin: "8px 0" }}
            >
              Every invoice, payment, and promise in one queue
            </Title>
            <Paragraph style={{ fontSize: 16, marginBottom: 0 }}>
              Track negotiated terms, collection, and fulfillment independently
              so every order has an owner and early provisioning is never
              mistaken for payment.
            </Paragraph>
          </div>
          <Space wrap>
            <Button
              aria-label="Operations runbook"
              ghost
              href="/app-docs/admin/accounts-receivable"
              icon={<Icon name="book" />}
              size="large"
            >
              Operations runbook
            </Button>
            <Button
              aria-label="Create commercial order"
              icon={<Icon name="plus" />}
              onClick={onCreateOrder}
              size="large"
            >
              Create commercial order
            </Button>
          </Space>
        </Flex>
      </section>

      {diagnostics ? <DiagnosticSummary diagnostics={diagnostics} /> : null}

      <Card
        className="receivables-filter-card"
        size="small"
        title="Queue filters"
      >
        <Form layout="vertical" onFinish={applyFilters}>
          <div
            style={{
              display: "grid",
              gap: "0 12px",
              gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            }}
          >
            <Form.Item label="Views" htmlFor="receivables-saved-view">
              <Select
                id="receivables-saved-view"
                value={savedView}
                onChange={selectSavedView}
                options={SAVED_VIEW_OPTIONS}
              />
            </Form.Item>
            <Form.Item
              label="Search orders, organizations, PO, or reference"
              htmlFor="receivables-search"
            >
              <Input
                id="receivables-search"
                value={draftFilters.search}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    search: event.target.value,
                  }))
                }
              />
            </Form.Item>
            <Form.Item label="Organization" htmlFor="receivables-organization">
              <Input
                id="receivables-organization"
                value={draftFilters.organization}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    organization: event.target.value,
                  }))
                }
              />
            </Form.Item>
            <Form.Item label="Assignee">
              <AccountSelector
                accountKind="admin"
                disabled={draftFilters.unassigned}
                value={draftFilters.assignee}
                onChange={(assignee) =>
                  setDraftFilters((current) => ({
                    ...current,
                    assignee: assignee ?? "",
                  }))
                }
              />
            </Form.Item>
            <Form.Item
              label="Workflow states"
              htmlFor="receivables-workflow-states"
            >
              <Select
                id="receivables-workflow-states"
                mode="multiple"
                value={draftFilters.workflowStates}
                onChange={(workflowStates) =>
                  setDraftFilters((current) => ({
                    ...current,
                    workflowStates,
                  }))
                }
                options={COMMERCIAL_WORKFLOW_STATES.map((value) => ({
                  value,
                  label: WORKFLOW_LABELS[value],
                }))}
              />
            </Form.Item>
            <Form.Item
              label="Collection states"
              htmlFor="receivables-collection-states"
            >
              <Select
                id="receivables-collection-states"
                mode="multiple"
                value={draftFilters.collectionStates}
                onChange={(collectionStates) =>
                  setDraftFilters((current) => ({
                    ...current,
                    collectionStates,
                  }))
                }
                options={COMMERCIAL_COLLECTION_STATES.map((value) => ({
                  value,
                  label: COLLECTION_LABELS[value],
                }))}
              />
            </Form.Item>
            <Form.Item
              label="Fulfillment states"
              htmlFor="receivables-fulfillment-states"
            >
              <Select
                id="receivables-fulfillment-states"
                mode="multiple"
                value={draftFilters.fulfillmentStates}
                onChange={(fulfillmentStates) =>
                  setDraftFilters((current) => ({
                    ...current,
                    fulfillmentStates,
                  }))
                }
                options={COMMERCIAL_FULFILLMENT_STATES.map((value) => ({
                  value,
                  label: FULFILLMENT_LABELS[value],
                }))}
              />
            </Form.Item>
            <Form.Item
              label="Minimum amount"
              htmlFor="receivables-minimum-amount"
            >
              <InputNumber
                id="receivables-minimum-amount"
                min={0}
                precision={2}
                style={{ width: "100%" }}
                value={draftFilters.minAmount}
                onChange={(minAmount) =>
                  setDraftFilters((current) => ({
                    ...current,
                    minAmount,
                  }))
                }
              />
            </Form.Item>
            <Form.Item
              label="Maximum amount"
              htmlFor="receivables-maximum-amount"
            >
              <InputNumber
                id="receivables-maximum-amount"
                min={0}
                precision={2}
                style={{ width: "100%" }}
                value={draftFilters.maxAmount}
                onChange={(maxAmount) =>
                  setDraftFilters((current) => ({
                    ...current,
                    maxAmount,
                  }))
                }
              />
            </Form.Item>
          </div>
          <Flex align="center" gap="middle" wrap>
            <Checkbox
              checked={draftFilters.unassigned}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  unassigned: event.target.checked,
                }))
              }
            >
              Only unassigned orders
            </Checkbox>
            <Button type="primary" htmlType="submit">
              Apply filters
            </Button>
            <Button onClick={resetFilters}>Reset filters</Button>
            <Button
              icon={<Icon name="refresh" />}
              onClick={() => {
                void load();
                void loadDiagnostics();
              }}
            >
              Refresh queue
            </Button>
          </Flex>
        </Form>
      </Card>

      {error ? (
        <Alert showIcon type="error" title="Queue error" description={error} />
      ) : null}

      <div aria-live="polite" aria-busy={loading}>
        {loading ? (
          <Flex justify="center" style={{ padding: 32 }}>
            <Spin description="Loading accounts receivable orders" />
          </Flex>
        ) : orders.length === 0 ? (
          <Empty description="No commercial orders match this queue view" />
        ) : (
          <>
            <Table
              aria-label="Accounts receivable orders"
              columns={columns}
              dataSource={orders}
              pagination={false}
              rowKey="id"
              scroll={{ x: 1252 }}
              size="small"
              expandable={{
                expandedRowRender: (order) => (
                  <IndependentStateAlerts order={order} />
                ),
                rowExpandable: (order) =>
                  (order.fulfillment_state === "provisioned" &&
                    !["paid", "waived"].includes(order.collection_state)) ||
                  (order.collection_state === "paid" &&
                    order.fulfillment_state === "not_provisioned"),
              }}
            />
            <Flex justify="space-between" align="center" gap="middle" wrap>
              <Text type="secondary">
                Showing {orders.length} order{orders.length === 1 ? "" : "s"}
              </Text>
              <Space>
                <Button
                  disabled={cursorHistory.length === 0}
                  onClick={previousPage}
                >
                  Previous page
                </Button>
                <Button disabled={!nextCursor} onClick={nextPage}>
                  Next page
                </Button>
              </Space>
            </Flex>
          </>
        )}
      </div>

      {diagnostics ? (
        <Collapse
          items={[
            {
              key: "diagnostics",
              label: "Operational diagnostics",
              children: (
                <Flex vertical gap="middle">
                  <Text>
                    Generated {formatDate(diagnostics.generated_at)}.
                    Diagnostics are read-only; invoice reconciliation is an
                    explicit, fresh-authenticated action on an order.
                  </Text>
                  <div>
                    <Text strong>All counts</Text>
                    <ul>
                      {Object.entries(diagnostics.counts).map(
                        ([key, value]) => (
                          <li key={key}>
                            {humanizeKey(key)}: {metricValue(value)}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                  <div>
                    <Text strong>All amounts</Text>
                    <ul>
                      {Object.entries(diagnostics.amounts).map(
                        ([key, value]) => (
                          <li key={key}>
                            {humanizeKey(key)}: {formatMoney(value, "usd")}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                  <div>
                    <Text strong>Stale invoice IDs</Text>
                    {diagnostics.stale_invoice_ids.length ? (
                      <ul>
                        {diagnostics.stale_invoice_ids.map((id) => (
                          <li key={id}>{id}</li>
                        ))}
                      </ul>
                    ) : (
                      <Paragraph>None.</Paragraph>
                    )}
                  </div>
                  <div>
                    <Text strong>Inconsistent orders</Text>
                    {diagnostics.inconsistent_order_ids.length ? (
                      <Flex gap="small" wrap style={{ marginTop: 8 }}>
                        {diagnostics.inconsistent_order_ids.map((id) => (
                          <Button key={id} onClick={() => onOpenOrder(id)}>
                            Inspect {formatShortId(id)}
                          </Button>
                        ))}
                      </Flex>
                    ) : (
                      <Paragraph>None.</Paragraph>
                    )}
                  </div>
                  {diagnostics.review_queues ? (
                    <div>
                      <Text strong>Explicit review queues</Text>
                      <Paragraph type="secondary">
                        Opening diagnostics does not automatically repair these
                        records.
                      </Paragraph>
                      {Object.values(
                        diagnostics.review_queues.truncated ?? {},
                      ).some(Boolean) ? (
                        <Alert
                          type="warning"
                          showIcon
                          title="One or more diagnostic queues exceed the 500-record display cap. Narrow the queue or use the CLI export before acting."
                          style={{ marginBottom: 12 }}
                        />
                      ) : null}
                      <Space orientation="vertical" style={{ width: "100%" }}>
                        <DiagnosticIdList
                          label="Active commercial site licenses without an order"
                          ids={
                            diagnostics.review_queues
                              .active_commercial_site_license_ids
                          }
                        />
                        <div>
                          <Text>
                            Unlinked commercial Stripe invoices:{" "}
                            {
                              diagnostics.review_queues
                                .unlinked_commercial_stripe_invoices.length
                            }
                          </Text>
                          {diagnostics.review_queues
                            .unlinked_commercial_stripe_invoices.length ? (
                            <ul style={{ marginBottom: 0 }}>
                              {diagnostics.review_queues.unlinked_commercial_stripe_invoices.map(
                                (invoice) => (
                                  <li key={invoice.provider_invoice_id}>
                                    {invoice.provider_invoice_id} (
                                    {invoice.status},{" "}
                                    {formatMoney(
                                      invoice.amount_due,
                                      invoice.currency,
                                    )}
                                    )
                                  </li>
                                ),
                              )}
                            </ul>
                          ) : null}
                        </div>
                        <div>
                          <Text>
                            Failed or dead-lettered Stripe events:{" "}
                            {
                              diagnostics.review_queues.failed_stripe_events
                                .length
                            }
                          </Text>
                          <Flex gap="small" wrap style={{ marginTop: 8 }}>
                            {diagnostics.review_queues.failed_stripe_events.map(
                              (event) => (
                                <Button
                                  key={event.event_id}
                                  danger={event.status === "dead_letter"}
                                  onClick={() => {
                                    setRetryEvent(event);
                                    setRetryReason("");
                                    setRetryReviewed(false);
                                  }}
                                >
                                  Review {event.event_id}
                                </Button>
                              ),
                            )}
                          </Flex>
                        </div>
                        <DiagnosticIdList
                          label="Indeterminate provider operations"
                          ids={
                            diagnostics.review_queues
                              .indeterminate_provider_operation_ids
                          }
                        />
                        <div>
                          <Text>
                            Open orders missing a next-action due date:{" "}
                            {
                              diagnostics.review_queues
                                .open_orders_missing_due_date_ids.length
                            }
                          </Text>
                          {diagnostics.review_queues
                            .open_orders_missing_due_date_ids.length ? (
                            <Flex gap="small" wrap style={{ marginTop: 8 }}>
                              {diagnostics.review_queues.open_orders_missing_due_date_ids.map(
                                (id) => (
                                  <Button
                                    key={id}
                                    onClick={() => onOpenOrder(id)}
                                  >
                                    Inspect {formatShortId(id)}
                                  </Button>
                                ),
                              )}
                            </Flex>
                          ) : null}
                        </div>
                      </Space>
                    </div>
                  ) : null}
                </Flex>
              ),
            },
          ]}
        />
      ) : null}
      <Modal
        title="Review failed Stripe event retry"
        open={retryEvent != null}
        onCancel={() => setRetryEvent(null)}
        onOk={() => void retryStripeEvent()}
        okText="Retry after fresh authentication"
        okButtonProps={{
          disabled: !retryReviewed || retryReason.trim().length < 4,
          loading: retryBusy,
        }}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          title="Retry only after reviewing the recorded failure and correcting its cause."
          style={{ marginBottom: 12 }}
        />
        <Paragraph>Stripe event: {retryEvent?.event_id}</Paragraph>
        <Input.TextArea
          aria-label="Stripe event retry audit reason"
          value={retryReason}
          onChange={(event) => setRetryReason(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Why this event is now safe to retry"
        />
        <Checkbox
          checked={retryReviewed}
          onChange={(event) => setRetryReviewed(event.target.checked)}
          style={{ marginTop: 12 }}
        >
          I reviewed the failure, order, invoice, and provider state.
        </Checkbox>
      </Modal>
      <FreshAuthModal {...freshAuthModalProps} />
    </Flex>
  );
}

function DiagnosticIdList({ label, ids }: { label: string; ids: string[] }) {
  return (
    <div>
      <Text>
        {label}: {ids.length}
      </Text>
      {ids.length ? (
        <ul style={{ marginBottom: 0 }}>
          {ids.map((id) => (
            <li key={id}>{id}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
