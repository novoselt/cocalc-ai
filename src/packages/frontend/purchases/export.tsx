import type { CSSProperties } from "react";
import { Button, Popover, Space } from "antd";
import { stringify as csvStringify } from "csv-stringify/sync";
import { Icon } from "@cocalc/frontend/components/icon";

export interface PrintColumn<T extends object = object> {
  title: string;
  align?: "left" | "center" | "right";
  render: (row: T) => string | number | null | undefined | (string | number)[];
}

interface Props {
  name: string;
  data: object[] | null | undefined;
  style?: CSSProperties;
  print?: {
    title: string;
    subtitle?: string;
    columns: PrintColumn[];
  };
}
export default function ExportPurchases({ name, data, style, print }: Props) {
  if (data == null) return null;
  return (
    <div style={style}>
      <Popover
        placement="bottom"
        content={() => {
          if (data == null) return null;
          const json = JSON.stringify(data, undefined, 2);
          const columns = data
            ? Array.from(new Set(data.flatMap(Object.keys)))
            : [];
          const csv = data
            ? csvStringify(data, {
                header: true,
                columns,
              })
            : "";
          return (
            <Space vertical>
              {print != null && (
                <Button
                  type="link"
                  onClick={() => openPrintView({ data, name, print })}
                >
                  <Icon name="print" /> PDF / Print
                </Button>
              )}
              <Button
                type="link"
                href={URL.createObjectURL(
                  new Blob([csv], {
                    type: "text/plain",
                  }),
                )}
                download={`${name}.csv`}
              >
                <Icon name="csv" /> CSV
              </Button>
              <Button
                type="link"
                href={URL.createObjectURL(
                  new Blob([json], {
                    type: "text/plain",
                  }),
                )}
                download={`${name}.json`}
              >
                <Icon name="js-square" /> JSON
              </Button>
            </Space>
          );
        }}
        trigger="click"
      >
        <Button disabled={data == null}>
          <Icon name="cloud-download" /> Export
        </Button>
      </Popover>
    </div>
  );
}

function openPrintView({
  data,
  name,
  print,
}: {
  data: object[];
  name: string;
  print: NonNullable<Props["print"]>;
}) {
  const win = window.open("", "_blank");
  if (win == null) {
    return;
  }
  win.document.open();
  win.document.write(getPrintHtml({ data, name, print }));
  win.document.close();
}

function getPrintHtml({
  data,
  name,
  print,
}: {
  data: object[];
  name: string;
  print: NonNullable<Props["print"]>;
}) {
  const generated = new Date().toLocaleString();
  const headerRows = print.columns
    .map(({ align, title }) => {
      return `<th class="${align ?? "left"}">${escapeHtml(title)}</th>`;
    })
    .join("");
  const bodyRows = data
    .map((row) => {
      const cells = print.columns
        .map(({ align, render }) => {
          return `<td class="${align ?? "left"}">${renderPrintCell(
            render(row),
          )}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(print.title || name || "Purchases")}</title>
<style>
  @page {
    margin: 0.5in;
  }
  body {
    color: #222;
    font-family: Arial, sans-serif;
    font-size: 11px;
    line-height: 1.35;
    margin: 24px;
  }
  h1 {
    font-size: 18px;
    margin: 0 0 4px;
  }
  .subtitle {
    color: #555;
    margin-bottom: 4px;
  }
  .generated {
    color: #777;
    font-size: 10px;
    margin-bottom: 18px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  thead {
    display: table-header-group;
  }
  tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  th,
  td {
    border-bottom: 1px solid #ddd;
    padding: 4px 6px;
    vertical-align: top;
  }
  th {
    background: #f3f3f3;
    font-weight: bold;
  }
  .left {
    text-align: left;
  }
  .center {
    text-align: center;
  }
  .right {
    text-align: right;
    white-space: nowrap;
  }
  .cell-line {
    white-space: pre-wrap;
  }
  .right .cell-line {
    white-space: nowrap;
  }
  .actions {
    margin-bottom: 18px;
  }
  @media print {
    body {
      margin: 0;
    }
    .actions {
      display: none;
    }
  }
</style>
</head>
<body>
<div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div>
<h1>${escapeHtml(print.title || name || "Purchases")}</h1>
${print.subtitle ? `<div class="subtitle">${escapeHtml(print.subtitle)}</div>` : ""}
<div class="generated">Generated ${escapeHtml(generated)}</div>
<table>
  <thead><tr>${headerRows}</tr></thead>
  <tbody>${bodyRows}</tbody>
</table>
</body>
</html>`;
}

function renderPrintCell(
  value: string | number | null | undefined | (string | number)[],
) {
  const lines = Array.isArray(value) ? value : [value ?? ""];
  return lines
    .map((line) => `<div class="cell-line">${escapeHtml(`${line}`)}</div>`)
    .join("");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
