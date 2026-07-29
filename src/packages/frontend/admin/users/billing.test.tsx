import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const getBillingSummaryAdmin = jest.fn();

jest.mock("@cocalc/frontend/purchases/api", () => ({
  getBillingSummaryAdmin: (...args: any[]) => getBillingSummaryAdmin(...args),
}));

jest.mock("@cocalc/frontend/components", () => ({
  TimeAgo: ({ date }: { date: Date }) => (
    <span>{`time:${date.toISOString()}`}</span>
  ),
}));

jest.mock("@cocalc/frontend/purchases/purchases", () => ({
  __esModule: true,
  default: ({ account_id, noTitle }: any) => (
    <div>{`purchases:${account_id}:${noTitle}`}</div>
  ),
}));

jest.mock("@cocalc/frontend/purchases/payments", () => ({
  __esModule: true,
  default: ({ account_id }: any) => <div>{`payments:${account_id}`}</div>,
}));

jest.mock("./create-payment", () => ({
  __esModule: true,
  default: ({ account_id }: any) => <div>{`create-payment:${account_id}`}</div>,
}));

jest.mock("@cocalc/frontend/admin/admin-purchase", () => ({
  AdminBalanceAdjustment: ({ account_id, onAdjusted }: any) => (
    <button onClick={onAdjusted}>{`balance-adjustment:${account_id}`}</button>
  ),
}));

jest.mock("antd", () => {
  const React = require("react");
  return {
    Alert: ({ title }: any) => <div>{title}</div>,
    Space: ({ children }: any) => <div>{children}</div>,
    Spin: () => <div>loading</div>,
    Tabs: ({ defaultActiveKey, items }: any) => {
      const [activeKey, setActiveKey] = React.useState(defaultActiveKey);
      return (
        <div>
          {items.map(({ key, label }: any) => (
            <button key={key} onClick={() => setActiveKey(key)}>
              {label}
            </button>
          ))}
          {items.find(({ key }: any) => key === activeKey)?.children}
        </div>
      );
    },
  };
});

const { AdminBilling } = require("./billing");

describe("AdminBilling", () => {
  beforeEach(() => {
    getBillingSummaryAdmin.mockReset().mockResolvedValue({
      balance: "56.51",
      spend_30d: "12.34",
      spend_365d: "78.90",
      last_transaction_at: "2026-07-01T12:00:00.000Z",
    });
  });

  it("shows a live summary and opens Purchases by default", async () => {
    render(<AdminBilling account_id="acct-1" />);

    expect((await screen.findByText("$56.51")).tagName).toBe("STRONG");
    expect(screen.getByText("$12.34").tagName).toBe("STRONG");
    expect(screen.getByText("$78.90").tagName).toBe("STRONG");
    expect(
      screen.getByText("time:2026-07-01T12:00:00.000Z").parentElement?.tagName,
    ).toBe("STRONG");
    expect(screen.getByText("purchases:acct-1:true")).toBeTruthy();
    expect(screen.queryByText("payments:acct-1")).toBeNull();

    fireEvent.click(screen.getByText("Payments"));
    expect(screen.queryByText("purchases:acct-1:true")).toBeNull();
    expect(screen.getByText("payments:acct-1")).toBeTruthy();
  });

  it("shows a precise empty-history message", async () => {
    getBillingSummaryAdmin.mockResolvedValue({
      balance: "0",
      spend_30d: "0",
      spend_365d: "0",
      last_transaction_at: null,
    });

    render(<AdminBilling account_id="acct-2" />);
    expect(await screen.findByText("No billing history.")).toBeTruthy();
  });

  it("refreshes the summary after a balance adjustment", async () => {
    render(<AdminBilling account_id="acct-3" />);
    await waitFor(() =>
      expect(getBillingSummaryAdmin).toHaveBeenCalledTimes(1),
    );

    fireEvent.click(screen.getByText("Balance adjustment"));
    fireEvent.click(screen.getByText("balance-adjustment:acct-3"));

    await waitFor(() =>
      expect(getBillingSummaryAdmin).toHaveBeenCalledTimes(2),
    );
  });
});
