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
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Tag,
  Typography,
  Upload,
  type UploadFile,
} from "antd";
import { useState } from "react";

import {
  FreshAuthModal,
  useFreshAuthAction,
} from "@cocalc/frontend/auth/fresh-auth";
import { ErrorDisplay, Icon } from "@cocalc/frontend/components";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import {
  COMMERCIAL_ORDER_DOCUMENT_MAX_BYTES,
  type CommercialOrder,
  type CommercialOrderDocument,
} from "@cocalc/util/commercial-orders";
import {
  downloadBase64Pdf,
  formatDate,
  formatReceivablesError,
  humanizeKey,
} from "./shared";

const { Paragraph, Text } = Typography;

interface UploadDocumentFormValues {
  document_reference?: string;
  note?: string;
  reason: string;
  reviewed: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function readPurchaseOrder(file: File): Promise<{
  content_base64: string;
  sha256: string;
  size: number;
}> {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Select a PDF purchase order.");
  }
  if (!file.size || file.size > COMMERCIAL_ORDER_DOCUMENT_MAX_BYTES) {
    throw new Error("The purchase order PDF must be between 1 byte and 5 MiB.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder("ascii").decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new Error("The selected file does not contain a PDF document.");
  }
  return {
    content_base64: bytesToBase64(bytes),
    sha256: await sha256Hex(bytes),
    size: bytes.length,
  };
}

export function CommercialOrderDocumentsCard({
  order,
  onOrderChanged,
}: {
  order: CommercialOrder;
  onOrderChanged: (order: CommercialOrder) => Promise<void> | void;
}) {
  const api = webapp_client.conat_client.hub.commercialOrders;
  const [uploadForm] = Form.useForm<UploadDocumentFormValues>();
  const [voidForm] = Form.useForm<{ reason: string }>();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [voidDocument, setVoidDocument] =
    useState<CommercialOrderDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction();

  function openUpload() {
    setError("");
    setFileList([]);
    uploadForm.resetFields();
    uploadForm.setFieldsValue({
      document_reference: order.po_number ?? undefined,
      reviewed: false,
      reason: "",
    });
    setUploadOpen(true);
  }

  async function attach() {
    const values = await uploadForm.validateFields();
    const selected = fileList[0];
    const file = selected?.originFileObj ?? (selected as unknown as File);
    if (!file) {
      setError("Select the purchase-order PDF to attach.");
      return;
    }
    setBusy(true);
    setError("");
    let saved: CommercialOrder | undefined;
    try {
      const document = await readPurchaseOrder(file);
      const completed = await runFreshAuthAction(async () => {
        saved = await api.uploadDocument({
          id: order.id,
          document_kind: "purchase_order",
          document_filename: file.name,
          content_base64: document.content_base64,
          document_reference: values.document_reference?.trim() || undefined,
          note: values.note?.trim() || undefined,
          source: "admin-ui",
          reason: values.reason.trim(),
          expected_version: order.version,
          idempotency_key: `admin-ui:document-upload:${order.id}:${document.sha256}`,
          browser_id: webapp_client.browser_id,
        });
      });
      if (!completed || !saved) return;
      await onOrderChanged(saved);
      setUploadOpen(false);
      setFileList([]);
    } catch (err) {
      setError(formatReceivablesError(err));
    } finally {
      setBusy(false);
    }
  }

  async function download(document: CommercialOrderDocument) {
    setBusy(true);
    setError("");
    try {
      const result = await api.downloadDocument({
        id: order.id,
        commercial_order_document_id: document.id,
        reason: `Download purchase order ${document.document_reference ?? document.document_filename}`,
      });
      const binary = atob(result.content_base64);
      const bytes = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0),
      );
      if ((await sha256Hex(bytes)) !== result.document.document_sha256) {
        throw new Error(
          "The downloaded purchase order failed its integrity check.",
        );
      }
      downloadBase64Pdf(
        result.content_base64,
        result.document.document_filename,
      );
    } catch (err) {
      setError(formatReceivablesError(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmVoid() {
    if (!voidDocument) return;
    const values = await voidForm.validateFields();
    setBusy(true);
    setError("");
    let saved: CommercialOrder | undefined;
    try {
      const completed = await runFreshAuthAction(async () => {
        saved = await api.voidDocument({
          id: order.id,
          commercial_order_document_id: voidDocument.id,
          source: "admin-ui",
          reason: values.reason.trim(),
          expected_version: order.version,
          idempotency_key: `admin-ui:document-void:${voidDocument.id}:v${order.version}`,
          browser_id: webapp_client.browser_id,
        });
      });
      if (!completed || !saved) return;
      await onOrderChanged(saved);
      setVoidDocument(null);
    } catch (err) {
      setError(formatReceivablesError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card
        className="receivables-section-card"
        title="Purchase orders"
        size="small"
      >
        <Flex vertical gap="middle">
          <Flex justify="space-between" align="center" gap="middle" wrap>
            <Paragraph
              type="secondary"
              style={{ flex: "1 1 320px", margin: 0 }}
            >
              Retain received procurement evidence with the account. Attached
              PDFs are immutable; voiding preserves the original audit record.
            </Paragraph>
            <Button
              type="primary"
              icon={<Icon name="upload" />}
              loading={busy}
              onClick={openUpload}
            >
              Attach purchase order
            </Button>
          </Flex>
          {error && !uploadOpen && voidDocument == null ? (
            <ErrorDisplay
              error={error}
              title="Purchase-order action failed"
              onClose={() => setError("")}
            />
          ) : null}
          {order.documents.length === 0 ? (
            <Empty description="No purchase orders are attached" />
          ) : (
            <Flex vertical gap="small">
              {order.documents.map((document) => (
                <Card key={document.id} size="small" type="inner">
                  <Flex
                    justify="space-between"
                    align="center"
                    gap="middle"
                    wrap
                  >
                    <Flex vertical gap={2} style={{ minWidth: 0 }}>
                      <Flex align="center" gap="small" wrap>
                        <Icon name="file-pdf" />
                        <Text strong>{document.document_filename}</Text>
                        <Tag
                          color={
                            document.status === "active" ? "green" : undefined
                          }
                        >
                          {humanizeKey(document.status)}
                        </Tag>
                      </Flex>
                      <Text type="secondary">
                        {document.document_reference
                          ? `PO ${document.document_reference} · `
                          : ""}
                        {formatBytes(document.document_size)} · attached{" "}
                        {formatDate(document.created_at)}
                      </Text>
                      {document.note ? (
                        <Text type="secondary">{document.note}</Text>
                      ) : null}
                    </Flex>
                    <Flex gap="small" wrap>
                      <Button
                        icon={<Icon name="download" />}
                        loading={busy}
                        onClick={() => void download(document)}
                      >
                        Download PDF
                      </Button>
                      {document.status === "active" ? (
                        <Button
                          danger
                          icon={<Icon name="ban" />}
                          onClick={() => {
                            voidForm.resetFields();
                            setError("");
                            setVoidDocument(document);
                          }}
                        >
                          Void attachment
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
        title="Attach purchase order"
        open={uploadOpen}
        width={680}
        okText="Attach PDF (fresh authentication required)"
        okButtonProps={{ loading: busy }}
        cancelButtonProps={{ disabled: busy }}
        onCancel={() => setUploadOpen(false)}
        onOk={() => void attach()}
        bodyStyle={{
          maxHeight: "calc(100vh - 240px)",
          overflowY: "auto",
        }}
        destroyOnHidden
      >
        <Flex vertical gap="middle">
          <Alert
            showIcon
            type="info"
            title="This becomes part of the commercial audit record"
            description="Review the PDF and reference before attaching it. The file cannot be edited or deleted after upload; an incorrect attachment can only be voided."
          />
          {error ? (
            <ErrorDisplay
              error={error}
              title="Purchase order was not attached"
              onClose={() => setError("")}
            />
          ) : null}
          <Form form={uploadForm} layout="vertical">
            <Form.Item label="Purchase-order PDF" required>
              <Upload
                accept="application/pdf,.pdf"
                beforeUpload={() => false}
                fileList={fileList}
                maxCount={1}
                onChange={({ fileList: next }) => setFileList(next.slice(-1))}
                onRemove={() => {
                  setFileList([]);
                  return true;
                }}
              >
                <Button icon={<Icon name="file-pdf" />}>Select PDF</Button>
              </Upload>
              <Text type="secondary">Maximum size: 5 MiB.</Text>
            </Form.Item>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="Account">
                {order.organization_name}
              </Descriptions.Item>
              <Descriptions.Item label="AR record">
                {order.order_number}
              </Descriptions.Item>
            </Descriptions>
            <Form.Item
              label="PO number or reference"
              name="document_reference"
              rules={[{ max: 240 }]}
            >
              <Input maxLength={240} placeholder="For example, 5874860" />
            </Form.Item>
            <Form.Item
              label="Internal note"
              name="note"
              rules={[{ max: 2000 }]}
            >
              <Input.TextArea rows={2} maxLength={2000} />
            </Form.Item>
            <Form.Item
              label="Audit reason"
              name="reason"
              rules={[{ required: true, min: 4, whitespace: true }]}
            >
              <Input.TextArea rows={2} maxLength={2000} />
            </Form.Item>
            <Form.Item
              name="reviewed"
              valuePropName="checked"
              rules={[
                {
                  validator: (_, value) =>
                    value
                      ? Promise.resolve()
                      : Promise.reject(
                          new Error("Confirm that you reviewed the PDF."),
                        ),
                },
              ]}
            >
              <Checkbox>
                I reviewed the PDF, purchase-order reference, and AR record.
              </Checkbox>
            </Form.Item>
          </Form>
        </Flex>
      </Modal>

      <Modal
        title={`Void ${voidDocument?.document_filename ?? "attachment"}`}
        open={voidDocument != null}
        okText="Void attachment (fresh authentication required)"
        okButtonProps={{ danger: true, loading: busy }}
        cancelButtonProps={{ disabled: busy }}
        onCancel={() => setVoidDocument(null)}
        onOk={() => void confirmVoid()}
        bodyStyle={{
          maxHeight: "calc(100vh - 240px)",
          overflowY: "auto",
        }}
        destroyOnHidden
      >
        <Flex vertical gap="middle">
          <Alert
            showIcon
            type="warning"
            title="The PDF will remain available in the audit record"
            description="Voiding indicates that this attachment should no longer be relied upon. It does not delete the original document."
          />
          {error ? (
            <ErrorDisplay
              error={error}
              title="Purchase order was not voided"
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
