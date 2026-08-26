/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

import type { CommercialQuotePreview } from "@cocalc/conat/hub/api/commercial-orders";
import { BILLING_EMAIL, BILLING_TAXID, COMPANY_NAME } from "@cocalc/util/theme";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

function safePdfText(value: unknown): string {
  return `${value ?? ""}`
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e\n]/g, "?");
}

function wrapText(
  value: unknown,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  const paragraphs = safePdfText(value).split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function displayDate(value: string | null | undefined): string {
  if (!value) return "Not specified";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function displayMoney(value: string, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(Number(value));
}

function billingAddressLines(
  address: CommercialQuotePreview["billing_address"],
): string[] {
  if (!address) return [];
  const region = [address.state, address.postal_code].filter(Boolean).join(" ");
  const locality = [address.city, region].filter(Boolean).join(", ");
  return [address.line1, address.line2, locality, address.country]
    .map((value) => `${value ?? ""}`.trim())
    .filter(Boolean);
}

export async function renderCommercialQuotePdf(opts: {
  quote_number: string;
  issued_at: string;
  valid_until: string;
  preview: CommercialQuotePreview;
}): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const ensureSpace = (height: number) => {
    if (y - height >= MARGIN) return;
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };
  const drawLines = (
    value: unknown,
    options: {
      font?: PDFFont;
      size?: number;
      color?: ReturnType<typeof rgb>;
      width?: number;
      lineHeight?: number;
    } = {},
  ) => {
    const font = options.font ?? regular;
    const size = options.size ?? 10;
    const lineHeight = options.lineHeight ?? size * 1.35;
    const lines = wrapText(value, font, size, options.width ?? CONTENT_WIDTH);
    ensureSpace(Math.max(lines.length, 1) * lineHeight);
    for (const line of lines) {
      page.drawText(line, {
        x: MARGIN,
        y,
        font,
        size,
        color: options.color ?? rgb(0.12, 0.16, 0.22),
      });
      y -= lineHeight;
    }
  };
  const labelValue = (label: string, value: string, x: number) => {
    page.drawText(safePdfText(label), {
      x,
      y,
      font: bold,
      size: 9,
      color: rgb(0.32, 0.38, 0.46),
    });
    page.drawText(safePdfText(value), {
      x,
      y: y - 15,
      font: regular,
      size: 10,
      color: rgb(0.12, 0.16, 0.22),
    });
  };

  page.drawText(COMPANY_NAME, {
    x: MARGIN,
    y,
    font: bold,
    size: 22,
    color: rgb(0.12, 0.31, 0.56),
  });
  page.drawText("QUOTE", {
    x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize("QUOTE", 22),
    y,
    font: bold,
    size: 22,
    color: rgb(0.12, 0.31, 0.56),
  });
  y -= 24;
  drawLines(`${BILLING_EMAIL}  |  ${BILLING_TAXID}`, {
    size: 9,
    color: rgb(0.35, 0.4, 0.48),
  });
  y -= 14;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 1.5,
    color: rgb(0.12, 0.31, 0.56),
  });
  y -= 28;

  labelValue("QUOTE NUMBER", opts.quote_number, MARGIN);
  labelValue("ISSUED", displayDate(opts.issued_at), MARGIN + 178);
  labelValue("VALID THROUGH", displayDate(opts.valid_until), MARGIN + 350);
  y -= 52;

  drawLines("PREPARED FOR", {
    font: bold,
    size: 9,
    color: rgb(0.32, 0.38, 0.46),
  });
  const contact = opts.preview.billing_contacts[0];
  drawLines(opts.preview.organization_name, { font: bold, size: 13 });
  if (contact) {
    drawLines(`${contact.name_snapshot} <${contact.email_snapshot}>`, {
      size: 10,
    });
  }
  for (const line of billingAddressLines(opts.preview.billing_address)) {
    drawLines(line, { size: 10 });
  }
  y -= 18;

  ensureSpace(44);
  page.drawRectangle({
    x: MARGIN,
    y: y - 24,
    width: CONTENT_WIDTH,
    height: 28,
    color: rgb(0.92, 0.95, 0.98),
  });
  page.drawText("DESCRIPTION", {
    x: MARGIN + 8,
    y: y - 14,
    font: bold,
    size: 9,
  });
  page.drawText("QTY", {
    x: MARGIN + 320,
    y: y - 14,
    font: bold,
    size: 9,
  });
  page.drawText("UNIT", {
    x: MARGIN + 380,
    y: y - 14,
    font: bold,
    size: 9,
  });
  page.drawText("SUBTOTAL", {
    x: MARGIN + 444,
    y: y - 14,
    font: bold,
    size: 9,
  });
  y -= 38;

  for (const item of opts.preview.items) {
    const description = wrapText(item.description, regular, 9, 300);
    const rowHeight = Math.max(28, description.length * 12 + 8);
    ensureSpace(rowHeight);
    description.forEach((line, index) => {
      page.drawText(line, {
        x: MARGIN + 8,
        y: y - index * 12,
        font: regular,
        size: 9,
      });
    });
    page.drawText(safePdfText(item.quantity), {
      x: MARGIN + 320,
      y,
      font: regular,
      size: 9,
    });
    page.drawText(displayMoney(item.unit_amount, opts.preview.currency), {
      x: MARGIN + 380,
      y,
      font: regular,
      size: 9,
    });
    page.drawText(displayMoney(item.subtotal, opts.preview.currency), {
      x: MARGIN + 444,
      y,
      font: regular,
      size: 9,
    });
    y -= rowHeight;
    page.drawLine({
      start: { x: MARGIN, y: y + 8 },
      end: { x: PAGE_WIDTH - MARGIN, y: y + 8 },
      thickness: 0.5,
      color: rgb(0.82, 0.84, 0.88),
    });
  }

  ensureSpace(80);
  y -= 4;
  page.drawText("SUBTOTAL", {
    x: MARGIN + 350,
    y,
    font: bold,
    size: 10,
  });
  page.drawText(displayMoney(opts.preview.subtotal, opts.preview.currency), {
    x: MARGIN + 444,
    y,
    font: regular,
    size: 10,
  });
  y -= 22;
  page.drawText("TOTAL", {
    x: MARGIN + 350,
    y,
    font: bold,
    size: 12,
    color: rgb(0.12, 0.31, 0.56),
  });
  page.drawText(displayMoney(opts.preview.total, opts.preview.currency), {
    x: MARGIN + 444,
    y,
    font: bold,
    size: 12,
    color: rgb(0.12, 0.31, 0.56),
  });
  y -= 38;

  if (opts.preview.service_starts_at || opts.preview.service_ends_at) {
    drawLines("SERVICE TERM", {
      font: bold,
      size: 9,
      color: rgb(0.32, 0.38, 0.46),
    });
    drawLines(
      `${displayDate(opts.preview.service_starts_at)} through ${displayDate(opts.preview.service_ends_at)}`,
    );
    y -= 8;
  }
  if (opts.preview.customer_reference) {
    drawLines(`Customer reference: ${opts.preview.customer_reference}`);
  }
  if (opts.preview.po_number) {
    drawLines(`Purchase order: ${opts.preview.po_number}`);
  }
  if (opts.preview.quote_memo) {
    y -= 8;
    drawLines("NOTES", {
      font: bold,
      size: 9,
      color: rgb(0.32, 0.38, 0.46),
    });
    drawLines(opts.preview.quote_memo, { size: 9 });
  }

  for (const [index, outputPage] of pdf.getPages().entries()) {
    outputPage.drawText(
      safePdfText(
        `${opts.quote_number}  |  Page ${index + 1} of ${pdf.getPageCount()}`,
      ),
      {
        x: MARGIN,
        y: 28,
        font: regular,
        size: 8,
        color: rgb(0.42, 0.46, 0.52),
      },
    );
  }

  return Buffer.from(await pdf.save());
}
