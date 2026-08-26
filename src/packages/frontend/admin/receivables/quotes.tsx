/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Tag,
  Typography,
} from "antd";
import { useState } from "react";

import type { CommercialQuotePreview } from "@cocalc/conat/hub/api/commercial-orders";
import {
  FreshAuthModal,
  useFreshAuthAction,
} from "@cocalc/frontend/auth/fresh-auth";
import { ErrorDisplay, Icon } from "@cocalc/frontend/components";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import type {
  CommercialOrder,
  CommercialQuote,
} from "@cocalc/util/commercial-orders";
import {
  formatDate,
  downloadBase64Pdf,
  formatMoney,
  formatReceivablesError,
  humanizeKey,
} from "./shared";

const { Paragraph, Text } = Typography;

interface IssueQuoteFormValues {
  valid_until: string;
  reason: string;
}

function quoteDisplayStatus(quote: CommercialQuote): string {
  if (quote.status === "issued" && new Date(quote.valid_until) < new Date()) {
    return "expired";
  }
  return quote.status;
}

export function CommercialQuotesCard({
  order,
  onOrderChanged,
}: {
  order: CommercialOrder;
  onOrderChanged: (order: CommercialOrder) => Promise<void> | void;
}) {
  const api = webapp_client.conat_client.hub.commercialOrders;
  const [issueForm] = Form.useForm<IssueQuoteFormValues>();
  const [voidForm] = Form.useForm<{ reason: string }>();
  const [preview, setPreview] = useState<CommercialQuotePreview | null>(null);
  const [voidQuote, setVoidQuote] = useState<CommercialQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction();

  async function openIssue() {
    setBusy(true);
    setError("");
    try {
      const nextPreview = await api.quotePreview({
        id: order.id,
        reason: "Preview commercial quote before issuance",
      });
      setPreview(nextPreview);
      issueForm.setFieldsValue({
        valid_until: nextPreview.default_valid_until.slice(0, 16),
        reason: "",
      });
    } catch (err) {
      setError(formatReceivablesError(err));
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    const values = await issueForm.validateFields();
    setBusy(true);
    setError("");
    let saved: CommercialOrder | undefined;
    try {
      const completed = await runFreshAuthAction(async () => {
        saved = await api.issueQuote({
          id: order.id,
          source: "admin-ui",
          reason: values.reason.trim(),
          expected_version: order.version,
          idempotency_key:
            "admin-ui:quote-issue:" + order.id + ":v" + order.version,
          valid_until: new Date(values.valid_until).toISOString(),
          browser_id: webapp_client.browser_id,
        });
      });
      if (!completed || !saved) return;
      await onOrderChanged(saved);
      setPreview(null);
    } catch (err) {
      setError(formatReceivablesError(err));
    } finally {
      setBusy(false);
    }
  }

  async function download(quote: CommercialQuote) {
    setBusy(true);
    setError("");
    try {
      const document = await api.quoteDocument({
        id: order.id,
        commercial_quote_id: quote.id,
        reason: "Download stored quote " + quote.quote_number,
      });
      downloadBase64Pdf(
        document.content_base64,
        document.quote.document_filename,
      );
    } catch (err) {
      setError(formatReceivablesError(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmVoid() {
    if (!voidQuote) return;
    const values = await voidForm.validateFields();
    setBusy(true);
    setError("");
    let saved: CommercialOrder | undefined;
    try {
      const completed = await runFreshAuthAction(async () => {
        saved = await api.voidQuote({
          id: order.id,
          commercial_quote_id: voidQuote.id,
          source: "admin-ui",
          reason: values.reason.trim(),
          expected_version: order.version,
          idempotency_key:
            "admin-ui:quote-void:" + voidQuote.id + ":v" + order.version,
          browser_id: webapp_client.browser_id,
        });
      });
      if (!completed || !saved) return;
      await onOrderChanged(saved);
      setVoidQuote(null);
    } catch (err) {
      setError(formatReceivablesError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card className="receivables-section-card" title="Quotes" size="small">
        <Flex vertical gap="middle">
          <Flex justify="space-between" align="center" gap="middle" wrap>
            <Paragraph
              type="secondary"
              style={{ flex: "1 1 320px", margin: 0 }}
            >
              Issued PDFs are immutable snapshots. Changing an order or its
              billing details later does not rewrite an already issued quote.
            </Paragraph>
            <Button
              type="primary"
              icon={<Icon name="file-pdf" />}
              disabled={["complete", "cancelled"].includes(
                order.workflow_state,
              )}
              loading={busy}
              onClick={() => void openIssue()}
            >
              Generate quote
            </Button>
          </Flex>
          {error && preview == null && voidQuote == null ? (
            <ErrorDisplay
              error={error}
              title="Quote action failed"
              onClose={() => setError("")}
            />
          ) : null}
          {order.quotes.length === 0 ? (
            <Empty description="No quotes have been issued" />
          ) : (
            <Flex vertical gap="small">
              {order.quotes.map((quote) => (
                <Card key={quote.id} size="small" type="inner">
                  <Flex
                    justify="space-between"
                    gap="middle"
                    align="center"
                    wrap
                  >
                    <div>
                      <Flex align="center" gap="small" wrap>
                        <Text strong>{quote.quote_number}</Text>
                        <Tag
                          color={quote.status === "void" ? "default" : "blue"}
                        >
                          {humanizeKey(quoteDisplayStatus(quote))}
                        </Tag>
                      </Flex>
                      <Text type="secondary">
                        {formatMoney(quote.total, quote.currency)} issued{" "}
                        {formatDate(quote.issued_at)}; valid through{" "}
                        {formatDate(quote.valid_until)}
                      </Text>
                    </div>
                    <Flex gap="small" wrap>
                      <Button
                        icon={<Icon name="download" />}
                        loading={busy}
                        onClick={() => void download(quote)}
                      >
                        Download PDF
                      </Button>
                      {quote.status === "issued" ? (
                        <Button
                          danger
                          onClick={() => {
                            voidForm.resetFields();
                            setError("");
                            setVoidQuote(quote);
                          }}
                        >
                          Void quote
                        </Button>
                      ) : null}
                    </Flex>
                  </Flex>
                </Card>
              ))}
            </Flex>
          )}
        </Flex>
      </Card>

      <Modal
        title="Review and issue quote"
        open={preview != null}
        width={680}
        okText="Issue and store quote (fresh authentication required)"
        okButtonProps={{ loading: busy, disabled: !preview?.ready }}
        onCancel={() => setPreview(null)}
        onOk={() => void issue()}
        destroyOnHidden
      >
        {preview ? (
          <Flex vertical gap="middle">
            <Alert
              showIcon
              type={preview.ready ? "info" : "warning"}
              title={
                preview.ready ? "Quote is ready to issue" : "Quote has blockers"
              }
              description={
                preview.ready
                  ? "The generated PDF and exact recipient, address, items, amount, and service-term snapshot will be retained with this order."
                  : preview.blockers.join("; ")
              }
            />
            {error ? (
              <ErrorDisplay
                error={error}
                title="Quote was not issued"
                onClose={() => setError("")}
              />
            ) : null}
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="Organization">
                {preview.organization_name}
              </Descriptions.Item>
              <Descriptions.Item label="Recipient">
                {preview.billing_contacts[0]
                  ? preview.billing_contacts[0].name_snapshot +
                    " <" +
                    preview.billing_contacts[0].email_snapshot +
                    ">"
                  : "Missing billing contact"}
              </Descriptions.Item>
              <Descriptions.Item label="Total">
                {formatMoney(preview.total, preview.currency)}
              </Descriptions.Item>
              <Descriptions.Item label="Line items">
                {preview.items.length}
              </Descriptions.Item>
            </Descriptions>
            <Form form={issueForm} layout="vertical">
              <Form.Item
                label="Valid through"
                name="valid_until"
                rules={[{ required: true }]}
              >
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
          </Flex>
        ) : null}
      </Modal>

      <Modal
        title={"Void " + (voidQuote?.quote_number ?? "quote")}
        open={voidQuote != null}
        okText="Void quote (fresh authentication required)"
        okButtonProps={{ danger: true, loading: busy }}
        onCancel={() => setVoidQuote(null)}
        onOk={() => void confirmVoid()}
        destroyOnHidden
      >
        <Flex vertical gap="middle">
          <Alert
            showIcon
            type="warning"
            title="The stored document will remain in the audit record"
            description="Voiding marks this quote as no longer valid. It does not delete or rewrite the PDF that was issued."
          />
          {error ? (
            <ErrorDisplay
              error={error}
              title="Quote was not voided"
              onClose={() => setError("")}
            />
          ) : null}
          <Form form={voidForm} layout="vertical">
            <Form.Item
              label="Audit reason"
              name="reason"
              rules={[{ required: true, min: 4, whitespace: true }]}
            >
              <Input.TextArea rows={3} maxLength={2000} />
            </Form.Item>
          </Form>
        </Flex>
      </Modal>
      <FreshAuthModal {...freshAuthModalProps} />
    </>
  );
}
