/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  Alert,
  Button,
  Card,
  Collapse,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
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

import type { AdminSupportShowResponse } from "@cocalc/conat/hub/api/admin-support";
import type {
  CrmOutreachFollowUp,
  CrmOutreachPreview,
} from "@cocalc/conat/hub/api/crm";
import {
  FreshAuthModal,
  useFreshAuthAction,
} from "@cocalc/frontend/auth/fresh-auth";
import {
  ErrorDisplay,
  Icon,
  TimeAgo,
  Tooltip,
} from "@cocalc/frontend/components";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import type { CrmMutationResult } from "@cocalc/util/crm";
import {
  CRM_OUTREACH_DELIVERY_STATES,
  CRM_OUTREACH_FOLLOW_UP_POLICIES,
  CRM_OUTREACH_KINDS,
  CRM_OUTREACH_SUGGESTED_ACTIONS,
  CRM_OUTREACH_SUPPRESSION_REASONS,
  CRM_OUTREACH_SUPPRESSION_SCOPES,
  CRM_OUTREACH_VIEW_CAVEAT,
  type CrmContactSuppression,
  type CrmOutreachBatch,
  type CrmOutreachBatchDetail,
  type CrmOutreachDelivery,
  type CrmOutreachDiagnostics,
  type CrmOutreachLimits,
  type CrmOutreachProviderOperation,
  type CrmOutreachTemplate,
} from "@cocalc/util/crm-outreach";
import { COLORS } from "@cocalc/util/theme";
import { AccountSelector } from "../receivables/account-selector";
import {
  AccountIdentity,
  useAccountDisplayNames,
} from "../receivables/account-names";
import { crmMutationContext } from "./helpers";
import {
  CustomerSelector,
  OpportunitySelector,
  PersonSelector,
} from "./selector";
import "./outreach.css";

const { Paragraph, Text, Title } = Typography;
type MutationPreview = Extract<CrmMutationResult<any>, { preview: true }>;
type QueueView = "deliveries" | "batches" | "templates" | "suppressions";

type OutreachAction =
  | { kind: "create-batch" }
  | { kind: "create-template" }
  | { kind: "add-recipient"; batch?: CrmOutreachBatch }
  | {
      kind: "batch-transition";
      batch: CrmOutreachBatch;
      transition: "approve" | "queue" | "pause" | "resume" | "cancel";
    }
  | {
      kind: "template-transition";
      template: CrmOutreachTemplate;
      transition: "activate" | "retire";
    }
  | {
      kind: "delivery-action";
      delivery: CrmOutreachDelivery;
      transition: "retry" | "reconcile" | "cancel";
    }
  | { kind: "add-suppression"; delivery?: CrmOutreachDelivery }
  | { kind: "revoke-suppression"; suppression: CrmContactSuppression }
  | { kind: "follow-up"; delivery: CrmOutreachDelivery }
  | {
      kind: "task-transition";
      delivery: CrmOutreachDelivery;
      transition: "reschedule" | "complete" | "cancel";
    };

function humanize(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusColor(value: string): string {
  if (
    ["active", "complete", "replied", "notification_requested"].includes(value)
  )
    return "green";
  if (["failed", "cancelled", "suppressed", "retired"].includes(value))
    return value === "failed" ? "red" : "default";
  if (["queued", "sending", "creating_ticket"].includes(value)) return "blue";
  if (["paused", "approved"].includes(value)) return "orange";
  return "gold";
}

function usagePercent(value: number, maximum: number): number {
  if (!maximum) return 0;
  return Math.min(100, Math.round((value / maximum) * 100));
}

function actionTitle(action?: OutreachAction): string {
  if (!action) return "Outreach action";
  switch (action.kind) {
    case "create-batch":
      return "Create outreach batch";
    case "create-template":
      return "Create template revision";
    case "add-recipient":
      return "Add reviewed recipient";
    case "add-suppression":
      return "Add contact suppression";
    case "revoke-suppression":
      return "Revoke contact suppression";
    case "follow-up":
      return "Queue reviewed Zendesk follow-up";
    case "batch-transition":
      return `${humanize(action.transition)} ${action.batch.outreach_number}`;
    case "template-transition":
      return `${humanize(action.transition)} ${action.template.template_key}@${action.template.revision}`;
    case "delivery-action":
      return `${humanize(action.transition)} delivery`;
    case "task-transition":
      return `${humanize(action.transition)} shared follow-up task`;
  }
}

function BatchApprovalReview({ value }: { value: CrmOutreachPreview }) {
  const names = useAccountDisplayNames([value.batch.owner_account_id]);
  return (
    <Flex vertical gap={12}>
      <Alert
        description="These recipient, routing, and message snapshots are the exact records being approved. Any draft change invalidates the optimistic version and requires a new review."
        showIcon
        title={`${value.batch.outreach_number}: final immutable message review`}
        type={value.can_approve || value.can_queue ? "success" : "warning"}
      />
      <Descriptions bordered column={1} size="small">
        <Descriptions.Item label="Batch owner">
          <AccountIdentity
            accountId={value.batch.owner_account_id}
            names={names}
          />
        </Descriptions.Item>
        <Descriptions.Item label="Template revision">
          {`${value.batch.template_snapshot.template_key ?? "Custom"}@${value.batch.template_snapshot.revision ?? "snapshot"}`}
        </Descriptions.Item>
        <Descriptions.Item label="Zendesk routing">
          {[
            value.provider_routing.support_address,
            value.provider_routing.group_id,
          ]
            .filter(Boolean)
            .join(" · ") || "Not configured"}
        </Descriptions.Item>
        <Descriptions.Item label="Recipients">
          {value.deliveries.length}
        </Descriptions.Item>
      </Descriptions>
      {value.deliveries.map(({ delivery, blocking_errors, warnings }) => (
        <Card
          key={delivery.id}
          size="small"
          title={`${delivery.recipient_name} · ${delivery.normalized_email}`}
        >
          <Flex vertical gap={8}>
            {blocking_errors.map((item) => (
              <Alert key={item} showIcon title={item} type="error" />
            ))}
            {warnings.map((item) => (
              <Alert key={item} showIcon title={item} type="warning" />
            ))}
            <Text strong>{delivery.subject}</Text>
            <pre className="crm-outreach-message">
              {delivery.body_plain_text}
            </pre>
          </Flex>
        </Card>
      ))}
    </Flex>
  );
}

function ReviewPanel({
  batchReview,
  preview,
}: {
  batchReview?: CrmOutreachPreview;
  preview: MutationPreview;
}) {
  return (
    <Flex vertical gap={12}>
      {batchReview ? <BatchApprovalReview value={batchReview} /> : null}
      <Alert
        description="Nothing has changed yet. Confirming repeats this exact operation with fresh authentication."
        showIcon
        title="Review the proposed outreach change"
        type="info"
      />
      {preview.warnings.map((warning) => (
        <Alert key={warning} showIcon title={warning} type="warning" />
      ))}
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
      <Collapse
        items={[
          {
            key: "fields",
            label: "Exact proposed fields",
            children: (
              <pre className="crm-outreach-json">
                {JSON.stringify(preview.proposed, null, 2)}
              </pre>
            ),
          },
        ]}
      />
    </Flex>
  );
}

function OutreachActionModal({
  action,
  batches,
  templates,
  onClose,
  onCommitted,
}: {
  action: OutreachAction | null;
  batches: CrmOutreachBatch[];
  templates: CrmOutreachTemplate[];
  onClose: () => void;
  onCommitted: () => Promise<void>;
}) {
  const api = webapp_client.conat_client.hub.adminCrm;
  const [form] = Form.useForm();
  const [preview, setPreview] = useState<MutationPreview | null>(null);
  const [batchReview, setBatchReview] = useState<CrmOutreachPreview>();
  const [request, setRequest] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>("");
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction();
  const organization = Form.useWatch("organization", form);

  useEffect(() => {
    form.resetFields();
    setPreview(null);
    setBatchReview(undefined);
    setRequest(null);
    setError("");
    if (!action) return;
    form.setFieldsValue({
      kind: "adoption_pilot",
      follow_up_policy: "no_response",
      scope: "email",
      suppression_reason: "manual",
      batch: action.kind === "add-recipient" ? action.batch?.id : undefined,
      email:
        action.kind === "add-suppression"
          ? action.delivery?.normalized_email
          : undefined,
    });
    if (action.kind === "follow-up") {
      setFollowUpLoading(true);
      void api
        .previewOutreachFollowup({
          delivery: action.delivery.id,
          reason: "Prepare reviewed CRM outreach follow-up",
        })
        .then((value) => form.setFieldValue("body", value.body))
        .catch(setError)
        .finally(() => setFollowUpLoading(false));
    }
  }, [action]);

  async function call(
    values: Record<string, any>,
    commit: boolean,
    previous?: MutationPreview,
  ) {
    if (!action) throw Error("outreach action is required");
    const common = crmMutationContext({
      browserId: webapp_client.browser_id,
      commit,
      previous,
      reason: values.reason,
    });
    switch (action.kind) {
      case "create-batch":
        return await api.createOutreachBatch({
          ...common,
          name: values.name,
          purpose: values.purpose,
          kind: values.kind,
          owner_account_id: values.owner_account_id,
          template: values.template,
        });
      case "create-template":
        return await api.createOutreachTemplate({
          ...common,
          template_key: values.template_key,
          name: values.name,
          kind: values.kind,
          subject_template: values.subject_template,
          body_markdown_template: values.body_markdown_template,
          required_fields: `${values.required_fields ?? ""}`
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          follow_up_policy: values.follow_up_policy,
          follow_up_after_days: values.follow_up_after_days,
          max_followups: values.max_followups,
          final_review_after_days: values.final_review_after_days,
        });
      case "add-recipient":
        return await api.addOutreachRecipient({
          ...common,
          batch: values.batch,
          organization: values.organization,
          person: values.person,
          opportunity: values.opportunity || undefined,
          email: values.email || undefined,
          subject: values.subject || undefined,
          body_markdown: values.body_markdown || undefined,
          override_reason: values.override_reason || undefined,
        });
      case "batch-transition":
        return await api.transitionOutreachBatch({
          ...common,
          batch: action.batch.id,
          action: action.transition,
        });
      case "template-transition":
        return await api.transitionOutreachTemplate({
          ...common,
          template: action.template.id,
          action: action.transition,
        });
      case "delivery-action":
        return await api.mutateOutreachDelivery({
          ...common,
          delivery: action.delivery.id,
          action: action.transition,
        });
      case "add-suppression":
        return await api.mutateContactSuppression({
          ...common,
          action: "add",
          scope: values.scope,
          value: values.value,
          organization: values.organization,
          person: values.person,
          email: values.email,
          suppression_reason: values.suppression_reason,
          note: values.note,
        });
      case "revoke-suppression":
        return await api.mutateContactSuppression({
          ...common,
          action: "revoke",
          suppression: action.suppression.id,
        });
      case "follow-up":
        return await api.sendOutreachFollowup({
          ...common,
          delivery: action.delivery.id,
          body: values.body,
        });
      case "task-transition": {
        if (!action.delivery.task_id)
          throw Error("delivery has no shared follow-up task");
        return await api.transitionTask({
          ...common,
          task: action.delivery.task_id,
          action: action.transition,
          due_at: values.due_at?.toISOString(),
        });
      }
    }
  }

  async function submit() {
    setError("");
    setBusy(true);
    try {
      if (!preview) {
        const values = await form.validateFields();
        const exactBatchReview =
          action?.kind === "batch-transition" &&
          ["approve", "queue"].includes(action.transition)
            ? await api.previewOutreachBatch({
                batch: action.batch.id,
                reason: values.reason,
              })
            : undefined;
        const result = await call(values, false);
        if (!result.preview)
          throw Error("outreach preview unexpectedly committed");
        setRequest(values);
        setBatchReview(exactBatchReview);
        setPreview(result);
        return;
      }
      const completed = await runFreshAuthAction(async () => {
        const result = await call(request ?? {}, true, preview);
        if (result.preview)
          throw Error("outreach commit unexpectedly returned a preview");
        message.success("CRM outreach updated");
        await onCommitted();
        onClose();
      });
      if (!completed) return;
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function fields() {
    if (!action) return null;
    switch (action.kind) {
      case "create-batch":
        return (
          <>
            <Form.Item
              label="Batch name"
              name="name"
              rules={[{ required: true }]}
            >
              <Input autoFocus />
            </Form.Item>
            <Form.Item
              label="Reviewed purpose"
              name="purpose"
              rules={[{ required: true }]}
            >
              <Input.TextArea maxLength={2000} rows={3} />
            </Form.Item>
            <Form.Item
              label="Outreach kind"
              name="kind"
              rules={[{ required: true }]}
            >
              <Select
                options={CRM_OUTREACH_KINDS.map((value) => ({
                  value,
                  label: humanize(value),
                }))}
              />
            </Form.Item>
            <Form.Item
              label="Responsible owner"
              name="owner_account_id"
              rules={[{ required: true }]}
            >
              <AccountSelector
                accountKind="admin"
                ariaLabel="Responsible owner"
              />
            </Form.Item>
            <Form.Item label="Active template" name="template">
              <Select
                allowClear
                options={templates
                  .filter(({ status }) => status === "active")
                  .map((item) => ({
                    value: item.id,
                    label: `${item.name} · ${item.template_key}@${item.revision}`,
                  }))}
              />
            </Form.Item>
          </>
        );
      case "create-template":
        return (
          <>
            <Form.Item
              label="Template key"
              name="template_key"
              rules={[
                { required: true, pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
              ]}
            >
              <Input placeholder="adoption-pilot" />
            </Form.Item>
            <Form.Item
              label="Template name"
              name="name"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Form.Item label="Kind" name="kind" rules={[{ required: true }]}>
              <Select
                options={CRM_OUTREACH_KINDS.map((value) => ({
                  value,
                  label: humanize(value),
                }))}
              />
            </Form.Item>
            <Form.Item
              label="Subject template"
              name="subject_template"
              rules={[{ required: true }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              label="Markdown body template"
              name="body_markdown_template"
              rules={[{ required: true }]}
            >
              <Input.TextArea rows={8} />
            </Form.Item>
            <Form.Item
              label="Required merge fields"
              name="required_fields"
              extra="Comma-separated allowlisted fields, for example person.first_name, organization.display_name."
            >
              <Input />
            </Form.Item>
            <Form.Item label="Follow-up policy" name="follow_up_policy">
              <Select
                options={CRM_OUTREACH_FOLLOW_UP_POLICIES.map((value) => ({
                  value,
                  label: humanize(value),
                }))}
              />
            </Form.Item>
            <Flex gap={10} wrap>
              <Form.Item label="Follow up after" name="follow_up_after_days">
                <InputNumber min={1} max={90} addonAfter="days" />
              </Form.Item>
              <Form.Item label="Maximum follow-ups" name="max_followups">
                <InputNumber min={1} max={5} />
              </Form.Item>
              <Form.Item
                label="Final review after"
                name="final_review_after_days"
              >
                <InputNumber min={1} max={90} addonAfter="days" />
              </Form.Item>
            </Flex>
          </>
        );
      case "add-recipient":
        return (
          <>
            <Form.Item
              label="Draft batch"
              name="batch"
              rules={[{ required: true }]}
            >
              <Select
                options={batches
                  .filter(({ state }) => state === "draft")
                  .map((item) => ({
                    value: item.id,
                    label: `${item.outreach_number} · ${item.name}`,
                  }))}
              />
            </Form.Item>
            <Form.Item
              label="Organization"
              name="organization"
              rules={[{ required: true }]}
            >
              <CustomerSelector />
            </Form.Item>
            <Form.Item
              label="Reviewed contact"
              name="person"
              rules={[{ required: true }]}
            >
              <PersonSelector organization={organization} />
            </Form.Item>
            <Form.Item
              label="Specific reviewed email"
              name="email"
              extra="Leave blank to use the unambiguous primary verified email."
            >
              <Input type="email" />
            </Form.Item>
            <Form.Item label="Opportunity" name="opportunity">
              <OpportunitySelector organization={organization} />
            </Form.Item>
            <Form.Item
              label="Custom exact subject"
              name="subject"
              extra="Leave blank to render the active template."
            >
              <Input />
            </Form.Item>
            <Form.Item
              label="Custom Markdown body"
              name="body_markdown"
              extra="Leave blank to render the active template."
            >
              <Input.TextArea rows={7} />
            </Form.Item>
            <Form.Item label="Cooldown override reason" name="override_reason">
              <Input.TextArea maxLength={2000} rows={2} />
            </Form.Item>
          </>
        );
      case "add-suppression":
        return (
          <>
            <Alert
              showIcon
              type="warning"
              title="This immediately blocks queued and future outreach in the selected scope."
            />
            <Form.Item label="Scope" name="scope" rules={[{ required: true }]}>
              <Select
                options={CRM_OUTREACH_SUPPRESSION_SCOPES.map((value) => ({
                  value,
                  label: humanize(value),
                }))}
              />
            </Form.Item>
            <Form.Item
              label="Normalized value"
              name="value"
              extra="Email, domain, person UUID, or organization UUID."
            >
              <Input />
            </Form.Item>
            <Form.Item label="Organization" name="organization">
              <CustomerSelector />
            </Form.Item>
            <Form.Item label="Contact" name="person">
              <PersonSelector organization={organization} />
            </Form.Item>
            <Form.Item label="Email" name="email">
              <Input type="email" />
            </Form.Item>
            <Form.Item
              label="Reason"
              name="suppression_reason"
              rules={[{ required: true }]}
            >
              <Select
                options={CRM_OUTREACH_SUPPRESSION_REASONS.map((value) => ({
                  value,
                  label: humanize(value),
                }))}
              />
            </Form.Item>
            <Form.Item label="Internal note" name="note">
              <Input.TextArea rows={3} />
            </Form.Item>
          </>
        );
      case "follow-up":
        return followUpLoading ? (
          <Spin description="Preparing reviewed follow-up" />
        ) : (
          <>
            <Alert
              description="This creates a public comment on the existing Zendesk ticket. It never mentions view tracking."
              showIcon
              title={`Zendesk ticket ${action.delivery.zendesk_ticket_id}`}
              type="info"
            />
            <Form.Item
              label="Exact follow-up body"
              name="body"
              rules={[{ required: true }]}
            >
              <Input.TextArea rows={9} />
            </Form.Item>
          </>
        );
      case "task-transition":
        return action.transition === "reschedule" ? (
          <Form.Item
            label="New due time"
            name="due_at"
            rules={[{ required: true }]}
          >
            <DatePicker showTime style={{ width: "100%" }} />
          </Form.Item>
        ) : (
          <Alert
            showIcon
            title={`${humanize(action.transition)} the existing shared CRM task`}
            type={action.transition === "cancel" ? "warning" : "info"}
          />
        );
      case "revoke-suppression":
        return (
          <Alert
            showIcon
            title={`Restore eligibility for ${action.suppression.normalized_scope_value}`}
            type="warning"
          />
        );
      case "batch-transition":
      case "template-transition":
      case "delivery-action":
        return (
          <Alert
            showIcon
            title={`Review ${humanize(action.transition)} before confirming`}
            type={action.transition === "cancel" ? "warning" : "info"}
          />
        );
    }
  }

  return (
    <>
      <Modal
        cancelButtonProps={{ disabled: busy }}
        destroyOnHidden
        okButtonProps={{
          danger:
            action?.kind === "revoke-suppression" ||
            ("transition" in (action ?? {}) &&
              (action as any).transition === "cancel"),
          loading: busy,
        }}
        okText={preview ? "Confirm with fresh auth" : "Review change"}
        onCancel={onClose}
        onOk={() => void submit()}
        open={action != null}
        title={actionTitle(action ?? undefined)}
        width={720}
      >
        {error ? (
          <ErrorDisplay
            error={error}
            onClose={() => setError("")}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        {preview ? (
          <ReviewPanel batchReview={batchReview} preview={preview} />
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

function DeliveryCard({
  delivery,
  onAction,
  onOpen,
}: {
  delivery: CrmOutreachDelivery;
  onAction: (action: OutreachAction) => void;
  onOpen: () => void;
}) {
  const overdue =
    delivery.follow_up_due_at &&
    new Date(delivery.follow_up_due_at) < new Date() &&
    !delivery.replied_at;
  return (
    <Card className="crm-record-card crm-outreach-delivery" size="small">
      <Flex vertical gap={10}>
        <Flex align="start" gap={8} justify="space-between" wrap>
          <div style={{ minWidth: 0 }}>
            <Text className="crm-wrap-anywhere" strong>
              {delivery.recipient_name}
            </Text>
            <br />
            <Text className="crm-wrap-anywhere" type="secondary">
              {delivery.normalized_email}
            </Text>
          </div>
          <Tag color={statusColor(delivery.state)}>
            {humanize(delivery.state)}
          </Tag>
        </Flex>
        <Text ellipsis={{ tooltip: delivery.subject }}>{delivery.subject}</Text>
        <Flex gap={5} wrap>
          <Tag>{humanize(delivery.kind)}</Tag>
          {delivery.view_observation_count ? (
            <Tooltip title={CRM_OUTREACH_VIEW_CAVEAT}>
              <span tabIndex={0}>
                <Tag color="cyan">
                  <Icon name="eye" /> View observed ·{" "}
                  {delivery.view_observation_count}
                </Tag>
              </span>
            </Tooltip>
          ) : null}
          {delivery.zendesk_ticket_id ? (
            <Tag color="blue">Zendesk {delivery.zendesk_ticket_id}</Tag>
          ) : null}
        </Flex>
        {delivery.follow_up_due_at ? (
          <Text type={overdue ? "danger" : "secondary"}>
            {humanize(delivery.follow_up_suggested_action)} · due{" "}
            <TimeAgo date={delivery.follow_up_due_at} />
          </Text>
        ) : null}
        {delivery.last_error ? (
          <Alert showIcon title={delivery.last_error} type="error" />
        ) : null}
        <Flex gap={8} wrap>
          <Button onClick={onOpen} size="small" type="primary">
            Review
          </Button>
          {delivery.state === "failed" ? (
            <Button
              onClick={() =>
                onAction({
                  kind: "delivery-action",
                  delivery,
                  transition: "retry",
                })
              }
              size="small"
            >
              Retry
            </Button>
          ) : null}
          {["creating_ticket", "notification_requested"].includes(
            delivery.state,
          ) ? (
            <Button
              onClick={() =>
                onAction({
                  kind: "delivery-action",
                  delivery,
                  transition: "reconcile",
                })
              }
              size="small"
            >
              Sync
            </Button>
          ) : null}
          {delivery.zendesk_ticket_id ? (
            <Button
              href={`https://sagemathcloud.zendesk.com/agent/tickets/${delivery.zendesk_ticket_id}`}
              icon={<Icon name="external-link" />}
              size="small"
              target="_blank"
            >
              Zendesk
            </Button>
          ) : null}
        </Flex>
      </Flex>
    </Card>
  );
}

function DeliveryDrawer({
  delivery,
  onAction,
  onClose,
}: {
  delivery?: CrmOutreachDelivery;
  onAction: (action: OutreachAction) => void;
  onClose: () => void;
}) {
  const api = webapp_client.conat_client.hub.adminCrm;
  const [operations, setOperations] = useState<CrmOutreachProviderOperation[]>(
    [],
  );
  const [engagement, setEngagement] = useState<
    Array<{ id: string; observed_at: string }>
  >([]);
  const [thread, setThread] = useState<AdminSupportShowResponse>();
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<unknown>("");

  useEffect(() => {
    setOperations([]);
    setEngagement([]);
    setThread(undefined);
    setError("");
    if (!delivery) return;
    void Promise.all([
      api.listOutreachProviderOperations({
        delivery: delivery.id,
        reason: "Review CRM outreach provider attempts",
        limit: 100,
      }),
      api.listOutreachEngagementEvents({
        delivery: delivery.id,
        reason: "Review CRM outreach engagement timeline",
        limit: 100,
      }),
    ])
      .then(([nextOperations, nextEngagement]) => {
        setOperations(nextOperations.operations);
        setEngagement(nextEngagement.events);
      })
      .catch(setError);
  }, [delivery?.id]);

  async function loadThread() {
    if (!delivery?.zendesk_ticket_id) return;
    setThreadLoading(true);
    setError("");
    try {
      setThread(
        await webapp_client.conat_client.hub.adminSupport.show({
          ticket_id: delivery.zendesk_ticket_id,
          max_comments: 100,
          max_bytes: 500_000,
          reason: `Review Zendesk thread linked to CRM outreach ${delivery.id}`,
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setThreadLoading(false);
    }
  }

  if (!delivery) return null;
  return (
    <Drawer
      onClose={onClose}
      open
      placement="right"
      size="large"
      title={delivery.subject}
    >
      <Flex vertical gap={16}>
        {error ? (
          <ErrorDisplay error={error} onClose={() => setError("")} />
        ) : null}
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="Recipient">
            {delivery.recipient_name} · {delivery.normalized_email}
          </Descriptions.Item>
          <Descriptions.Item label="State">
            <Tag color={statusColor(delivery.state)}>
              {humanize(delivery.state)}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Zendesk ticket">
            {delivery.zendesk_ticket_id ?? "Not created"}
          </Descriptions.Item>
          <Descriptions.Item label="CRM links">
            <Space wrap>
              <a href={`/admin/customers/${delivery.organization_id}`}>
                Organization
              </a>
              <Text copyable>{delivery.person_id}</Text>
              {delivery.opportunity_id ? (
                <Text copyable>{delivery.opportunity_id}</Text>
              ) : null}
              {delivery.task_id ? (
                <Text copyable>{delivery.task_id}</Text>
              ) : null}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="Notification requested">
            {delivery.notification_requested_at ? (
              <TimeAgo date={delivery.notification_requested_at} />
            ) : (
              "Not yet"
            )}
          </Descriptions.Item>
          <Descriptions.Item label="View observations">
            <Tooltip title={CRM_OUTREACH_VIEW_CAVEAT}>
              <span>
                {delivery.view_observation_count}
                {delivery.last_view_observed_at ? (
                  <>
                    {" "}
                    · latest <TimeAgo date={delivery.last_view_observed_at} />
                  </>
                ) : null}
              </span>
            </Tooltip>
          </Descriptions.Item>
          <Descriptions.Item label="Follow-up">
            {delivery.follow_up_attempt_count}/{delivery.max_followups} ·{" "}
            {humanize(delivery.follow_up_suggested_action)}
          </Descriptions.Item>
        </Descriptions>
        <Card size="small" title="Exact approved opening message">
          <Paragraph strong>{delivery.subject}</Paragraph>
          <pre className="crm-outreach-message">{delivery.body_plain_text}</pre>
        </Card>
        <Alert
          description={CRM_OUTREACH_VIEW_CAVEAT}
          showIcon
          title="View observed is context, not proof of reading"
          type="info"
        />
        <Card size="small" title="Provider attempts">
          {operations.length ? (
            <Flex vertical gap={8}>
              {operations.map((operation) => (
                <div className="crm-outreach-operation" key={operation.id}>
                  <Flex gap={8} justify="space-between" wrap>
                    <Text strong>
                      {humanize(operation.operation)} · attempt{" "}
                      {operation.attempt_number}
                    </Text>
                    <Tag color={statusColor(operation.state)}>
                      {humanize(operation.state)}
                    </Tag>
                  </Flex>
                  <Text type="secondary">
                    <TimeAgo date={operation.created_at} />
                    {operation.provider_status
                      ? ` · ${operation.provider_status}`
                      : ""}
                  </Text>
                  {operation.error_text ? (
                    <Collapse
                      ghost
                      items={[
                        {
                          key: "error",
                          label: operation.error_category
                            ? humanize(operation.error_category)
                            : "Technical details",
                          children: (
                            <pre className="crm-outreach-json">
                              {operation.error_text}
                            </pre>
                          ),
                        },
                      ]}
                    />
                  ) : null}
                </div>
              ))}
            </Flex>
          ) : (
            <Empty
              description="No provider attempts yet"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}
        </Card>
        {engagement.length ? (
          <Card size="small" title="Engagement timeline">
            <Flex vertical gap={6}>
              {engagement.map((event) => (
                <Text key={event.id}>
                  <Icon name="eye" /> View observed{" "}
                  <TimeAgo date={event.observed_at} />
                </Text>
              ))}
            </Flex>
          </Card>
        ) : null}
        {thread ? (
          <Card
            size="small"
            title={`Redacted Zendesk thread · ${thread.comments.length} comments`}
          >
            <Flex vertical gap={10}>
              {thread.comments.map((comment) => (
                <div className="crm-outreach-comment" key={comment.id}>
                  <Flex gap={8} justify="space-between" wrap>
                    <Text strong>{humanize(comment.author)}</Text>
                    <Text type="secondary">
                      <TimeAgo date={comment.created_at} />
                    </Text>
                  </Flex>
                  <Paragraph
                    className="crm-wrap-anywhere"
                    style={{ whiteSpace: "pre-wrap" }}
                  >
                    {comment.body}
                  </Paragraph>
                </div>
              ))}
              {thread.truncated ? (
                <Alert
                  showIcon
                  title="Thread output was truncated"
                  type="warning"
                />
              ) : null}
            </Flex>
          </Card>
        ) : null}
        <Flex gap={8} wrap>
          {delivery.zendesk_ticket_id &&
          !delivery.replied_at &&
          delivery.task_id ? (
            <Button
              onClick={() => onAction({ kind: "follow-up", delivery })}
              type="primary"
            >
              Review follow-up
            </Button>
          ) : null}
          {delivery.task_id ? (
            <Button
              onClick={() =>
                onAction({
                  kind: "task-transition",
                  delivery,
                  transition: "reschedule",
                })
              }
            >
              Reschedule task
            </Button>
          ) : null}
          {delivery.task_id ? (
            <Button
              onClick={() =>
                onAction({
                  kind: "task-transition",
                  delivery,
                  transition: "cancel",
                })
              }
            >
              Cancel task
            </Button>
          ) : null}
          {["draft", "approved", "queued", "failed"].includes(
            delivery.state,
          ) ? (
            <Button
              danger
              onClick={() =>
                onAction({
                  kind: "delivery-action",
                  delivery,
                  transition: "cancel",
                })
              }
            >
              Cancel delivery
            </Button>
          ) : null}
          <Button
            onClick={() => onAction({ kind: "add-suppression", delivery })}
          >
            Suppress contact
          </Button>
          {delivery.zendesk_ticket_id && !thread ? (
            <Button loading={threadLoading} onClick={() => void loadThread()}>
              Load redacted thread
            </Button>
          ) : null}
          {delivery.task_id ? (
            <Button
              onClick={() =>
                onAction({
                  kind: "task-transition",
                  delivery,
                  transition: "complete",
                })
              }
            >
              Complete task
            </Button>
          ) : null}
          {delivery.zendesk_ticket_id ? (
            <Button
              href={`https://sagemathcloud.zendesk.com/agent/tickets/${delivery.zendesk_ticket_id}`}
              icon={<Icon name="external-link" />}
              target="_blank"
            >
              Open Zendesk
            </Button>
          ) : null}
        </Flex>
      </Flex>
    </Drawer>
  );
}

function BatchDrawer({
  batch,
  onAction,
  onClose,
}: {
  batch?: CrmOutreachBatch;
  onAction: (action: OutreachAction) => void;
  onClose: () => void;
}) {
  const api = webapp_client.conat_client.hub.adminCrm;
  const [detail, setDetail] = useState<CrmOutreachBatchDetail>();
  const [preview, setPreview] = useState<CrmOutreachPreview>();
  const [error, setError] = useState<unknown>("");
  useEffect(() => {
    setDetail(undefined);
    setPreview(undefined);
    setError("");
    if (!batch) return;
    void Promise.all([
      api.getOutreachBatch({
        batch: batch.id,
        reason: "Review CRM outreach batch detail",
      }),
      api.previewOutreachBatch({
        batch: batch.id,
        reason: "Review exact CRM outreach recipients",
      }),
    ])
      .then(([nextDetail, nextPreview]) => {
        setDetail(nextDetail);
        setPreview(nextPreview);
      })
      .catch(setError);
  }, [batch?.id]);
  return (
    <Drawer
      onClose={onClose}
      open={!!batch}
      placement="right"
      size="large"
      title={
        batch ? `${batch.outreach_number} · ${batch.name}` : "Outreach batch"
      }
    >
      {error ? (
        <ErrorDisplay error={error} onClose={() => setError("")} />
      ) : null}
      {!detail || !preview ? (
        <Spin description="Rendering exact outreach preview" />
      ) : (
        <Flex vertical gap={16}>
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="State">
              <Tag color={statusColor(detail.batch.state)}>
                {humanize(detail.batch.state)}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Purpose">
              {detail.batch.purpose}
            </Descriptions.Item>
            <Descriptions.Item label="Recipients">
              {detail.batch.recipient_count}
            </Descriptions.Item>
            <Descriptions.Item label="Preflight">
              {preview.can_approve ? (
                <Tag color="green">Ready for approval</Tag>
              ) : (
                <Tag color="red">Review required</Tag>
              )}
            </Descriptions.Item>
          </Descriptions>
          <Flex gap={8} wrap>
            {detail.batch.state === "draft" ? (
              <Button
                onClick={() =>
                  onAction({ kind: "add-recipient", batch: detail.batch })
                }
              >
                Add recipient
              </Button>
            ) : null}
            {detail.batch.state === "draft" ? (
              <Button
                disabled={!preview.can_approve}
                onClick={() =>
                  onAction({
                    kind: "batch-transition",
                    batch: detail.batch,
                    transition: "approve",
                  })
                }
                type="primary"
              >
                Approve exact messages
              </Button>
            ) : null}
            {detail.batch.state === "approved" ? (
              <Button
                disabled={!preview.can_queue}
                onClick={() =>
                  onAction({
                    kind: "batch-transition",
                    batch: detail.batch,
                    transition: "queue",
                  })
                }
                type="primary"
              >
                Queue delivery
              </Button>
            ) : null}
            {["queued", "sending"].includes(detail.batch.state) ? (
              <Button
                onClick={() =>
                  onAction({
                    kind: "batch-transition",
                    batch: detail.batch,
                    transition: "pause",
                  })
                }
              >
                Pause
              </Button>
            ) : null}
            {detail.batch.state === "paused" ? (
              <Button
                onClick={() =>
                  onAction({
                    kind: "batch-transition",
                    batch: detail.batch,
                    transition: "resume",
                  })
                }
              >
                Resume
              </Button>
            ) : null}
          </Flex>
          {preview.deliveries.map((item) => (
            <Card
              key={item.delivery.id}
              size="small"
              title={`${item.delivery.recipient_name} · ${item.delivery.normalized_email}`}
            >
              {item.blocking_errors.map((value) => (
                <Alert key={value} showIcon title={value} type="error" />
              ))}
              {item.warnings.map((value) => (
                <Alert key={value} showIcon title={value} type="warning" />
              ))}
              <Paragraph strong style={{ marginTop: 12 }}>
                {item.delivery.subject}
              </Paragraph>
              <pre className="crm-outreach-message">
                {item.delivery.body_plain_text}
              </pre>
            </Card>
          ))}
        </Flex>
      )}
    </Drawer>
  );
}

export function CustomerOutreachCard({
  organization,
  onOpenOutreach,
}: {
  organization: string;
  onOpenOutreach: (create?: boolean) => void;
}) {
  const [deliveries, setDeliveries] = useState<CrmOutreachDelivery[]>([]);
  useEffect(() => {
    let cancelled = false;
    void webapp_client.conat_client.hub.adminCrm
      .listOutreachDeliveries({
        organization,
        reason: "Review customer CRM outreach history",
        limit: 8,
      })
      .then((value) => {
        if (!cancelled) setDeliveries(value.deliveries);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [organization]);
  return (
    <Card className="crm-section-card">
      <Flex align="center" justify="space-between" wrap gap={8}>
        <Title level={4} style={{ margin: 0 }}>
          <Icon
            name="paper-plane"
            style={{ color: COLORS.FEATURE_TEAL, marginRight: 8 }}
          />
          Outreach
        </Title>
        <Space wrap>
          <Button onClick={() => onOpenOutreach(true)} size="small">
            New outreach
          </Button>
          <Button
            onClick={() => onOpenOutreach(false)}
            size="small"
            type="primary"
          >
            Open workspace
          </Button>
        </Space>
      </Flex>
      <Divider />
      {deliveries.length ? (
        <Flex vertical gap={8}>
          {deliveries.map((delivery) => (
            <Flex
              align="center"
              gap={8}
              justify="space-between"
              key={delivery.id}
              wrap
            >
              <div style={{ minWidth: 0 }}>
                <Text ellipsis strong>
                  {delivery.subject}
                </Text>
                <br />
                <Text type="secondary">
                  <TimeAgo date={delivery.updated_at} />
                </Text>
              </div>
              <Tag color={statusColor(delivery.state)}>
                {humanize(delivery.state)}
              </Tag>
            </Flex>
          ))}
        </Flex>
      ) : (
        <Empty
          description="No reviewed outreach has been recorded for this customer."
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      )}
    </Card>
  );
}

export function OutreachAdmin({
  initialOrganization,
  startNewKey,
}: {
  initialOrganization?: string;
  startNewKey?: number;
}) {
  const api = webapp_client.conat_client.hub.adminCrm;
  const [view, setView] = useState<QueueView>("deliveries");
  const [deliveries, setDeliveries] = useState<CrmOutreachDelivery[]>([]);
  const [batches, setBatches] = useState<CrmOutreachBatch[]>([]);
  const [templates, setTemplates] = useState<CrmOutreachTemplate[]>([]);
  const [suppressions, setSuppressions] = useState<CrmContactSuppression[]>([]);
  const [followups, setFollowups] = useState<CrmOutreachFollowUp[]>([]);
  const [limits, setLimits] = useState<CrmOutreachLimits>();
  const [diagnostics, setDiagnostics] = useState<CrmOutreachDiagnostics>();
  const [search, setSearch] = useState("");
  const [deliveryState, setDeliveryState] = useState<string>();
  const [engagement, setEngagement] = useState<string>();
  const [owner, setOwner] = useState<string>();
  const [kind, setKind] = useState<string>();
  const [batchFilter, setBatchFilter] = useState<string>();
  const [organization, setOrganization] = useState<string | undefined>(
    initialOrganization,
  );
  const [opportunity, setOpportunity] = useState<string>();
  const [suggestedAction, setSuggestedAction] = useState<string>();
  const [ticket, setTicket] = useState<number | null>();
  const [dateRange, setDateRange] = useState<[string, string]>();
  const [filterRevision, setFilterRevision] = useState(0);
  const [action, setAction] = useState<OutreachAction | null>(null);
  const [openDelivery, setOpenDelivery] = useState<CrmOutreachDelivery>();
  const [openBatch, setOpenBatch] = useState<CrmOutreachBatch>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>("");
  const names = useAccountDisplayNames([
    ...batches.map(({ owner_account_id }) => owner_account_id),
    ...followups.map(({ task }) => task.assignee_account_id),
  ]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [
        deliveryRows,
        batchRows,
        templateRows,
        suppressionRows,
        followUpRows,
        nextLimits,
        nextDiagnostics,
      ] = await Promise.all([
        api.listOutreachDeliveries({
          reason: "Review CRM outreach queue",
          limit: 200,
        }),
        api.listOutreachBatches({
          reason: "Review CRM outreach batches",
          limit: 100,
        }),
        api.listOutreachTemplates({
          reason: "Review CRM outreach templates",
          limit: 100,
        }),
        api.listContactSuppressions({
          reason: "Review CRM contact suppressions",
          active: true,
          limit: 100,
        }),
        api.listOutreachFollowups({
          reason: "Review CRM outreach follow-up",
          limit: 100,
        }),
        api.getOutreachLimits({
          reason: "Review effective CRM outreach limits",
        }),
        api.getOutreachDiagnostics({
          reason: "Review CRM outreach diagnostics",
        }),
      ]);
      setDeliveries(deliveryRows.deliveries);
      setBatches(batchRows.batches);
      setTemplates(templateRows.templates);
      setSuppressions(suppressionRows.suppressions);
      setFollowups(followUpRows.followups);
      setLimits(nextLimits);
      setDiagnostics(nextDiagnostics);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (initialOrganization) setOrganization(initialOrganization);
  }, [initialOrganization]);

  useEffect(() => {
    if (startNewKey) setAction({ kind: "create-batch" });
  }, [startNewKey]);

  const needle = search.trim().toLowerCase();
  const batchById = new Map(batches.map((batch) => [batch.id, batch]));
  const visibleDeliveries = deliveries.filter((delivery) => {
    if (deliveryState && delivery.state !== deliveryState) return false;
    if (owner && batchById.get(delivery.batch_id)?.owner_account_id !== owner)
      return false;
    if (kind && delivery.kind !== kind) return false;
    if (batchFilter && delivery.batch_id !== batchFilter) return false;
    if (organization && delivery.organization_id !== organization) return false;
    if (opportunity && delivery.opportunity_id !== opportunity) return false;
    if (
      suggestedAction &&
      delivery.follow_up_suggested_action !== suggestedAction
    )
      return false;
    if (ticket && delivery.zendesk_ticket_id !== ticket) return false;
    if (dateRange) {
      const created = new Date(delivery.created_at).getTime();
      if (
        created < new Date(`${dateRange[0]}T00:00:00`).getTime() ||
        created > new Date(`${dateRange[1]}T23:59:59.999`).getTime()
      )
        return false;
    }
    if (engagement === "viewed" && !delivery.view_observation_count)
      return false;
    if (engagement === "unviewed" && delivery.view_observation_count)
      return false;
    if (engagement === "replied" && !delivery.replied_at) return false;
    if (engagement === "unreplied" && delivery.replied_at) return false;
    if (
      engagement === "replied_unviewed" &&
      (!delivery.replied_at || delivery.view_observation_count)
    )
      return false;
    if (!needle) return true;
    return [
      delivery.recipient_name,
      delivery.normalized_email,
      delivery.subject,
      delivery.state,
      delivery.zendesk_ticket_id,
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
  const overdue = followups.filter(
    ({ task }) => new Date(task.due_at) < new Date(),
  ).length;
  const waiting = followups.filter(
    ({ task }) => task.state === "waiting",
  ).length;
  const now = new Date();
  const dueToday = followups.filter(({ task }) => {
    const due = new Date(task.due_at);
    return (
      due.getUTCFullYear() === now.getUTCFullYear() &&
      due.getUTCMonth() === now.getUTCMonth() &&
      due.getUTCDate() === now.getUTCDate()
    );
  }).length;

  return (
    <Flex className="crm-shell" vertical gap={18}>
      <section
        aria-labelledby="crm-outreach-title"
        className="crm-hero crm-outreach-hero"
      >
        <Flex align="center" gap={20} justify="space-between" wrap>
          <div style={{ maxWidth: 760 }}>
            <div className="crm-eyebrow">Partnership outreach</div>
            <Title
              id="crm-outreach-title"
              level={2}
              style={{ margin: "8px 0" }}
            >
              Initiate carefully. Follow up visibly.
            </Title>
            <Paragraph style={{ fontSize: 16, marginBottom: 0 }}>
              Reviewed one-to-one Zendesk conversations, shared suppressions,
              conservative limits, and durable no-response work.
            </Paragraph>
          </div>
          <Space wrap>
            <Button
              ghost
              href="/app-docs/admin/crm-outreach-ui"
              icon={<Icon name="book" />}
              size="large"
            >
              UI guide
            </Button>
            <Button
              ghost
              href="/app-docs/admin/crm-outreach"
              icon={<Icon name="terminal" />}
              size="large"
            >
              Agent runbook
            </Button>
            <Button
              ghost
              onClick={() => void load()}
              icon={<Icon name="refresh" />}
              size="large"
            >
              Refresh
            </Button>
            <Button
              onClick={() => setAction({ kind: "create-batch" })}
              icon={<Icon name="plus" />}
              size="large"
            >
              New outreach
            </Button>
          </Space>
        </Flex>
      </section>

      {limits ? (
        <Alert
          action={
            <Button href="/admin/site-settings" size="small">
              Site settings
            </Button>
          }
          description={
            limits.delivery_enabled
              ? "The seed worker may perform reviewed, rate-limited Zendesk calls."
              : "Drafting remains available, but no new Zendesk provider calls can start."
          }
          showIcon
          title={
            limits.delivery_enabled
              ? "Zendesk delivery is enabled"
              : "Zendesk delivery kill switch is off"
          }
          type={limits.delivery_enabled ? "success" : "warning"}
        />
      ) : null}

      <div className="crm-summary-grid" aria-label="Outreach queue summary">
        <Card className="crm-metric-card" size="small">
          <Statistic
            prefix={<Icon name="paper-plane" />}
            title="Active deliveries"
            value={
              deliveries.filter(
                ({ state }) =>
                  !["closed", "cancelled", "suppressed"].includes(state),
              ).length
            }
          />
        </Card>
        <Card className="crm-metric-card" size="small">
          <Statistic
            prefix={<Icon name="hourglass-half" />}
            title="Waiting for response"
            value={waiting}
          />
        </Card>
        <Card className="crm-metric-card" size="small">
          <Statistic
            prefix={<Icon name="calendar" />}
            title="Due today"
            value={dueToday}
          />
        </Card>
        <Card className="crm-metric-card" size="small">
          <Statistic
            prefix={<Icon name="clock" />}
            title="Overdue follow-up"
            value={overdue}
          />
        </Card>
        <Card className="crm-metric-card" size="small">
          <Statistic
            prefix={<Icon name="eye" />}
            title="View observed, no reply"
            value={
              deliveries.filter(
                (item) => item.view_observation_count && !item.replied_at,
              ).length
            }
          />
        </Card>
        <Card className="crm-metric-card" size="small">
          <Statistic
            prefix={<Icon name="ban" />}
            title="Active suppressions"
            value={suppressions.length}
          />
        </Card>
      </div>

      {limits ? (
        <div className="crm-outreach-rate-grid">
          {[
            ["Minute", limits.rolling_usage.minute, limits.send_per_minute],
            ["Hour", limits.rolling_usage.hour, limits.send_per_hour],
            ["24 hours", limits.rolling_usage.day, limits.send_per_day],
          ].map(([label, value, maximum]) => (
            <Card key={`${label}`} size="small">
              <Flex align="center" gap={12} justify="space-between">
                <Text strong>{label}</Text>
                <Text>
                  {value} / {maximum}
                </Text>
              </Flex>
              <Progress
                aria-label={`${label} outreach rate usage`}
                percent={usagePercent(Number(value), Number(maximum))}
                showInfo={false}
                size="small"
                strokeColor={COLORS.FEATURE_TEAL}
              />
            </Card>
          ))}
        </div>
      ) : null}

      <div className="crm-filter-panel">
        <Flex align="end" gap={12} wrap>
          <div style={{ flex: "0 1 430px" }}>
            <Text strong>Workspace</Text>
            <Segmented
              aria-label="Outreach workspace"
              block
              onChange={(value) => setView(value as QueueView)}
              options={[
                { label: "Deliveries", value: "deliveries" },
                { label: "Batches", value: "batches" },
                { label: "Templates", value: "templates" },
                { label: "Suppressions", value: "suppressions" },
              ]}
              value={view}
            />
          </div>
          {view === "deliveries" ? (
            <>
              <div style={{ flex: "1 1 240px" }}>
                <Text strong>Fast filter</Text>
                <Input
                  aria-label="Filter outreach deliveries"
                  allowClear
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Recipient, subject, state, ticket"
                  prefix={<Icon name="search" />}
                  value={search}
                />
              </div>
              <div style={{ flex: "0 1 180px" }}>
                <Text strong>State</Text>
                <Select
                  aria-label="Outreach delivery state"
                  allowClear
                  onChange={setDeliveryState}
                  options={CRM_OUTREACH_DELIVERY_STATES.map((value) => ({
                    value,
                    label: humanize(value),
                  }))}
                  placeholder="All states"
                  style={{ width: "100%" }}
                  value={deliveryState}
                />
              </div>
              <div style={{ flex: "0 1 190px" }}>
                <Text strong>Engagement</Text>
                <Select
                  aria-label="Outreach engagement signal"
                  allowClear
                  onChange={setEngagement}
                  options={[
                    "viewed",
                    "unviewed",
                    "replied",
                    "unreplied",
                    "replied_unviewed",
                  ].map((value) => ({ value, label: humanize(value) }))}
                  placeholder="Any signal"
                  style={{ width: "100%" }}
                  value={engagement}
                />
              </div>
            </>
          ) : null}
        </Flex>
        {view === "deliveries" ? (
          <Flex align="end" gap={12} style={{ marginTop: 12 }} wrap>
            <div style={{ flex: "1 1 200px" }}>
              <Text strong>Owner</Text>
              <AccountSelector
                accountKind="admin"
                ariaLabel="Owner"
                onChange={setOwner}
                value={owner}
              />
            </div>
            <div style={{ flex: "1 1 180px" }}>
              <Text strong>Kind</Text>
              <Select
                allowClear
                aria-label="Outreach kind filter"
                onChange={setKind}
                options={CRM_OUTREACH_KINDS.map((value) => ({
                  value,
                  label: humanize(value),
                }))}
                placeholder="All kinds"
                style={{ width: "100%" }}
                value={kind}
              />
            </div>
            <div style={{ flex: "1 1 220px" }}>
              <Text strong>Batch</Text>
              <Select
                allowClear
                aria-label="Outreach batch filter"
                onChange={setBatchFilter}
                options={batches.map((batch) => ({
                  value: batch.id,
                  label: `${batch.outreach_number} · ${batch.name}`,
                }))}
                placeholder="All batches"
                showSearch
                style={{ width: "100%" }}
                value={batchFilter}
              />
            </div>
            <div style={{ flex: "1 1 230px" }}>
              <Text strong>Organization</Text>
              <CustomerSelector
                onChange={(value) => {
                  setOrganization(value);
                  setOpportunity(undefined);
                }}
                value={organization}
              />
            </div>
            <div style={{ flex: "1 1 230px" }}>
              <Text strong>Opportunity</Text>
              <OpportunitySelector
                onChange={setOpportunity}
                organization={organization}
                value={opportunity}
              />
            </div>
            <div style={{ flex: "1 1 210px" }}>
              <Text strong>Suggested action</Text>
              <Select
                allowClear
                aria-label="Follow-up suggested action"
                onChange={setSuggestedAction}
                options={CRM_OUTREACH_SUGGESTED_ACTIONS.map((value) => ({
                  value,
                  label: humanize(value),
                }))}
                placeholder="Any action"
                style={{ width: "100%" }}
                value={suggestedAction}
              />
            </div>
            <div style={{ flex: "0 1 150px" }}>
              <Text strong>Zendesk ticket</Text>
              <InputNumber
                aria-label="Zendesk ticket filter"
                min={1}
                onChange={(value) => setTicket(value ? Number(value) : null)}
                placeholder="Ticket ID"
                style={{ width: "100%" }}
                value={ticket}
              />
            </div>
            <div style={{ flex: "1 1 250px" }}>
              <Text strong>Created date</Text>
              <DatePicker.RangePicker
                aria-label="Outreach creation date range"
                key={filterRevision}
                onChange={(_dates, strings) =>
                  setDateRange(
                    strings[0] && strings[1]
                      ? [strings[0], strings[1]]
                      : undefined,
                  )
                }
                style={{ width: "100%" }}
              />
            </div>
            <Button
              onClick={() => {
                setSearch("");
                setDeliveryState(undefined);
                setEngagement(undefined);
                setOwner(undefined);
                setKind(undefined);
                setBatchFilter(undefined);
                setOrganization(undefined);
                setOpportunity(undefined);
                setSuggestedAction(undefined);
                setTicket(null);
                setDateRange(undefined);
                setFilterRevision((value) => value + 1);
              }}
            >
              Clear filters
            </Button>
          </Flex>
        ) : null}
        {view === "deliveries" ? (
          <Flex gap={6} style={{ marginTop: 12 }} wrap>
            {CRM_OUTREACH_DELIVERY_STATES.map((state) => {
              const count = deliveries.filter(
                (delivery) => delivery.state === state,
              ).length;
              return count ? (
                <Tag color={statusColor(state)} key={state}>
                  {humanize(state)} · {count}
                </Tag>
              ) : null;
            })}
          </Flex>
        ) : null}
      </div>

      {error ? (
        <ErrorDisplay error={error} onClose={() => setError("")} />
      ) : null}
      {loading ? <Spin description="Loading CRM outreach" /> : null}

      {!loading && view === "deliveries" ? (
        visibleDeliveries.length ? (
          <div className="crm-record-grid">
            {visibleDeliveries.map((delivery) => (
              <DeliveryCard
                delivery={delivery}
                key={delivery.id}
                onAction={setAction}
                onOpen={() => setOpenDelivery(delivery)}
              />
            ))}
          </div>
        ) : (
          <div className="crm-empty-panel">
            <Empty description="No outreach deliveries match this view" />
          </div>
        )
      ) : null}

      {!loading && view === "batches" ? (
        <div className="crm-record-grid">
          {batches.map((batch) => (
            <Card className="crm-record-card" key={batch.id} size="small">
              <Flex vertical gap={10}>
                <Flex align="start" justify="space-between" gap={8} wrap>
                  <div>
                    <Text strong>{batch.name}</Text>
                    <br />
                    <Text type="secondary">{batch.outreach_number}</Text>
                  </div>
                  <Tag color={statusColor(batch.state)}>
                    {humanize(batch.state)}
                  </Tag>
                </Flex>
                <Paragraph ellipsis={{ rows: 2 }}>{batch.purpose}</Paragraph>
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="Owner">
                    <AccountIdentity
                      accountId={batch.owner_account_id}
                      names={names}
                    />
                  </Descriptions.Item>
                  <Descriptions.Item label="Recipients">
                    {batch.recipient_count}
                  </Descriptions.Item>
                </Descriptions>
                <Flex gap={8} wrap>
                  <Button onClick={() => setOpenBatch(batch)} type="primary">
                    Review exact messages
                  </Button>
                  {batch.state === "draft" ? (
                    <Button
                      onClick={() =>
                        setAction({ kind: "add-recipient", batch })
                      }
                    >
                      Add recipient
                    </Button>
                  ) : null}
                </Flex>
              </Flex>
            </Card>
          ))}
          {!batches.length ? (
            <div className="crm-empty-panel">
              <Empty description="No outreach batches" />
            </div>
          ) : null}
        </div>
      ) : null}

      {!loading && view === "templates" ? (
        <Flex vertical gap={12}>
          <Button
            icon={<Icon name="plus" />}
            onClick={() => setAction({ kind: "create-template" })}
            style={{ alignSelf: "flex-start" }}
          >
            New template revision
          </Button>
          <div className="crm-record-grid">
            {templates.map((template) => (
              <Card className="crm-record-card" key={template.id} size="small">
                <Flex vertical gap={10}>
                  <Flex justify="space-between" gap={8} wrap>
                    <Text strong>{template.name}</Text>
                    <Tag color={statusColor(template.status)}>
                      {humanize(template.status)}
                    </Tag>
                  </Flex>
                  <Text type="secondary">
                    {template.template_key}@{template.revision} ·{" "}
                    {humanize(template.kind)}
                  </Text>
                  <Text>{template.subject_template}</Text>
                  <Collapse
                    ghost
                    items={[
                      {
                        key: "body",
                        label: "Template body",
                        children: (
                          <pre className="crm-outreach-message">
                            {template.body_markdown_template}
                          </pre>
                        ),
                      },
                    ]}
                  />
                  {template.status === "draft" ? (
                    <Button
                      onClick={() =>
                        setAction({
                          kind: "template-transition",
                          template,
                          transition: "activate",
                        })
                      }
                      type="primary"
                    >
                      Activate revision
                    </Button>
                  ) : null}
                  {template.status === "active" ? (
                    <Button
                      onClick={() =>
                        setAction({
                          kind: "template-transition",
                          template,
                          transition: "retire",
                        })
                      }
                    >
                      Retire
                    </Button>
                  ) : null}
                </Flex>
              </Card>
            ))}
          </div>
        </Flex>
      ) : null}

      {!loading && view === "suppressions" ? (
        <Flex vertical gap={12}>
          <Button
            icon={<Icon name="ban" />}
            onClick={() => setAction({ kind: "add-suppression" })}
            style={{ alignSelf: "flex-start" }}
          >
            Add suppression
          </Button>
          <div className="crm-record-grid">
            {suppressions.map((suppression) => (
              <Card
                className="crm-record-card"
                key={suppression.id}
                size="small"
              >
                <Flex vertical gap={8}>
                  <Flex justify="space-between" gap={8} wrap>
                    <Text className="crm-wrap-anywhere" strong>
                      {suppression.normalized_scope_value}
                    </Text>
                    <Tag color="red">{humanize(suppression.scope)}</Tag>
                  </Flex>
                  <Text>
                    {humanize(suppression.reason)} ·{" "}
                    {humanize(suppression.source)}
                  </Text>
                  {suppression.note ? (
                    <Paragraph>{suppression.note}</Paragraph>
                  ) : null}
                  <Button
                    onClick={() =>
                      setAction({ kind: "revoke-suppression", suppression })
                    }
                    size="small"
                  >
                    Revoke with review
                  </Button>
                </Flex>
              </Card>
            ))}
          </div>
        </Flex>
      ) : null}

      {diagnostics ? (
        <Collapse
          items={[
            {
              key: "diagnostics",
              label: `Diagnostics · ${diagnostics.problems.length ? `${diagnostics.problems.length} issue groups` : "healthy"}`,
              children: (
                <Flex vertical gap={8}>
                  {diagnostics.problems.length ? (
                    diagnostics.problems.map((problem) => (
                      <Alert
                        description={problem.detail}
                        key={problem.code}
                        showIcon
                        title={`${humanize(problem.code)} · ${problem.count}`}
                        type="warning"
                      />
                    ))
                  ) : (
                    <Alert
                      showIcon
                      title="No outreach consistency problems detected"
                      type="success"
                    />
                  )}
                  <Text type="secondary">
                    Worker heartbeat{" "}
                    {diagnostics.worker_heartbeat_at ? (
                      <TimeAgo date={diagnostics.worker_heartbeat_at} />
                    ) : (
                      "not observed"
                    )}
                  </Text>
                </Flex>
              ),
            },
          ]}
        />
      ) : null}

      <OutreachActionModal
        action={action}
        batches={batches}
        templates={templates}
        onClose={() => setAction(null)}
        onCommitted={load}
      />
      <DeliveryDrawer
        delivery={openDelivery}
        onAction={setAction}
        onClose={() => setOpenDelivery(undefined)}
      />
      <BatchDrawer
        batch={openBatch}
        onAction={setAction}
        onClose={() => setOpenBatch(undefined)}
      />
    </Flex>
  );
}
