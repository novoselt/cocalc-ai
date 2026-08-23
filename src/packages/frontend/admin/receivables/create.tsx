/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { Alert, Button, Flex, Form, Modal, Typography, message } from "antd";
import { useEffect, useState } from "react";

import {
  FreshAuthModal,
  useFreshAuthAction,
} from "@cocalc/frontend/auth/fresh-auth";
import { Icon } from "@cocalc/frontend/components";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import type { CommercialOrder } from "@cocalc/util/commercial-orders";
import {
  CommercialOrderForm,
  CommercialOrderRequestPreview,
  commercialOrderInitialValues,
  prepareCommercialOrder,
  prepareCommercialRevision,
  type CommercialOrderFormValues,
  type PreparedCommercialOrder,
} from "./order-form";
import { formatReceivablesError } from "./shared";

const { Paragraph, Title } = Typography;

function mutationError(error: unknown): string {
  const value = `${error}`;
  if (/version|optimistic|conflict/i.test(value)) {
    return `${value}. This order changed elsewhere; close the revision, refresh the order, and review the latest version before retrying.`;
  }
  return formatReceivablesError(error);
}

function newIdempotencyKey(action: string): string {
  return `admin-ui:${action}:${webapp_client.browser_id}:${Date.now()}`;
}

export function ReceivableOrderCreate({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
  const api = webapp_client.conat_client.hub.commercialOrders;
  const [form] = Form.useForm<CommercialOrderFormValues>();
  const [preview, setPreview] = useState<PreparedCommercialOrder | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [idempotencyKey] = useState(() => newIdempotencyKey("create"));
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction();

  function openPreview(values: CommercialOrderFormValues) {
    setError("");
    try {
      setPreview(prepareCommercialOrder(values));
      setReason(values.reason);
    } catch (err) {
      setError(formatReceivablesError(err));
    }
  }

  async function createOrder() {
    if (!preview) return;
    setBusy(true);
    setError("");
    let created: CommercialOrder | undefined;
    try {
      const completed = await runFreshAuthAction(async () => {
        created = await api.create({
          ...preview,
          reason: reason.trim(),
          source: "admin-ui" as const,
          idempotency_key: idempotencyKey,
          browser_id: webapp_client.browser_id,
        });
      });
      if (!completed || !created) return;
      message.success(`Created commercial order ${created.order_number}`);
      onCreated(created.id);
    } catch (err) {
      setError(mutationError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Flex vertical gap="middle">
      <Flex align="center" justify="space-between" gap="middle" wrap>
        <Button icon={<Icon name="arrow-left" />} onClick={onBack}>
          Back to accounts receivable queue
        </Button>
        <Paragraph style={{ margin: 0 }} type="secondary">
          Creating an order requires fresh authentication and creates an
          immutable audit event.
        </Paragraph>
      </Flex>
      <div>
        <Title level={3}>Create commercial order</Title>
        <Paragraph>
          Record the complete reviewed offer before invoicing or fulfillment.
          This workflow does not create a purchase-credit transaction.
        </Paragraph>
      </div>
      {error ? (
        <Alert
          showIcon
          closable
          type="error"
          title="Could not prepare or create the order"
          description={error}
          onClose={() => setError("")}
        />
      ) : null}
      <CommercialOrderForm form={form} mode="create" onPreview={openPreview} />
      <Modal
        title={
          <span id="receivables-create-review-title" tabIndex={-1}>
            Review new commercial order
          </span>
        }
        open={preview != null}
        width={1000}
        okText="Create order (fresh authentication required)"
        okButtonProps={{ loading: busy }}
        cancelButtonProps={{ disabled: busy }}
        onCancel={() => setPreview(null)}
        onOk={() => void createOrder()}
        afterOpenChange={(visible) => {
          if (visible) {
            document.getElementById("receivables-create-review-title")?.focus();
          }
        }}
        styles={{ body: { maxHeight: "70vh", overflowY: "auto" } }}
        destroyOnHidden
      >
        {preview ? (
          <CommercialOrderRequestPreview prepared={preview} reason={reason} />
        ) : null}
      </Modal>
      <FreshAuthModal {...freshAuthModalProps} />
    </Flex>
  );
}

export function CommercialOrderEditModal({
  mode,
  open,
  order,
  onClose,
  onSaved,
}: {
  mode: "update" | "revise";
  open: boolean;
  order: CommercialOrder;
  onClose: () => void;
  onSaved: (order: CommercialOrder) => Promise<void> | void;
}) {
  const api = webapp_client.conat_client.hub.commercialOrders;
  const [form] = Form.useForm<CommercialOrderFormValues>();
  const [preview, setPreview] = useState<PreparedCommercialOrder | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    newIdempotencyKey(`${mode}:${order.id}:v${order.version}`),
  );
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(commercialOrderInitialValues(order));
    setPreview(null);
    setReason("");
    setError("");
    setIdempotencyKey(
      newIdempotencyKey(`${mode}:${order.id}:v${order.version}`),
    );
  }, [form, mode, open, order.id, order.version]);

  function openPreview(values: CommercialOrderFormValues) {
    setError("");
    try {
      setPreview(prepareCommercialOrder(values));
      setReason(values.reason);
    } catch (err) {
      setError(formatReceivablesError(err));
    }
  }

  async function saveOrder() {
    if (!preview) return;
    setBusy(true);
    setError("");
    let saved: CommercialOrder | undefined;
    try {
      const values = form.getFieldsValue(true);
      const completed = await runFreshAuthAction(async () => {
        const request = {
          id: order.id,
          ...prepareCommercialRevision(values),
          reason: reason.trim(),
          source: "admin-ui" as const,
          expected_version: order.version,
          idempotency_key: idempotencyKey,
          browser_id: webapp_client.browser_id,
        };
        saved =
          mode === "update"
            ? await api.update(request)
            : await api.revise(request);
      });
      if (!completed || !saved) return;
      await onSaved(saved);
      message.success(
        `${mode === "update" ? "Updated draft" : "Revised commercial order"} ${saved.order_number}`,
      );
      onClose();
    } catch (err) {
      setError(mutationError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        title={
          <span id={`receivables-edit-title-${order.id}`} tabIndex={-1}>
            {mode === "update" ? "Update draft" : "Revise"} {order.order_number}
          </span>
        }
        open={open}
        width={1100}
        footer={null}
        onCancel={busy ? undefined : onClose}
        afterOpenChange={(visible) => {
          if (visible) {
            document
              .getElementById(`receivables-edit-title-${order.id}`)
              ?.focus();
          }
        }}
        styles={{ body: { maxHeight: "78vh", overflowY: "auto" } }}
        destroyOnHidden
      >
        <Flex vertical gap="middle">
          {error ? (
            <Alert
              showIcon
              type="error"
              title={`Could not ${mode === "update" ? "update" : "revise"} the order`}
              description={error}
            />
          ) : null}
          {preview ? (
            <>
              <CommercialOrderRequestPreview
                prepared={preview}
                reason={reason}
              />
              <Flex justify="flex-end" gap="small" wrap>
                <Button disabled={busy} onClick={() => setPreview(null)}>
                  Return to edit
                </Button>
                <Button
                  type="primary"
                  loading={busy}
                  onClick={() => void saveOrder()}
                >
                  {mode === "update" ? "Apply draft update" : "Apply revision"}{" "}
                  (fresh authentication required)
                </Button>
              </Flex>
            </>
          ) : (
            <CommercialOrderForm
              form={form}
              mode={mode}
              onPreview={openPreview}
              reviewedSiteLicenseId={order.site_license_id}
              siteLicenseTargetLocked={order.approved_at != null}
            />
          )}
        </Flex>
      </Modal>
      <FreshAuthModal {...freshAuthModalProps} />
    </>
  );
}
