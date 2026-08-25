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
  Descriptions,
  Divider,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Timeline,
  Typography,
  message,
  type TableColumnsType,
} from "antd";
import { useEffect, useState } from "react";

import type { AdminSupportTicketSummary } from "@cocalc/conat/hub/api/admin-support";
import type {
  CommercialFulfillmentPlan,
  CommercialInvoicePreview,
  CommercialReconcilePreview,
} from "@cocalc/conat/hub/api/commercial-orders";
import {
  FreshAuthModal,
  useFreshAuthAction,
} from "@cocalc/frontend/auth/fresh-auth";
import { ErrorDisplay, Icon, TimeAgo } from "@cocalc/frontend/components";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import {
  COMMERCIAL_PAYMENT_METHODS,
  COMMERCIAL_NEXT_ACTIONS,
  type CommercialInvoice,
  type CommercialOrder,
  type CommercialOrderContact,
  type CommercialOrderEvent,
  type CommercialOrderItem,
  type CommercialPayment,
  type CommercialPaymentMethod,
} from "@cocalc/util/commercial-orders";
import {
  ExternalLink,
  formatDate,
  formatMoney,
  formatReceivablesError,
  formatShortId,
  humanizeKey,
  IndependentStateAlerts,
  StateTriplet,
} from "./shared";
import { CommercialOrderEditModal } from "./create";
import { AccountIdentity, useAccountDisplayNames } from "./account-names";
import { SiteLicenseReference } from "./site-license-reference";
import { AccountSelector } from "./account-selector";
import "./receivables.css";

const { Paragraph, Text, Title } = Typography;

interface ReasonAction {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (reason: string) => Promise<boolean>;
}

type ActionError = string | { message: string; details: string };

function formatActionError(error: unknown): ActionError {
  const details = `${error}`;
  const remainingBalance = details.match(
    /out-of-band Stripe invoice settlement must equal the remaining balance\s+([0-9.]+)/i,
  )?.[1];
  if (remainingBalance != null) {
    const balance = Number(remainingBalance);
    return {
      message:
        balance === 0
          ? "This Stripe invoice is already fully paid, so no additional manual payment can be recorded."
          : `The manual payment must equal the invoice's full remaining balance (${balance.toFixed(2)}). Return to edit and enter that amount.`,
      details,
    };
  }
  if (details.toLowerCase().includes("version")) {
    return {
      message:
        "This order changed elsewhere. Refresh it before retrying the action.",
      details,
    };
  }
  return details;
}

interface ManualInvoiceFormValues {
  invoice_reference: string;
  due_at?: string;
  document_url?: string;
  evidence_reference?: string;
  reason: string;
}

interface ManualPaymentFormValues {
  amount: string;
  currency: string;
  method: CommercialPaymentMethod;
  received_at?: string;
  commercial_invoice_id?: string;
  evidence_reference: string;
  reason: string;
}

function invoiceReference(invoice: CommercialInvoice): string | undefined {
  const value = invoice.provider_snapshot.invoice_reference;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function mutationFields(
  action: string,
  order: CommercialOrder,
  reason: string,
) {
  return {
    id: order.id,
    source: "admin-ui" as const,
    reason,
    expected_version: order.version,
    idempotency_key: `admin-ui:${action}:${order.id}:v${order.version}`,
  };
}

function ReasonActionModal({
  action,
  actionError,
  busy,
  onClearError,
  onClose,
}: {
  action: ReasonAction | null;
  actionError: ActionError | "";
  busy: boolean;
  onClearError: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setReason("");
    setError("");
  }, [action]);

  async function confirm() {
    const value = reason.trim();
    if (value.length < 4) {
      setError("Enter an audit reason of at least four characters.");
      return;
    }
    if (await action?.onConfirm(value)) onClose();
  }

  return (
    <Modal
      title={action?.title}
      open={action != null}
      okText={action?.confirmLabel}
      okButtonProps={{
        danger: action?.danger,
        disabled: reason.trim().length < 4,
        loading: busy,
      }}
      cancelButtonProps={{ disabled: busy }}
      onCancel={onClose}
      onOk={() => void confirm()}
      afterOpenChange={(open) => {
        if (open) {
          document.getElementById("receivables-action-reason")?.focus();
        }
      }}
      destroyOnHidden
    >
      <Paragraph>{action?.description}</Paragraph>
      {actionError ? (
        <ErrorDisplay
          error={actionError}
          title="Commercial order action failed"
          onClose={onClearError}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <label htmlFor="receivables-action-reason">
        <Text strong>Audit reason</Text>
      </label>
      <Input.TextArea
        id="receivables-action-reason"
        autoFocus
        rows={3}
        maxLength={2000}
        value={reason}
        aria-describedby="receivables-action-reason-help"
        aria-invalid={!!error}
        onChange={(event) => {
          setReason(event.target.value);
          setError("");
        }}
      />
      <Text id="receivables-action-reason-help" type="secondary">
        This reason is written to the immutable commercial order timeline.
      </Text>
      {error ? <Alert showIcon type="error" title={error} /> : null}
    </Modal>
  );
}

function InvoicePreviewModal({
  busy,
  onClose,
  onCreateDraft,
  preview,
}: {
  busy: boolean;
  onClose: () => void;
  onCreateDraft: () => void;
  preview: CommercialInvoicePreview | null;
}) {
  return (
    <Modal
      title="Stripe invoice preview"
      open={preview != null}
      onCancel={onClose}
      width={760}
      footer={
        <Flex justify="flex-end" gap="small" wrap>
          <Button onClick={onClose}>Close preview</Button>
          <Button
            type="primary"
            disabled={!preview?.ready}
            loading={busy}
            onClick={onCreateDraft}
          >
            Create Stripe draft (fresh authentication required)
          </Button>
        </Flex>
      }
      destroyOnHidden
    >
      {preview ? (
        <Flex vertical gap="middle">
          <Alert
            showIcon
            type={preview.ready ? "info" : "warning"}
            title={
              preview.ready
                ? "Ready to create a Stripe draft"
                : "Invoice preview has blockers"
            }
            description={
              preview.ready
                ? "Creating a draft does not finalize or send the invoice. Review it again before sending."
                : preview.blockers.join("; ")
            }
          />
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="Organization">
              {preview.organization_name}
            </Descriptions.Item>
            <Descriptions.Item label="Total">
              {formatMoney(preview.total, preview.currency)}
            </Descriptions.Item>
            <Descriptions.Item label="Due">
              {formatDate(preview.due_at)} ({preview.payment_terms_days} day
              terms)
            </Descriptions.Item>
            <Descriptions.Item label="Stripe customer">
              {preview.stripe_customer_id ?? "A customer will be resolved"}
            </Descriptions.Item>
            <Descriptions.Item label="PO number">
              {preview.po_number ?? "Not set"}
            </Descriptions.Item>
            <Descriptions.Item label="Customer reference">
              {preview.customer_reference ?? "Not set"}
            </Descriptions.Item>
            <Descriptions.Item label="Invoice memo">
              {preview.invoice_memo ?? "Not set"}
            </Descriptions.Item>
            <Descriptions.Item label="Billing address">
              {preview.billing_address
                ? Object.values(preview.billing_address)
                    .filter(Boolean)
                    .join(", ")
                : "Not set"}
            </Descriptions.Item>
          </Descriptions>
          <div>
            <Text strong>Billing recipients</Text>
            <ul>
              {preview.billing_contacts.map((contact) => (
                <li key={contact.id}>
                  {contact.name_snapshot} &lt;{contact.email_snapshot}&gt;
                </li>
              ))}
            </ul>
          </div>
          <div>
            <Text strong>Line items</Text>
            <ul>
              {preview.items.map((item) => (
                <li key={item.id}>
                  {item.description}:{" "}
                  {formatMoney(item.subtotal, preview.currency)}
                </li>
              ))}
            </ul>
          </div>
        </Flex>
      ) : null}
    </Modal>
  );
}

function FulfillmentPreviewModal({
  allowBeforePayment,
  busy,
  collectionComplete,
  onAllowBeforePaymentChange,
  onClose,
  onProvision,
  preview,
}: {
  allowBeforePayment: boolean;
  busy: boolean;
  collectionComplete: boolean;
  onAllowBeforePaymentChange: (value: boolean) => void;
  onClose: () => void;
  onProvision: () => void;
  preview: CommercialFulfillmentPlan | null;
}) {
  const accountNames = useAccountDisplayNames([
    preview?.plan?.owner_account_id,
    ...(preview?.plan?.manager_account_ids ?? []),
  ]);
  const canProvision =
    !!preview?.ready && (collectionComplete || allowBeforePayment);
  return (
    <Modal
      title="Site license fulfillment preview"
      open={preview != null}
      onCancel={onClose}
      width={760}
      footer={
        <Flex justify="flex-end" gap="small" wrap>
          <Button onClick={onClose}>Close preview</Button>
          <Button
            type="primary"
            disabled={!canProvision}
            loading={busy}
            onClick={onProvision}
          >
            Provision site license (fresh authentication required)
          </Button>
        </Flex>
      }
      destroyOnHidden
    >
      {preview ? (
        <Flex vertical gap="middle">
          <Alert
            showIcon
            type={preview.ready ? "info" : "warning"}
            title={
              preview.ready
                ? `Fulfillment action: ${preview.action}`
                : "Fulfillment preview has blockers"
            }
            description={
              preview.ready
                ? "This changes fulfillment only. It does not mark an invoice paid."
                : preview.blockers.join("; ")
            }
          />
          {preview.planned_changes.length ? (
            <Alert
              showIcon
              type="info"
              title="Existing license will be updated"
              description={preview.planned_changes.join("; ")}
            />
          ) : null}
          {!collectionComplete ? (
            <Checkbox
              checked={allowBeforePayment}
              onChange={(event) =>
                onAllowBeforePaymentChange(event.target.checked)
              }
            >
              I reviewed this order and authorize provisioning before payment
            </Checkbox>
          ) : null}
          <Alert
            showIcon
            type="info"
            title="Reviewed site license target"
            description={
              preview.site_license_id
                ? `This action can only update the reviewed site license ${preview.site_license_id}.`
                : "This action will create a new site license from the reviewed plan. To target an existing license, revise the order before approval and review it again."
            }
          />
          {preview.plan ? (
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="License name">
                {preview.plan.name}
              </Descriptions.Item>
              <Descriptions.Item label="Owner account">
                <AccountIdentity
                  accountId={preview.plan.owner_account_id}
                  names={accountNames}
                />
              </Descriptions.Item>
              <Descriptions.Item label="Allowed domains">
                {preview.plan.allowed_domains.join(", ") || "None"}
              </Descriptions.Item>
              <Descriptions.Item label="Managers">
                {preview.plan.manager_account_ids?.length
                  ? preview.plan.manager_account_ids.map((accountId, index) => (
                      <span key={accountId}>
                        {index ? ", " : null}
                        <AccountIdentity
                          accountId={accountId}
                          names={accountNames}
                        />
                      </span>
                    ))
                  : "None"}
              </Descriptions.Item>
              <Descriptions.Item label="Term">
                {formatDate(preview.plan.starts_at)} through{" "}
                {formatDate(preview.plan.expires_at)}
              </Descriptions.Item>
              <Descriptions.Item label="Pools">
                <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                  {preview.plan.pools.map((pool, index) => (
                    <li key={`${pool.membership_class}-${index}`}>
                      {pool.label ?? pool.membership_class}: {pool.seat_limit}{" "}
                      seats
                    </li>
                  ))}
                </ul>
              </Descriptions.Item>
            </Descriptions>
          ) : null}
        </Flex>
      ) : null}
    </Modal>
  );
}

function ReconcilePreviewModal({
  busy,
  onClose,
  onReconcile,
  preview,
}: {
  busy: boolean;
  onClose: () => void;
  onReconcile: () => void;
  preview: CommercialReconcilePreview | null;
}) {
  return (
    <Modal
      title="Stripe reconciliation preview"
      open={preview != null}
      onCancel={onClose}
      footer={
        <Flex justify="flex-end" gap="small" wrap>
          <Button onClick={onClose}>Close preview</Button>
          <Button
            type="primary"
            disabled={!preview?.ready}
            loading={busy}
            onClick={onReconcile}
          >
            Reconcile with Stripe (fresh authentication required)
          </Button>
        </Flex>
      }
      destroyOnHidden
    >
      {preview ? (
        <Flex vertical gap="middle">
          <Alert
            showIcon
            type={preview.ready ? "info" : "warning"}
            title={
              preview.ready
                ? "Ready to reconcile with Stripe"
                : "Reconciliation preview has blockers"
            }
            description={
              preview.ready
                ? "Reconciliation fetches provider state and applies missing local updates; it does not create a new invoice."
                : preview.blockers.join("; ")
            }
          />
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="Stripe invoice ID">
              {preview.provider_invoice_id ?? "Not attached"}
            </Descriptions.Item>
            <Descriptions.Item label="Local status">
              {humanizeKey(preview.local_status)}
            </Descriptions.Item>
            <Descriptions.Item label="Local total">
              {preview.local_total}
            </Descriptions.Item>
            <Descriptions.Item label="Local amount due">
              {preview.local_amount_due}
            </Descriptions.Item>
            <Descriptions.Item label="Last reconciled">
              {formatDate(preview.last_reconciled_at)}
            </Descriptions.Item>
            <Descriptions.Item label="Stale">
              {preview.stale ? "Yes" : "No"}
            </Descriptions.Item>
          </Descriptions>
        </Flex>
      ) : null}
    </Modal>
  );
}

export function ReceivableOrderDetail({
  id,
  onBack,
  onOpenCustomer,
}: {
  id: string;
  onBack: () => void;
  onOpenCustomer?: (id: string) => void;
}) {
  const api = webapp_client.conat_client.hub.commercialOrders;
  const [order, setOrder] = useState<CommercialOrder | null>(null);
  const [events, setEvents] = useState<CommercialOrderEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState<ActionError | "">("");
  const [reasonAction, setReasonAction] = useState<ReasonAction | null>(null);
  const [invoicePreview, setInvoicePreview] =
    useState<CommercialInvoicePreview | null>(null);
  const [fulfillmentPreview, setFulfillmentPreview] =
    useState<CommercialFulfillmentPlan | null>(null);
  const [reconcilePreview, setReconcilePreview] =
    useState<CommercialReconcilePreview | null>(null);
  const [allowBeforePayment, setAllowBeforePayment] = useState(false);
  const [editMode, setEditMode] = useState<"update" | "revise" | null>(null);
  const [ticketDetails, setTicketDetails] = useState<
    Record<
      number,
      { ticket?: AdminSupportTicketSummary; error?: string; loading?: boolean }
    >
  >({});
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentPreview, setPaymentPreview] =
    useState<ManualPaymentFormValues | null>(null);
  const [paymentReviewed, setPaymentReviewed] = useState(false);
  const [manualInvoiceOpen, setManualInvoiceOpen] = useState(false);
  const [manualInvoicePreview, setManualInvoicePreview] =
    useState<ManualInvoiceFormValues | null>(null);
  const [manualInvoiceReviewed, setManualInvoiceReviewed] = useState(false);
  const [linkInvoiceOpen, setLinkInvoiceOpen] = useState(false);
  const [assignmentForm] = Form.useForm();
  const [noteForm] = Form.useForm();
  const [paymentForm] = Form.useForm<ManualPaymentFormValues>();
  const [manualInvoiceForm] = Form.useForm<ManualInvoiceFormValues>();
  const [linkInvoiceForm] = Form.useForm();
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction();
  const accountNames = useAccountDisplayNames([
    order?.assignee_account_id,
    ...events.map(({ actor_account_id }) => actor_account_id),
  ]);

  async function loadAuditTimeline(reason: string) {
    const timeline: CommercialOrderEvent[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const response = await api.events({
        id,
        reason,
        cursor,
        limit: 500,
        max_bytes: 5_000_000,
      });
      timeline.push(...response.events);
      if (!response.truncated) break;
      if (!response.next_cursor || seen.has(response.next_cursor)) {
        throw Error("The audit timeline could not advance to its next page");
      }
      seen.add(response.next_cursor);
      cursor = response.next_cursor;
      if (timeline.length > 20_000) {
        throw Error("The audit timeline exceeds the 20,000 event UI limit");
      }
    } while (cursor);
    return timeline;
  }

  async function loadOrder() {
    setLoading(true);
    setError("");
    setActionError("");
    try {
      const [nextOrder, nextEvents] = await Promise.all([
        api.get({ id, reason: "Review commercial order detail" }),
        loadAuditTimeline("Review commercial order audit timeline"),
      ]);
      setOrder(nextOrder);
      setEvents(nextEvents);
    } catch (err) {
      setError(formatReceivablesError(err));
      setOrder(null);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  async function reloadEvents(orderId: string) {
    if (orderId !== id) return;
    setEvents(
      await loadAuditTimeline(
        "Refresh commercial order audit timeline after mutation",
      ),
    );
  }

  useEffect(() => {
    void loadOrder();
  }, [id]);

  useEffect(() => {
    if (paymentPreview) {
      document.getElementById("receivables-payment-review-title")?.focus();
    }
  }, [paymentPreview]);

  useEffect(() => {
    if (manualInvoicePreview) {
      document
        .getElementById("receivables-manual-invoice-review-title")
        ?.focus();
    }
  }, [manualInvoicePreview]);

  useEffect(() => {
    const ticketIds = order?.zendesk_ticket_ids.slice(0, 10) ?? [];
    if (!ticketIds.length) {
      setTicketDetails({});
      return;
    }
    let cancelled = false;
    setTicketDetails(
      Object.fromEntries(
        ticketIds.map((ticketId) => [ticketId, { loading: true }]),
      ),
    );
    void Promise.all(
      ticketIds.map(async (ticketId) => {
        try {
          const response =
            await webapp_client.conat_client.hub.adminSupport.show({
              ticket_id: ticketId,
              max_comments: 1,
              max_bytes: 64_000,
              reason: `Review Zendesk ticket ${ticketId} linked to commercial order ${order?.order_number ?? id}`,
            });
          if (!cancelled) {
            setTicketDetails((current) => ({
              ...current,
              [ticketId]: { ticket: response.ticket },
            }));
          }
        } catch (err) {
          if (!cancelled) {
            setTicketDetails((current) => ({
              ...current,
              [ticketId]: {
                error: formatReceivablesError(err),
              },
            }));
          }
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [id, order?.order_number, order?.zendesk_ticket_ids.join(",")]);

  async function runMutation(
    fresh: boolean,
    label: string,
    operation: () => Promise<CommercialOrder>,
  ): Promise<boolean> {
    setBusy(true);
    setActionError("");
    let updated: CommercialOrder | undefined;
    try {
      const execute = async () => {
        updated = await operation();
      };
      if (fresh) {
        const completed = await runFreshAuthAction(execute);
        if (!completed) return false;
      } else {
        await execute();
      }
      if (updated) {
        setOrder(updated);
        await reloadEvents(updated.id);
      }
      message.success(label);
      return true;
    } catch (err) {
      setActionError(formatActionError(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function requestApprove(current: CommercialOrder) {
    setReasonAction({
      title: "Approve commercial order",
      description:
        "Approval freezes the reviewed agreement for invoicing. Fresh authentication is required.",
      confirmLabel: "Approve order",
      onConfirm: async (reason) =>
        await runMutation(
          true,
          "Commercial order approved",
          async () =>
            await api.approve({
              ...mutationFields("approve", current, reason),
              browser_id: webapp_client.browser_id,
            }),
        ),
    });
  }

  function requestCancel(current: CommercialOrder) {
    setReasonAction({
      title: "Cancel commercial order",
      description:
        "This is a terminal workflow action. Any active Stripe invoice must be voided first. Fresh authentication is required.",
      confirmLabel: "Cancel order",
      danger: true,
      onConfirm: async (reason) =>
        await runMutation(
          true,
          "Commercial order cancelled",
          async () =>
            await api.cancel({
              ...mutationFields("cancel", current, reason),
              browser_id: webapp_client.browser_id,
            }),
        ),
    });
  }

  async function openInvoicePreview(current: CommercialOrder) {
    setBusy(true);
    setActionError("");
    try {
      setInvoicePreview(
        await api.invoicePreview({
          id: current.id,
          reason: "Preview reviewed Stripe invoice before creating a draft",
        }),
      );
    } catch (err) {
      setActionError(formatReceivablesError(err));
    } finally {
      setBusy(false);
    }
  }

  function requestCreateInvoiceDraft(current: CommercialOrder) {
    setReasonAction({
      title: "Create Stripe invoice draft",
      description:
        "This creates a draft in Stripe but does not finalize or send it. Fresh authentication is required.",
      confirmLabel: "Create Stripe draft",
      onConfirm: async (reason) => {
        const success = await runMutation(
          true,
          "Stripe invoice draft created",
          async () =>
            await api.createInvoiceDraft({
              ...mutationFields("invoice-draft", current, reason),
              browser_id: webapp_client.browser_id,
            }),
        );
        if (success) setInvoicePreview(null);
        return success;
      },
    });
  }

  function requestSendInvoice(
    current: CommercialOrder,
    invoice: CommercialInvoice,
  ) {
    setReasonAction({
      title: "Finalize and send Stripe invoice",
      description:
        "Stripe will finalize this draft and send it to the approved billing contact. Fresh authentication is required.",
      confirmLabel: "Send Stripe invoice",
      onConfirm: async (reason) =>
        await runMutation(
          true,
          "Stripe invoice sent",
          async () =>
            await api.sendInvoice({
              ...mutationFields("invoice-send", current, reason),
              commercial_invoice_id: invoice.id,
              browser_id: webapp_client.browser_id,
            }),
        ),
    });
  }

  function requestVoidInvoice(
    current: CommercialOrder,
    invoice: CommercialInvoice,
  ) {
    const isStripe = invoice.provider === "stripe";
    setReasonAction({
      title: isStripe ? "Void Stripe invoice" : "Void manual invoice record",
      description: isStripe
        ? "The active draft or open invoice will be deleted or voided in Stripe. Fresh authentication is required."
        : "This voids the internal manual invoice record. It does not contact an external accounting system or retract a document already sent to the customer. Fresh authentication is required.",
      confirmLabel: "Void invoice",
      danger: true,
      onConfirm: async (reason) =>
        await runMutation(
          true,
          isStripe ? "Stripe invoice voided" : "Manual invoice record voided",
          async () =>
            await api.voidInvoice({
              ...mutationFields("invoice-void", current, reason),
              commercial_invoice_id: invoice.id,
              browser_id: webapp_client.browser_id,
            }),
        ),
    });
  }

  function requestReconcileInvoice(
    current: CommercialOrder,
    invoice: CommercialInvoice,
  ) {
    setReasonAction({
      title: "Reconcile invoice with Stripe",
      description:
        "This fetches current Stripe state and applies any missing local updates. Fresh authentication is required.",
      confirmLabel: "Reconcile invoice",
      onConfirm: async (reason) => {
        const success = await runMutation(
          true,
          "Stripe invoice reconciled",
          async () =>
            await api.reconcileInvoice({
              ...mutationFields("invoice-reconcile", current, reason),
              commercial_invoice_id: invoice.id,
              browser_id: webapp_client.browser_id,
            }),
        );
        if (success) setReconcilePreview(null);
        return success;
      },
    });
  }

  async function openReconcilePreview(
    current: CommercialOrder,
    invoice: CommercialInvoice,
  ) {
    setBusy(true);
    setActionError("");
    try {
      setReconcilePreview(
        await api.reconcilePreview({
          id: current.id,
          commercial_invoice_id: invoice.id,
          reason:
            "Preview Stripe reconciliation before applying provider state",
        }),
      );
    } catch (err) {
      setActionError(formatReceivablesError(err));
    } finally {
      setBusy(false);
    }
  }

  function openLinkInvoice() {
    linkInvoiceForm.resetFields();
    setLinkInvoiceOpen(true);
  }

  async function linkExistingInvoice() {
    if (!order) return;
    const values = await linkInvoiceForm.validateFields();
    const success = await runMutation(
      true,
      "Existing Stripe invoice linked",
      async () =>
        await api.linkExistingInvoice({
          ...mutationFields("invoice-link", order, values.reason),
          provider_invoice_id: values.provider_invoice_id.trim(),
          browser_id: webapp_client.browser_id,
        }),
    );
    if (success) setLinkInvoiceOpen(false);
  }

  async function openFulfillmentPreview(current: CommercialOrder) {
    setBusy(true);
    setActionError("");
    try {
      const preview = await api.fulfillmentPreview({
        id: current.id,
        reason: "Preview site license fulfillment before provisioning",
      });
      setAllowBeforePayment(false);
      setFulfillmentPreview(preview);
    } catch (err) {
      setActionError(formatReceivablesError(err));
    } finally {
      setBusy(false);
    }
  }

  function requestProvision(current: CommercialOrder) {
    setReasonAction({
      title: "Provision site license",
      description:
        "This provisions or links the reviewed site license plan. It changes fulfillment only and requires fresh authentication.",
      confirmLabel: "Provision site license",
      onConfirm: async (reason) => {
        const success = await runMutation(
          true,
          "Site license fulfillment provisioned",
          async () =>
            await api.provision({
              ...mutationFields("fulfillment-provision", current, reason),
              allow_before_payment: allowBeforePayment,
              browser_id: webapp_client.browser_id,
            }),
        );
        if (success) setFulfillmentPreview(null);
        return success;
      },
    });
  }

  function requestEndFulfillment(current: CommercialOrder) {
    setReasonAction({
      title: "End fulfillment",
      description:
        "This marks fulfillment ended. It does not void or change collection. Fresh authentication is required.",
      confirmLabel: "End fulfillment",
      danger: true,
      onConfirm: async (reason) =>
        await runMutation(
          true,
          "Fulfillment ended",
          async () =>
            await api.endFulfillment({
              ...mutationFields("fulfillment-end", current, reason),
              browser_id: webapp_client.browser_id,
            }),
        ),
    });
  }

  function openAssignment(current: CommercialOrder) {
    assignmentForm.setFieldsValue({
      assignee_account_id: current.assignee_account_id ?? "",
      next_action: current.next_action,
      next_action_due_at: current.next_action_due_at
        ? new Date(current.next_action_due_at).toISOString().slice(0, 16)
        : "",
      reason: "",
    });
    setAssignmentOpen(true);
  }

  async function saveAssignment() {
    if (!order) return;
    const values = await assignmentForm.validateFields();
    const success = await runMutation(
      false,
      "Order ownership updated",
      async () =>
        await api.assign({
          ...mutationFields("assign", order, values.reason),
          assignee_account_id: values.assignee_account_id || null,
          next_action: values.next_action,
          next_action_due_at: values.next_action_due_at
            ? new Date(values.next_action_due_at).toISOString()
            : null,
        }),
    );
    if (success) setAssignmentOpen(false);
  }

  async function addNote() {
    if (!order) return;
    const values = await noteForm.validateFields();
    const success = await runMutation(
      false,
      "Internal note added",
      async () =>
        await api.addNote({
          ...mutationFields("note", order, values.reason),
          note: values.note,
        }),
    );
    if (success) {
      setNoteOpen(false);
      noteForm.resetFields();
    }
  }

  function openPayment(current: CommercialOrder) {
    paymentForm.setFieldsValue({
      amount: current.agreed_total,
      currency: current.currency,
      method: "wire",
      received_at: new Date().toISOString().slice(0, 16),
      evidence_reference: "",
      commercial_invoice_id: current.invoices[0]?.id,
      reason: "",
    });
    setPaymentPreview(null);
    setPaymentReviewed(false);
    setPaymentOpen(true);
  }

  async function reviewPayment() {
    const values = await paymentForm.validateFields();
    setPaymentPreview(values);
    setPaymentReviewed(false);
  }

  async function recordPayment() {
    if (!order || !paymentPreview || !paymentReviewed) return;
    const values = paymentPreview;
    const success = await runMutation(
      true,
      "Manual payment recorded",
      async () =>
        await api.recordManualPayment({
          ...mutationFields("manual-payment", order, values.reason),
          commercial_invoice_id: values.commercial_invoice_id || undefined,
          amount: values.amount,
          currency: values.currency,
          received_at: values.received_at
            ? new Date(values.received_at).toISOString()
            : undefined,
          method: values.method as CommercialPaymentMethod,
          evidence_reference: values.evidence_reference,
          browser_id: webapp_client.browser_id,
        }),
    );
    if (success) {
      setPaymentOpen(false);
      setPaymentPreview(null);
      setPaymentReviewed(false);
    }
  }

  function openManualInvoice(current: CommercialOrder) {
    manualInvoiceForm.setFieldsValue({
      invoice_reference: "",
      due_at: current.next_action_due_at
        ? new Date(current.next_action_due_at).toISOString().slice(0, 16)
        : undefined,
      document_url: "",
      evidence_reference: "",
      reason: "",
    });
    setManualInvoicePreview(null);
    setManualInvoiceReviewed(false);
    setManualInvoiceOpen(true);
  }

  async function reviewManualInvoice() {
    const values = await manualInvoiceForm.validateFields();
    setManualInvoicePreview(values);
    setManualInvoiceReviewed(false);
  }

  async function issueManualInvoice() {
    if (!order || !manualInvoicePreview || !manualInvoiceReviewed) return;
    const values = manualInvoicePreview;
    const success = await runMutation(
      true,
      "Manual invoice issued",
      async () =>
        await api.issueManualInvoice({
          ...mutationFields("manual-invoice", order, values.reason),
          invoice_reference: values.invoice_reference.trim(),
          due_at: values.due_at
            ? new Date(values.due_at).toISOString()
            : undefined,
          document_url: values.document_url?.trim() || undefined,
          evidence_reference: values.evidence_reference?.trim() || undefined,
          browser_id: webapp_client.browser_id,
        }),
    );
    if (success) {
      setManualInvoiceOpen(false);
      setManualInvoicePreview(null);
      setManualInvoiceReviewed(false);
    }
  }

  if (loading) {
    return (
      <Flex justify="center" style={{ padding: 32 }} aria-live="polite">
        <Spin description="Loading commercial order" />
      </Flex>
    );
  }

  if (!order) {
    return (
      <Flex vertical gap="middle">
        <Button onClick={onBack}>Back to accounts receivable queue</Button>
        <Alert
          showIcon
          type="error"
          title="Could not load commercial order"
          description={error || `Order ${id} was not found.`}
        />
      </Flex>
    );
  }

  const contactColumns: TableColumnsType<CommercialOrderContact> = [
    { title: "Role", dataIndex: "role", render: humanizeKey },
    { title: "Name", dataIndex: "name_snapshot" },
    { title: "Email", dataIndex: "email_snapshot" },
    {
      title: "Organization",
      dataIndex: "organization_snapshot",
      render: (value) => value ?? "Not set",
    },
  ];

  const itemColumns: TableColumnsType<CommercialOrderItem> = [
    { title: "Description", dataIndex: "description" },
    { title: "Quantity", dataIndex: "quantity", width: 100 },
    {
      title: "Unit amount",
      dataIndex: "unit_amount",
      width: 140,
      render: (value) => formatMoney(value, order.currency),
    },
    {
      title: "Subtotal",
      dataIndex: "subtotal",
      width: 140,
      render: (value) => formatMoney(value, order.currency),
    },
    { title: "Product", dataIndex: "product_kind", width: 150 },
  ];

  const paymentColumns: TableColumnsType<CommercialPayment> = [
    {
      title: "Received",
      dataIndex: "received_at",
      render: formatDate,
    },
    {
      title: "Amount",
      key: "amount",
      render: (_, payment) => formatMoney(payment.amount, payment.currency),
    },
    { title: "Method", dataIndex: "method", render: humanizeKey },
    { title: "Status", dataIndex: "status", render: humanizeKey },
    { title: "Provider", dataIndex: "provider" },
    {
      title: "Evidence reference",
      dataIndex: "evidence_reference",
      render: (value) => value ?? "Not recorded",
    },
  ];

  const collectionComplete =
    order.collection_mode === "complimentary" ||
    ["paid", "waived"].includes(order.collection_state);
  const terminalOrder = ["complete", "cancelled"].includes(
    order.workflow_state,
  );
  const canApprove =
    !order.approved_at &&
    ["draft", "awaiting_customer"].includes(order.workflow_state);
  const hasActiveInvoice = order.invoices.some((invoice) =>
    ["creating", "draft", "open"].includes(invoice.status),
  );

  return (
    <Flex className="receivables-shell" vertical gap={18}>
      <Flex justify="space-between" align="center" gap="middle" wrap>
        <Button icon={<Icon name="arrow-left" />} onClick={onBack}>
          Accounts receivable queue
        </Button>
        <Space wrap>
          <Button
            href="/app-docs/admin/accounts-receivable"
            icon={<Icon name="book" />}
            size="small"
          >
            Operations runbook
          </Button>
          <Button
            icon={<Icon name="refresh" />}
            onClick={() => void loadOrder()}
            size="small"
          >
            Refresh order
          </Button>
          <Text type="secondary">Version {order.version}</Text>
        </Space>
      </Flex>

      <section
        className="receivables-hero"
        aria-labelledby="receivables-order-title"
      >
        <Flex align="start" gap={20} justify="space-between" wrap>
          <div className="receivables-hero-copy">
            <div className="receivables-eyebrow">{order.order_number}</div>
            <Title
              id="receivables-order-title"
              level={2}
              style={{ margin: "8px 0" }}
            >
              {order.organization_name}
            </Title>
            <StateTriplet order={order} />
          </div>
          <Space wrap>
            <Button
              aria-label="Add internal note"
              ghost
              onClick={() => {
                noteForm.resetFields();
                setNoteOpen(true);
              }}
              size="large"
            >
              Add internal note
            </Button>
            <Button
              aria-label="Assign and set next action"
              onClick={() => openAssignment(order)}
              size="large"
            >
              Assign and set next action
            </Button>
          </Space>
        </Flex>
      </section>

      <div
        className="receivables-detail-summary-grid"
        aria-label="Commercial order summary"
      >
        <Card className="receivables-metric-card" size="small">
          <Text type="secondary">Agreement total</Text>
          <div className="receivables-order-metric-value">
            {formatMoney(order.agreed_total, order.currency)}
          </div>
        </Card>
        <Card className="receivables-metric-card" size="small">
          <Text type="secondary">Owner</Text>
          <div className="receivables-order-metric-value">
            <AccountIdentity
              accountId={order.assignee_account_id}
              names={accountNames}
              unknownLabel="Unassigned"
            />
          </div>
        </Card>
        <Card className="receivables-metric-card" size="small">
          <Text type="secondary">Next action</Text>
          <div className="receivables-order-metric-value">
            {order.next_action || "Not recorded"}
          </div>
        </Card>
        <Card className="receivables-metric-card" size="small">
          <Text type="secondary">Action due</Text>
          <div className="receivables-order-metric-value">
            {formatDate(order.next_action_due_at)}
          </div>
        </Card>
      </div>

      <Card className="receivables-section-card" title="Order overview">
        <Flex vertical gap="middle">
          <IndependentStateAlerts order={order} />
          <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
            <Descriptions.Item label="Agreement total">
              {formatMoney(order.agreed_total, order.currency)}
            </Descriptions.Item>
            <Descriptions.Item label="Collection mode">
              {humanizeKey(order.collection_mode)}
            </Descriptions.Item>
            <Descriptions.Item label="Assignee account">
              <AccountIdentity
                accountId={order.assignee_account_id}
                names={accountNames}
                unknownLabel="Unassigned"
              />
            </Descriptions.Item>
            <Descriptions.Item label="Next action">
              {order.next_action || "Not recorded"}
            </Descriptions.Item>
            <Descriptions.Item label="Next action due">
              {formatDate(order.next_action_due_at)}
            </Descriptions.Item>
            <Descriptions.Item label="Service term">
              {formatDate(order.service_starts_at)} through{" "}
              {formatDate(order.service_ends_at)}
            </Descriptions.Item>
            <Descriptions.Item label="PO number">
              {order.po_number ?? "Not set"}
            </Descriptions.Item>
            <Descriptions.Item label="Customer reference">
              {order.customer_reference ?? "Not set"}
            </Descriptions.Item>
            <Descriptions.Item label="Customer record">
              {order.crm_organization_id && onOpenCustomer ? (
                <Button
                  type="link"
                  style={{ height: "auto", padding: 0 }}
                  onClick={() => onOpenCustomer(order.crm_organization_id!)}
                >
                  Open Customer 360
                </Button>
              ) : (
                "Not linked"
              )}
            </Descriptions.Item>
            <Descriptions.Item label="Stripe customer">
              {order.stripe_customer_id ?? "Not linked"}
            </Descriptions.Item>
            <Descriptions.Item label="Site license">
              <SiteLicenseReference siteLicenseId={order.site_license_id} />
            </Descriptions.Item>
            <Descriptions.Item label="Created">
              {formatDate(order.created_at)}
            </Descriptions.Item>
            <Descriptions.Item label="Updated">
              {formatDate(order.updated_at)}
            </Descriptions.Item>
          </Descriptions>
          {order.zendesk_ticket_ids.length ? (
            <Card title="Linked Zendesk tickets" size="small" type="inner">
              <Flex vertical gap="small">
                {order.zendesk_ticket_ids.slice(0, 10).map((ticketId) => {
                  const detail = ticketDetails[ticketId];
                  const ticket = detail?.ticket;
                  return (
                    <div key={ticketId}>
                      <Flex align="baseline" gap="small" wrap>
                        <ExternalLink
                          href={
                            ticket?.agent_url ??
                            `https://sagemathcloud.zendesk.com/agent/tickets/${ticketId}`
                          }
                        >
                          Zendesk ticket {ticketId} (external)
                        </ExternalLink>
                        {detail?.loading ? (
                          <Text type="secondary">
                            Loading ticket details...
                          </Text>
                        ) : ticket ? (
                          <>
                            <Text strong>{humanizeKey(ticket.status)}</Text>
                            <Text>{ticket.subject}</Text>
                            <Text type="secondary">
                              Updated {formatDate(ticket.updated_at)}
                            </Text>
                          </>
                        ) : (
                          <Text type="secondary">
                            Ticket details unavailable; the agent link still
                            works.
                          </Text>
                        )}
                      </Flex>
                    </div>
                  );
                })}
                {order.zendesk_ticket_ids.length > 10 ? (
                  <Alert
                    showIcon
                    type="info"
                    title="Additional linked tickets"
                    description={`Showing audited details for the first 10 of ${order.zendesk_ticket_ids.length} linked tickets.`}
                  />
                ) : null}
              </Flex>
            </Card>
          ) : null}
        </Flex>
      </Card>

      {actionError && reasonAction == null && !paymentOpen ? (
        <ErrorDisplay
          error={actionError}
          title="Commercial order action failed"
          onClose={() => setActionError("")}
        />
      ) : null}

      <Card className="receivables-section-card" title="Actions" size="small">
        <Flex vertical gap="middle">
          <Alert
            showIcon
            type="info"
            title="Financial and fulfillment actions require fresh authentication"
            description="Every mutation uses this displayed order version. A concurrent change is rejected instead of silently overwritten."
          />
          <Flex gap="small" wrap>
            <Button onClick={() => openAssignment(order)}>
              Assign and set next action
            </Button>
            <Button
              onClick={() => {
                noteForm.resetFields();
                setNoteOpen(true);
              }}
            >
              Add internal note
            </Button>
            {!terminalOrder && !order.approved_at ? (
              <Button
                disabled={hasActiveInvoice}
                onClick={() => setEditMode("update")}
              >
                Update draft
              </Button>
            ) : null}
            {!terminalOrder && order.approved_at ? (
              <Button
                disabled={hasActiveInvoice}
                onClick={() => setEditMode("revise")}
              >
                Revise reviewed agreement
              </Button>
            ) : null}
            {canApprove ? (
              <Button type="primary" onClick={() => requestApprove(order)}>
                Approve order
              </Button>
            ) : null}
            {!terminalOrder ? (
              <Button danger onClick={() => requestCancel(order)}>
                Cancel order
              </Button>
            ) : null}
          </Flex>
          {!terminalOrder ? (
            <>
              <Divider style={{ margin: 0 }} />
              <Flex gap="small" wrap>
                <Button
                  disabled={busy || order.collection_mode !== "stripe_invoice"}
                  onClick={() => void openInvoicePreview(order)}
                >
                  Preview Stripe invoice
                </Button>
                <Button
                  disabled={
                    order.collection_mode !== "stripe_invoice" ||
                    !order.approved_at ||
                    hasActiveInvoice
                  }
                  onClick={openLinkInvoice}
                >
                  Link existing Stripe invoice
                </Button>
                {order.collection_mode === "manual_invoice" ? (
                  <Button
                    disabled={!order.approved_at || hasActiveInvoice}
                    onClick={() => openManualInvoice(order)}
                  >
                    Issue manual invoice
                  </Button>
                ) : null}
                <Button onClick={() => openPayment(order)}>
                  Record manual payment
                </Button>
                {order.fulfillment_state === "not_provisioned" ? (
                  <Button
                    disabled={busy || !order.approved_at}
                    onClick={() => void openFulfillmentPreview(order)}
                  >
                    Preview site license fulfillment
                  </Button>
                ) : order.fulfillment_state === "provisioned" ? (
                  <Button danger onClick={() => requestEndFulfillment(order)}>
                    End fulfillment
                  </Button>
                ) : null}
              </Flex>
            </>
          ) : (
            <Alert
              showIcon
              type="info"
              title="Terminal order"
              description="Cancel, payment, invoice, revision, and fulfillment actions are unavailable for completed or cancelled orders."
            />
          )}
        </Flex>
      </Card>

      <Card
        className="receivables-section-card"
        title="Contacts and invoice recipients"
        size="small"
      >
        <Table
          aria-label="Commercial order contacts"
          columns={contactColumns}
          dataSource={order.contacts}
          locale={{ emptyText: "No contacts recorded" }}
          pagination={false}
          rowKey="id"
          scroll={{ x: 650 }}
          size="small"
        />
      </Card>

      <Card
        className="receivables-section-card"
        title="Agreement line items"
        size="small"
      >
        <Table
          aria-label="Commercial order line items"
          columns={itemColumns}
          dataSource={order.items}
          locale={{ emptyText: "No line items recorded" }}
          pagination={false}
          rowKey="id"
          scroll={{ x: 750 }}
          size="small"
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={3}>
                <Text strong>Agreement total</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3}>
                <Text strong>
                  {formatMoney(order.agreed_total, order.currency)}
                </Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={4} />
            </Table.Summary.Row>
          )}
        />
      </Card>

      <Card className="receivables-section-card" title="Invoices" size="small">
        {order.invoices.length === 0 ? (
          <Empty description="No invoices have been created" />
        ) : (
          <Flex vertical gap="middle">
            {order.invoices.map((invoice) => (
              <Card key={invoice.id} size="small" type="inner">
                <Flex vertical gap="small">
                  <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
                    <Descriptions.Item label="Status">
                      {humanizeKey(invoice.status)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Total">
                      {formatMoney(invoice.total, invoice.currency)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Amount due">
                      {formatMoney(invoice.amount_due, invoice.currency)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Amount paid">
                      {formatMoney(invoice.amount_paid, invoice.currency)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Due">
                      {formatDate(invoice.due_at)}
                    </Descriptions.Item>
                    <Descriptions.Item label="Provider">
                      {humanizeKey(invoice.provider)}
                    </Descriptions.Item>
                    {invoice.provider === "stripe" ? (
                      <>
                        <Descriptions.Item label="Last reconciled">
                          {formatDate(invoice.last_reconciled_at)}
                        </Descriptions.Item>
                        <Descriptions.Item label="Stripe invoice ID">
                          {invoice.provider_invoice_id ?? "Not attached"}
                        </Descriptions.Item>
                        <Descriptions.Item label="Reconcile attempts">
                          {invoice.reconcile_attempt_count}
                        </Descriptions.Item>
                      </>
                    ) : (
                      <Descriptions.Item label="Invoice reference">
                        {invoiceReference(invoice) ?? "Not recorded"}
                      </Descriptions.Item>
                    )}
                  </Descriptions>
                  {invoice.provider === "stripe" &&
                  invoice.last_reconcile_error ? (
                    <Alert
                      showIcon
                      type="error"
                      title="Last reconciliation failed"
                      description={invoice.last_reconcile_error}
                    />
                  ) : null}
                  <Flex gap="middle" wrap>
                    {invoice.provider === "stripe" ? (
                      <>
                        {invoice.hosted_invoice_url ? (
                          <ExternalLink href={invoice.hosted_invoice_url}>
                            Open Stripe hosted invoice (external)
                          </ExternalLink>
                        ) : (
                          <Text type="secondary">
                            Stripe hosted page not available
                          </Text>
                        )}
                        {invoice.invoice_pdf_url ? (
                          <ExternalLink href={invoice.invoice_pdf_url}>
                            Open Stripe invoice PDF (external)
                          </ExternalLink>
                        ) : (
                          <Text type="secondary">Stripe PDF not available</Text>
                        )}
                      </>
                    ) : invoice.hosted_invoice_url ? (
                      <ExternalLink href={invoice.hosted_invoice_url}>
                        Open manual invoice document (external)
                      </ExternalLink>
                    ) : (
                      <Text type="secondary">
                        Manual invoice document not linked
                      </Text>
                    )}
                  </Flex>
                  <Flex gap="small" wrap>
                    {invoice.provider === "stripe" &&
                    invoice.status === "draft" ? (
                      <Button
                        type="primary"
                        onClick={() => requestSendInvoice(order, invoice)}
                      >
                        Finalize and send invoice
                      </Button>
                    ) : null}
                    {["draft", "open"].includes(invoice.status) ? (
                      <Button
                        danger
                        onClick={() => requestVoidInvoice(order, invoice)}
                      >
                        Void invoice
                      </Button>
                    ) : null}
                    {invoice.provider === "stripe" &&
                    invoice.provider_invoice_id ? (
                      <Button
                        onClick={() =>
                          void openReconcilePreview(order, invoice)
                        }
                      >
                        Preview reconciliation
                      </Button>
                    ) : null}
                  </Flex>
                  <Collapse
                    items={[
                      {
                        key: "provider-diagnostics",
                        label: "Provider diagnostics",
                        children: (
                          <pre
                            style={{
                              maxHeight: 320,
                              overflow: "auto",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {JSON.stringify(invoice.provider_snapshot, null, 2)}
                          </pre>
                        ),
                      },
                    ]}
                  />
                </Flex>
              </Card>
            ))}
          </Flex>
        )}
      </Card>

      <Card className="receivables-section-card" title="Payments" size="small">
        <Table
          aria-label="Commercial order payments"
          columns={paymentColumns}
          dataSource={order.payments}
          locale={{ emptyText: "No payments recorded" }}
          pagination={false}
          rowKey="id"
          scroll={{ x: 850 }}
          size="small"
        />
      </Card>

      <Card
        className="receivables-section-card"
        title="Immutable agreement terms"
        size="small"
      >
        <Paragraph type="secondary">
          This snapshot records what was agreed. It is diagnostic and is not a
          generic status or money editor.
        </Paragraph>
        <pre
          style={{ maxHeight: 420, overflow: "auto", whiteSpace: "pre-wrap" }}
        >
          {JSON.stringify(order.terms_snapshot, null, 2)}
        </pre>
      </Card>

      <Card
        className="receivables-section-card"
        title="Audit timeline"
        size="small"
      >
        {events.length === 0 ? (
          <Empty description="No audit events recorded" />
        ) : (
          <Timeline
            items={events.map((event) => ({
              content: (
                <div>
                  <Flex gap="small" align="baseline" wrap>
                    <Text strong>{humanizeKey(event.event_type)}</Text>
                    <Text type="secondary">
                      <TimeAgo date={event.created_at} /> via{" "}
                      {humanizeKey(event.source)}
                    </Text>
                  </Flex>
                  <Paragraph style={{ marginBottom: 4 }}>
                    {event.reason}
                  </Paragraph>
                  <Text type="secondary">
                    Actor:{" "}
                    <AccountIdentity
                      accountId={event.actor_account_id}
                      names={accountNames}
                    />
                  </Text>
                  <details>
                    <summary>Event diagnostics</summary>
                    <pre
                      style={{
                        maxHeight: 320,
                        overflow: "auto",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {JSON.stringify(
                        {
                          id: event.id,
                          idempotency_key: event.idempotency_key,
                          metadata: event.metadata,
                          before: event.before,
                          after: event.after,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </div>
              ),
            }))}
          />
        )}
      </Card>

      <Modal
        title="Link existing Stripe invoice"
        open={linkInvoiceOpen}
        okText="Link invoice (fresh authentication required)"
        okButtonProps={{ loading: busy }}
        onCancel={() => setLinkInvoiceOpen(false)}
        onOk={() => void linkExistingInvoice()}
        destroyOnHidden
      >
        <Alert
          showIcon
          type="warning"
          title="Migration and recovery action"
          description="The server verifies Stripe mode, currency, total, and existing commercial metadata before linking. It will not silently replace an active invoice."
          style={{ marginBottom: 16 }}
        />
        <Form form={linkInvoiceForm} layout="vertical">
          <Form.Item
            label="Stripe invoice ID"
            name="provider_invoice_id"
            rules={[
              { required: true, whitespace: true },
              {
                pattern: /^in_[A-Za-z0-9]+$/,
                message: "Enter a Stripe invoice ID beginning with in_",
              },
            ]}
          >
            <Input autoFocus placeholder="in_..." />
          </Form.Item>
          <Form.Item
            label="Audit reason"
            name="reason"
            rules={[{ required: true, min: 4, whitespace: true }]}
          >
            <Input.TextArea rows={3} maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Assign owner and next action"
        open={assignmentOpen}
        okText="Save assignment"
        okButtonProps={{ loading: busy }}
        onCancel={() => setAssignmentOpen(false)}
        onOk={() => void saveAssignment()}
        destroyOnHidden
      >
        <Form form={assignmentForm} layout="vertical">
          <Form.Item label="Assignee" name="assignee_account_id">
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
            />
          </Form.Item>
          <Paragraph type="secondary">
            Use an internal note for customer-specific context. The next action
            is a standard queue task.
          </Paragraph>
          <Form.Item label="Next action due" name="next_action_due_at">
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item
            label="Audit reason"
            name="reason"
            rules={[{ required: true, min: 4, whitespace: true }]}
          >
            <Input.TextArea rows={2} maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Add internal note"
        open={noteOpen}
        okText="Add note"
        okButtonProps={{ loading: busy }}
        onCancel={() => setNoteOpen(false)}
        onOk={() => void addNote()}
        destroyOnHidden
      >
        <Form form={noteForm} layout="vertical">
          <Form.Item
            label="Note"
            name="note"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input.TextArea autoFocus rows={5} maxLength={20000} />
          </Form.Item>
          <Form.Item
            label="Audit reason"
            name="reason"
            rules={[{ required: true, min: 4, whitespace: true }]}
          >
            <Input.TextArea rows={2} maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Record manual payment"
        open={paymentOpen}
        footer={
          <Flex justify="flex-end" gap="small" wrap>
            <Button
              disabled={busy}
              onClick={() => {
                if (paymentPreview) {
                  setPaymentPreview(null);
                  setPaymentReviewed(false);
                } else {
                  setPaymentOpen(false);
                }
              }}
            >
              {paymentPreview ? "Return to edit" : "Cancel"}
            </Button>
            {paymentPreview ? (
              <Button
                type="primary"
                loading={busy}
                disabled={!paymentReviewed}
                onClick={() => void recordPayment()}
              >
                Record reviewed payment (fresh authentication required)
              </Button>
            ) : (
              <Button type="primary" onClick={() => void reviewPayment()}>
                Review payment
              </Button>
            )}
          </Flex>
        }
        onCancel={() => {
          if (!busy) {
            setPaymentOpen(false);
            setPaymentPreview(null);
            setPaymentReviewed(false);
          }
        }}
        width={650}
        destroyOnHidden
      >
        {actionError ? (
          <ErrorDisplay
            error={actionError}
            title="Payment was not recorded"
            onClose={() => setActionError("")}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        {paymentPreview ? (
          <Flex vertical gap="middle">
            <Title
              level={5}
              id="receivables-payment-review-title"
              tabIndex={-1}
            >
              Review verified payment
            </Title>
            <Alert
              showIcon
              type="warning"
              title="This records funds as received"
              description="Confirm the amount, currency, date, method, related invoice, and non-sensitive evidence before continuing."
            />
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="Amount">
                {formatMoney(paymentPreview.amount, paymentPreview.currency)}
              </Descriptions.Item>
              <Descriptions.Item label="Method">
                {humanizeKey(paymentPreview.method)}
              </Descriptions.Item>
              <Descriptions.Item label="Received at">
                {formatDate(
                  paymentPreview.received_at
                    ? new Date(paymentPreview.received_at).toISOString()
                    : undefined,
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Related invoice">
                {paymentPreview.commercial_invoice_id
                  ? formatShortId(paymentPreview.commercial_invoice_id)
                  : "No specific invoice"}
              </Descriptions.Item>
              <Descriptions.Item label="Evidence reference">
                {paymentPreview.evidence_reference}
              </Descriptions.Item>
              <Descriptions.Item label="Audit reason">
                {paymentPreview.reason}
              </Descriptions.Item>
            </Descriptions>
            <Checkbox
              checked={paymentReviewed}
              onChange={(event) => setPaymentReviewed(event.target.checked)}
            >
              I verified the funds were received and reviewed this payment
              record.
            </Checkbox>
          </Flex>
        ) : (
          <>
            <Alert
              showIcon
              type="warning"
              title="Record only verified funds received"
              description="Use a non-sensitive bank, check, or accounting reference. Do not enter card or bank credentials."
              style={{ marginBottom: 16 }}
            />
            <Form form={paymentForm} layout="vertical">
              <Flex gap="middle" wrap>
                <Form.Item
                  label="Amount"
                  name="amount"
                  rules={[{ required: true, whitespace: true }]}
                  style={{ flex: "1 1 180px" }}
                >
                  <Input inputMode="decimal" />
                </Form.Item>
                <Form.Item
                  label="Currency"
                  name="currency"
                  rules={[{ required: true, whitespace: true }]}
                  style={{ flex: "1 1 120px" }}
                >
                  <Input />
                </Form.Item>
                <Form.Item
                  label="Method"
                  name="method"
                  rules={[{ required: true }]}
                  style={{ flex: "1 1 180px" }}
                >
                  <Select
                    options={COMMERCIAL_PAYMENT_METHODS.map((value) => ({
                      value,
                      label: humanizeKey(value),
                    }))}
                  />
                </Form.Item>
              </Flex>
              <Form.Item label="Received at" name="received_at">
                <Input type="datetime-local" />
              </Form.Item>
              <Form.Item label="Related invoice" name="commercial_invoice_id">
                <Select
                  allowClear
                  options={order.invoices.map((invoice) => ({
                    value: invoice.id,
                    label: `${invoice.provider_invoice_id ?? invoiceReference(invoice) ?? formatShortId(invoice.id)} (${humanizeKey(invoice.status)})`,
                  }))}
                />
              </Form.Item>
              <Form.Item
                label="Evidence reference"
                name="evidence_reference"
                extra="For example, a check number or bank transfer reference. Never enter payment credentials."
                rules={[{ required: true, whitespace: true }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                label="Audit reason"
                name="reason"
                rules={[{ required: true, min: 4, whitespace: true }]}
              >
                <Input.TextArea rows={2} maxLength={2000} />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>

      <Modal
        title="Issue manual invoice"
        open={manualInvoiceOpen}
        width={680}
        footer={
          <Flex justify="flex-end" gap="small" wrap>
            <Button
              disabled={busy}
              onClick={() => {
                if (manualInvoicePreview) {
                  setManualInvoicePreview(null);
                  setManualInvoiceReviewed(false);
                } else {
                  setManualInvoiceOpen(false);
                }
              }}
            >
              {manualInvoicePreview ? "Return to edit" : "Cancel"}
            </Button>
            {manualInvoicePreview ? (
              <Button
                type="primary"
                loading={busy}
                disabled={!manualInvoiceReviewed}
                onClick={() => void issueManualInvoice()}
              >
                Issue reviewed invoice (fresh authentication required)
              </Button>
            ) : (
              <Button type="primary" onClick={() => void reviewManualInvoice()}>
                Review manual invoice
              </Button>
            )}
          </Flex>
        }
        onCancel={() => {
          if (!busy) {
            setManualInvoiceOpen(false);
            setManualInvoicePreview(null);
            setManualInvoiceReviewed(false);
          }
        }}
        destroyOnHidden
      >
        {manualInvoicePreview ? (
          <Flex vertical gap="middle">
            <Title
              level={5}
              id="receivables-manual-invoice-review-title"
              tabIndex={-1}
            >
              Review manual invoice record
            </Title>
            <Alert
              showIcon
              type="warning"
              title="CoCalc will not send this invoice"
              description="This records an invoice created and delivered outside Stripe. Verify that the reference and optional document correspond to the reviewed agreement."
            />
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="Invoice reference">
                {manualInvoicePreview.invoice_reference}
              </Descriptions.Item>
              <Descriptions.Item label="Amount">
                {formatMoney(order.agreed_total, order.currency)}
              </Descriptions.Item>
              <Descriptions.Item label="Due">
                {manualInvoicePreview.due_at
                  ? formatDate(
                      new Date(manualInvoicePreview.due_at).toISOString(),
                    )
                  : `${order.payment_terms_days ?? 21} days after issuance`}
              </Descriptions.Item>
              <Descriptions.Item label="Document URL">
                {manualInvoicePreview.document_url || "Not linked"}
              </Descriptions.Item>
              <Descriptions.Item label="Evidence reference">
                {manualInvoicePreview.evidence_reference || "Not recorded"}
              </Descriptions.Item>
              <Descriptions.Item label="Audit reason">
                {manualInvoicePreview.reason}
              </Descriptions.Item>
            </Descriptions>
            <Checkbox
              checked={manualInvoiceReviewed}
              onChange={(event) =>
                setManualInvoiceReviewed(event.target.checked)
              }
            >
              I reviewed the manual invoice reference, due date, document, and
              evidence against this agreement.
            </Checkbox>
          </Flex>
        ) : (
          <>
            <Alert
              showIcon
              type="info"
              title="Record an externally managed invoice"
              description="Use this only for an approved manual-invoice order. The action is capability-gated, fresh-authenticated, and audited."
              style={{ marginBottom: 16 }}
            />
            <Form form={manualInvoiceForm} layout="vertical">
              <Form.Item
                label="Invoice reference"
                name="invoice_reference"
                rules={[{ required: true, whitespace: true, max: 240 }]}
              >
                <Input
                  autoFocus
                  placeholder="Invoice or accounting reference"
                />
              </Form.Item>
              <Form.Item label="Due at" name="due_at">
                <Input type="datetime-local" />
              </Form.Item>
              <Form.Item
                label="Document URL"
                name="document_url"
                extra="Optional HTTPS link to the invoice in the institution's accounting system."
                rules={[
                  {
                    validator: async (_, value) => {
                      if (!value) return;
                      let url: URL;
                      try {
                        url = new URL(value);
                      } catch {
                        throw Error("Enter a valid HTTPS URL.");
                      }
                      if (url.protocol !== "https:") {
                        throw Error("Enter a valid HTTPS URL.");
                      }
                    },
                  },
                ]}
              >
                <Input type="url" placeholder="https://..." />
              </Form.Item>
              <Form.Item
                label="Evidence reference"
                name="evidence_reference"
                extra="Optional non-sensitive reference showing where the invoice was created or delivered."
              >
                <Input />
              </Form.Item>
              <Form.Item
                label="Audit reason"
                name="reason"
                rules={[{ required: true, min: 4, whitespace: true }]}
              >
                <Input.TextArea rows={3} maxLength={2000} />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>

      <InvoicePreviewModal
        busy={busy}
        preview={invoicePreview}
        onClose={() => setInvoicePreview(null)}
        onCreateDraft={() => requestCreateInvoiceDraft(order)}
      />
      <FulfillmentPreviewModal
        allowBeforePayment={allowBeforePayment}
        busy={busy}
        collectionComplete={collectionComplete}
        preview={fulfillmentPreview}
        onAllowBeforePaymentChange={setAllowBeforePayment}
        onClose={() => setFulfillmentPreview(null)}
        onProvision={() => requestProvision(order)}
      />
      <CommercialOrderEditModal
        mode={editMode ?? (order.approved_at ? "revise" : "update")}
        open={editMode != null}
        order={order}
        onClose={() => setEditMode(null)}
        onSaved={async (saved) => {
          setOrder(saved);
          await reloadEvents(saved.id);
        }}
      />
      <ReconcilePreviewModal
        busy={busy}
        preview={reconcilePreview}
        onClose={() => setReconcilePreview(null)}
        onReconcile={() => {
          const invoice = order.invoices.find(
            ({ id }) => id === reconcilePreview?.commercial_invoice_id,
          );
          if (invoice) requestReconcileInvoice(order, invoice);
        }}
      />
      <ReasonActionModal
        action={reasonAction}
        actionError={actionError}
        busy={busy}
        onClearError={() => setActionError("")}
        onClose={() => setReasonAction(null)}
      />
      <FreshAuthModal {...freshAuthModalProps} />
    </Flex>
  );
}
