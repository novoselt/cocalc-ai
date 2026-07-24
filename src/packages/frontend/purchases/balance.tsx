import type { CSSProperties } from "react";
import { useState } from "react";
import { Button, Card, Space, Spin, Typography } from "antd";
import Payment from "./payment";
import { Icon } from "@cocalc/frontend/components/icon";
import AutoBalance from "./auto-balance";
import { useTypedRedux } from "@cocalc/frontend/app-framework";
import {
  moneyRound2Down,
  moneyToCurrency,
  type MoneyValue,
} from "@cocalc/util/money";

const { Text } = Typography;

interface Props {
  style?: CSSProperties;
  refresh?: Function;
  cost?: MoneyValue; // optional amount of money we want right now
  defaultAdd?: boolean;
}

export default function Balance({ style, refresh, cost, defaultAdd }: Props) {
  const balance = useTypedRedux("account", "balance");
  const [add, setAdd] = useState<boolean>(!!defaultAdd);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await refresh?.();
    } finally {
      setRefreshing(false);
    }
  };

  let body;
  if (balance == null) {
    body = (
      <div
        style={{
          height: "125px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Spin delay={1000} size="large" />
      </div>
    );
  } else {
    if (!add) {
      body = (
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Space align="center" wrap>
            <Text>
              Current balance:{" "}
              <Text strong style={{ fontSize: "18px" }}>
                {moneyToCurrency(moneyRound2Down(balance))}
              </Text>
            </Text>
            {refresh != null && (
              <Button
                icon={<Icon name="refresh" />}
                loading={refreshing}
                onClick={handleRefresh}
              >
                Refresh
              </Button>
            )}
            <Button
              icon={<Icon name="credit-card" />}
              type="primary"
              onClick={() => setAdd(true)}
            >
              Add funds
            </Button>
          </Space>
          <AutoBalance />
        </Space>
      );
    } else {
      body = (
        <>
          <Button
            onClick={() => setAdd(false)}
            style={{ position: "absolute", right: "15px" }}
          >
            Cancel
          </Button>
          <Payment
            balance={balance}
            update={() => {
              refresh?.();
              setAdd(false);
            }}
            cost={cost}
          />
        </>
      );
    }
  }
  return <Card style={{ ...style, textAlign: "left" }}>{body}</Card>;
}
