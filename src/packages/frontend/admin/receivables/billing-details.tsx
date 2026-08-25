/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { Alert, Button, Flex, Form, Input, Modal } from "antd";
import { useEffect, useState } from "react";

import type {
  CommercialBillingAddress,
  CommercialBillingDetailsUpdateRequest,
} from "@cocalc/conat/hub/api/commercial-orders";
import {
  FreshAuthModal,
  useFreshAuthAction,
} from "@cocalc/frontend/auth/fresh-auth";
import { ErrorDisplay } from "@cocalc/frontend/components";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import type {
  CommercialOrder,
  CommercialOrderContact,
} from "@cocalc/util/commercial-orders";
import { formatReceivablesError } from "./shared";

interface BillingDetailsFormValues extends CommercialBillingAddress {
  billing_name: string;
  billing_email: string;
  billing_organization?: string;
  procurement_contacts?: Array<{
    name: string;
    email: string;
    organization?: string;
  }>;
  invoice_memo?: string;
  reason: string;
}

function invoiceTerms(order: CommercialOrder): Record<string, unknown> {
  const value = order.terms_snapshot.invoice;
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function initialValues(order: CommercialOrder): BillingDetailsFormValues {
  const billing = order.contacts.find(({ role }) => role === "billing");
  const procurement = order.contacts.filter(
    ({ role }) => role === "procurement",
  );
  const invoice = invoiceTerms(order);
  const address =
    invoice.billing_address != null &&
    typeof invoice.billing_address === "object" &&
    !Array.isArray(invoice.billing_address)
      ? (invoice.billing_address as CommercialBillingAddress)
      : {};
  return {
    billing_name: billing?.name_snapshot ?? "",
    billing_email: billing?.email_snapshot ?? "",
    billing_organization:
      billing?.organization_snapshot ?? order.organization_name,
    procurement_contacts: procurement.map((contact) => ({
      name: contact.name_snapshot,
      email: contact.email_snapshot,
      organization: contact.organization_snapshot ?? undefined,
    })),
    ...address,
    invoice_memo: typeof invoice.memo === "string" ? invoice.memo : undefined,
    reason: "",
  };
}

function contactInput(
  role: "billing" | "procurement",
  value: { name: string; email: string; organization?: string },
): Pick<
  CommercialOrderContact,
  "role" | "name_snapshot" | "email_snapshot" | "organization_snapshot"
> {
  return {
    role,
    name_snapshot: value.name.trim(),
    email_snapshot: value.email.trim(),
    organization_snapshot: value.organization?.trim() || undefined,
  };
}

export function BillingDetailsModal({
  open,
  order,
  onClose,
  onSaved,
}: {
  open: boolean;
  order: CommercialOrder;
  onClose: () => void;
  onSaved: (order: CommercialOrder) => Promise<void> | void;
}) {
  const [form] = Form.useForm<BillingDetailsFormValues>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction();

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(initialValues(order));
    setError("");
  }, [form, open, order]);

  async function save() {
    const values = await form.validateFields();
    setBusy(true);
    setError("");
    let saved: CommercialOrder | undefined;
    try {
      const billingAddress = Object.fromEntries(
        (["line1", "line2", "city", "state", "postal_code", "country"] as const)
          .map((key) => [key, values[key]?.trim()] as const)
          .filter(([, value]) => value),
      );
      const request: CommercialBillingDetailsUpdateRequest = {
        id: order.id,
        source: "admin-ui",
        reason: values.reason.trim(),
        expected_version: order.version,
        idempotency_key: `admin-ui:billing-update:${order.id}:v${order.version}`,
        billing_contacts: [
          contactInput("billing", {
            name: values.billing_name,
            email: values.billing_email,
            organization: values.billing_organization,
          }),
        ],
        procurement_contacts: (values.procurement_contacts ?? []).map(
          (contact) => contactInput("procurement", contact),
        ),
        billing_address:
          Object.keys(billingAddress).length > 0 ? billingAddress : null,
        invoice_memo: values.invoice_memo?.trim() || null,
      };
      const completed = await runFreshAuthAction(async () => {
        saved =
          await webapp_client.conat_client.hub.commercialOrders.updateBillingDetails(
            {
              ...request,
              browser_id: webapp_client.browser_id,
            },
          );
      });
      if (!completed || !saved) return;
      await onSaved(saved);
      onClose();
    } catch (err) {
      setError(formatReceivablesError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        title="Correct billing details"
        open={open}
        width={720}
        okText="Save billing details (fresh authentication required)"
        okButtonProps={{ loading: busy }}
        onCancel={onClose}
        onOk={() => void save()}
        destroyOnHidden
      >
        <Flex vertical gap="middle">
          <Alert
            showIcon
            type="info"
            title="Future invoice details only"
            description="This audited correction preserves agreement approval and fulfillment. Issued quotes remain immutable, and the correction is rejected once a live invoice exists."
          />
          {error ? (
            <ErrorDisplay
              error={error}
              title="Billing details were not changed"
              onClose={() => setError("")}
            />
          ) : null}
          <Form form={form} layout="vertical">
            <Flex gap="middle" wrap>
              <Form.Item
                label="Billing contact name"
                name="billing_name"
                rules={[{ required: true, whitespace: true }]}
                style={{ flex: "1 1 220px" }}
              >
                <Input autoComplete="name" />
              </Form.Item>
              <Form.Item
                label="Billing contact email"
                name="billing_email"
                rules={[{ required: true, type: "email" }]}
                style={{ flex: "1 1 260px" }}
              >
                <Input autoComplete="email" type="email" />
              </Form.Item>
            </Flex>
            <Form.Item
              label="Billing contact organization"
              name="billing_organization"
            >
              <Input autoComplete="organization" />
            </Form.Item>
            <Form.List name="procurement_contacts">
              {(fields, { add, remove }) => (
                <Flex vertical gap="small">
                  {fields.map((field, index) => (
                    <fieldset key={field.key} style={{ border: 0, padding: 0 }}>
                      <legend>Procurement contact {index + 1}</legend>
                      <Flex gap="small" wrap align="end">
                        <Form.Item
                          label="Name"
                          name={[field.name, "name"]}
                          rules={[{ required: true, whitespace: true }]}
                          style={{ flex: "1 1 180px" }}
                        >
                          <Input />
                        </Form.Item>
                        <Form.Item
                          label="Email"
                          name={[field.name, "email"]}
                          rules={[{ required: true, type: "email" }]}
                          style={{ flex: "1 1 220px" }}
                        >
                          <Input type="email" />
                        </Form.Item>
                        <Form.Item
                          label="Organization"
                          name={[field.name, "organization"]}
                          style={{ flex: "1 1 180px" }}
                        >
                          <Input />
                        </Form.Item>
                        <Form.Item>
                          <Button onClick={() => remove(field.name)}>
                            Remove procurement contact
                          </Button>
                        </Form.Item>
                      </Flex>
                    </fieldset>
                  ))}
                  <Button onClick={() => add()} style={{ alignSelf: "start" }}>
                    Add procurement contact
                  </Button>
                </Flex>
              )}
            </Form.List>
            <fieldset style={{ border: 0, padding: 0, marginTop: 20 }}>
              <legend>Billing address</legend>
              <Form.Item label="Address line 1" name="line1">
                <Input autoComplete="address-line1" />
              </Form.Item>
              <Form.Item label="Address line 2" name="line2">
                <Input autoComplete="address-line2" />
              </Form.Item>
              <Flex gap="small" wrap>
                <Form.Item
                  label="City"
                  name="city"
                  style={{ flex: "1 1 180px" }}
                >
                  <Input autoComplete="address-level2" />
                </Form.Item>
                <Form.Item
                  label="State or region"
                  name="state"
                  style={{ flex: "1 1 140px" }}
                >
                  <Input autoComplete="address-level1" />
                </Form.Item>
                <Form.Item
                  label="Postal code"
                  name="postal_code"
                  style={{ flex: "1 1 120px" }}
                >
                  <Input autoComplete="postal-code" />
                </Form.Item>
                <Form.Item
                  label="Country code"
                  name="country"
                  rules={[
                    {
                      pattern: /^[A-Za-z]{2}$/,
                      message: "Use a two-letter country code.",
                    },
                  ]}
                  style={{ flex: "1 1 100px" }}
                >
                  <Input autoComplete="country" maxLength={2} />
                </Form.Item>
              </Flex>
            </fieldset>
            <Form.Item label="Future invoice memo" name="invoice_memo">
              <Input.TextArea rows={3} maxLength={1000} />
            </Form.Item>
            <Form.Item
              label="Audit reason"
              name="reason"
              rules={[{ required: true, min: 4, whitespace: true }]}
            >
              <Input.TextArea rows={2} maxLength={2000} />
            </Form.Item>
          </Form>
        </Flex>
      </Modal>
      <FreshAuthModal {...freshAuthModalProps} />
    </>
  );
}
