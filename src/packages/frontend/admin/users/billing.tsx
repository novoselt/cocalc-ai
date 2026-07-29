/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Alert, Space, Spin, Tabs } from "antd";
import { useEffect, useState } from "react";
import { TimeAgo } from "@cocalc/frontend/components";
import { AdminBalanceAdjustment } from "@cocalc/frontend/admin/admin-purchase";
import Payments from "@cocalc/frontend/purchases/payments";
import Purchases from "@cocalc/frontend/purchases/purchases";
import { getBillingSummaryAdmin } from "@cocalc/frontend/purchases/api";
import type { AccountBillingSummary } from "@cocalc/util/db-schema/purchases";
import {
  moneyRound2Down,
  toDecimal,
  type MoneyValue,
} from "@cocalc/util/money";
import { currency } from "@cocalc/util/misc";
import CreatePayment from "./create-payment";

function formatMoney(value: MoneyValue): string {
  return currency(moneyRound2Down(toDecimal(value)).toNumber(), 2);
}

function BillingSummary({
  account_id,
  refresh,
}: {
  account_id: string;
  refresh: number;
}) {
  const [summary, setSummary] = useState<AccountBillingSummary | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let canceled = false;
    setSummary(null);
    setError("");
    getBillingSummaryAdmin(account_id)
      .then((value) => {
        if (!canceled) {
          setSummary(value);
        }
      })
      .catch((err) => {
        if (!canceled) {
          setError(`${err}`);
        }
      });
    return () => {
      canceled = true;
    };
  }, [account_id, refresh]);

  if (error) {
    return <Alert type="error" title={error} />;
  }
  if (summary == null) {
    return <Spin />;
  }
  if (summary.last_transaction_at == null) {
    return <span>No billing history.</span>;
  }
  return (
    <Space wrap>
      <span>
        <strong>Balance:</strong> {formatMoney(summary.balance)}
      </span>
      <span>
        <strong>Last 30 days spend:</strong> {formatMoney(summary.spend_30d)}
      </span>
      <span>
        <strong>Last year spend:</strong> {formatMoney(summary.spend_365d)}
      </span>
      <span>
        <strong>Last transaction:</strong>{" "}
        <TimeAgo date={new Date(summary.last_transaction_at)} />
      </span>
    </Space>
  );
}

export function AdminBilling({ account_id }: { account_id: string }) {
  const [summaryRefresh, setSummaryRefresh] = useState(0);
  return (
    <Space orientation="vertical" style={{ width: "100%" }}>
      <BillingSummary account_id={account_id} refresh={summaryRefresh} />
      <Tabs
        defaultActiveKey="purchases"
        items={[
          {
            key: "purchases",
            label: "Purchases",
            children: <Purchases account_id={account_id} noTitle />,
          },
          {
            key: "payments",
            label: "Payments",
            children: <Payments account_id={account_id} />,
          },
          {
            key: "create-payment",
            label: "Create payment",
            children: <CreatePayment account_id={account_id} />,
          },
          {
            key: "balance-adjustment",
            label: "Balance adjustment",
            children: (
              <AdminBalanceAdjustment
                account_id={account_id}
                onAdjusted={() => setSummaryRefresh((value) => value + 1)}
              />
            ),
          },
        ]}
      />
    </Space>
  );
}
