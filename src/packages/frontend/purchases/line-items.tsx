import { useMemo } from "react";
import type { LineItem } from "@cocalc/util/stripe/types";
import { Table } from "antd";
import { currency } from "@cocalc/util/misc";

export function moneyToString(amount, currency0 = "usd") {
  if (currency0 == "usd") {
    return currency(amount);
  } else {
    return `${currency0.toUpperCase()} ${amount}`;
  }
}

const LINE_ITEMS_COLUMNS = [
  {
    title: "Description",
    dataIndex: "description",
    key: "description",
  } as const,
  {
    title: "Amount",
    dataIndex: "amount",
    key: "amount",
    render: (amount, { currency }) => (
      <div style={{ whiteSpace: "nowrap" }}>
        {moneyToString(amount, currency)}
      </div>
    ),
    align: "right",
  } as const,
];

const EXTRA_LINE_ITEMS_COLUMNS = [
  {
    title: "",
    dataIndex: "",
    key: "",
    width: "20%",
  } as const,
  {
    title: "",
    align: "right",
    dataIndex: "description",
    key: "description",
    render: (description, { bold }) => (
      <div
        style={{
          fontWeight: bold ? "bold" : undefined,
          fontSize: bold ? "12pt" : undefined,
        }}
      >
        {description}
      </div>
    ),
  } as const,
  {
    title: "",
    dataIndex: "amount",
    key: "amount",
    render: (amount, { bold, currency }) => (
      <div
        style={{
          whiteSpace: "nowrap",
          fontWeight: bold ? "bold" : undefined,
          fontSize: bold ? "12pt" : undefined,
        }}
      >
        {moneyToString(amount, currency)}
      </div>
    ),
    align: "right",
  } as const,
];

export function LineItemsTable({
  lineItems,
  style,
  currency = "usd",
}: {
  lineItems: LineItem[];
  style?;
  currency?: string;
}) {
  const { dataSource, extraDataSource } = useMemo(() => {
    let key = 1;
    const dataSource: any[] = [];
    const extraDataSource: any[] = [];
    for (const item of lineItems) {
      const x = { key, ...item, currency };
      if (item.extra) {
        extraDataSource.push(x);
      } else {
        dataSource.push(x);
      }
      key += 1;
    }
    return { dataSource, extraDataSource };
  }, [lineItems]);

  return (
    <div style={style}>
      {dataSource.length > 0 && (
        <Table
          rowKey={"key"}
          pagination={false}
          dataSource={dataSource}
          columns={LINE_ITEMS_COLUMNS}
        />
      )}
      {extraDataSource.length > 0 && (
        <Table
          rowKey={"key"}
          pagination={false}
          dataSource={extraDataSource}
          columns={EXTRA_LINE_ITEMS_COLUMNS}
        />
      )}
    </div>
  );
}
