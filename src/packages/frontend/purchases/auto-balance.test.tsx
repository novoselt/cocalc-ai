/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import AutoBalance, {
  describeAutoBalance,
  getAutoBalanceConfig,
} from "./auto-balance";

let mockStripeEnabled = false;
let mockAutoBalance: any;
const mockSetAutoBalance = jest.fn();
const mockRunFreshAuthAction = jest.fn(async (action) => {
  await action();
  return true;
});

jest.mock("antd", () => {
  const React = require("react");
  const form = { setFieldsValue: jest.fn() };
  const Form = ({ children, colon, layout }: any) => (
    <form
      data-colon={`${colon}`}
      data-layout={layout ?? "horizontal"}
      data-testid="settings-form"
    >
      {children}
    </form>
  );
  Form.Item = ({ children, label }: any) => (
    <label>
      {label}
      {children}
    </label>
  );
  Form.useForm = () => [form];
  const Radio = {
    Group: () => <div data-testid="period-selector" />,
  };
  return {
    Button: ({ children, disabled, onClick }: any) => (
      <button disabled={disabled} onClick={onClick} type="button">
        {children}
      </button>
    ),
    Form,
    InputNumber: () => <input type="number" />,
    Modal: ({ children, title }: any) => (
      <section>
        <h2>{title}</h2>
        {children}
      </section>
    ),
    Popconfirm: ({
      children,
      description,
      okText,
      onConfirm,
      styles,
      title,
    }: any) => (
      <div data-testid="confirmation" style={styles?.root}>
        {children}
        <div>{title}</div>
        <div>{description}</div>
        <button onClick={onConfirm} type="button">
          {okText}
        </button>
      </div>
    ),
    Radio,
    Space: ({ children }: any) => <div>{children}</div>,
    Switch: ({ "aria-label": ariaLabel, checked, loading }: any) => (
      <button
        aria-checked={checked}
        aria-label={ariaLabel}
        disabled={loading}
        role="switch"
        type="button"
      />
    ),
    Typography: {
      Text: ({ children }: any) => <span>{children}</span>,
    },
  };
});

jest.mock("@cocalc/frontend/app-framework", () => ({
  useTypedRedux: (name: string, field: string) => {
    if (name === "customize" && field === "stripe_enabled") {
      return mockStripeEnabled;
    }
    if (name === "account" && field === "auto_balance") {
      return mockAutoBalance == null
        ? undefined
        : { toJS: () => mockAutoBalance };
    }
    return undefined;
  },
}));

jest.mock("@cocalc/frontend/auth/fresh-auth", () => ({
  FreshAuthModal: () => null,
  useFreshAuthAction: () => ({
    runFreshAuthAction: mockRunFreshAuthAction,
    freshAuthModalProps: {},
  }),
}));

jest.mock("@cocalc/frontend/components/error", () => ({
  __esModule: true,
  default: ({ error }: any) => (error ? <div>{error}</div> : null),
}));

jest.mock("@cocalc/frontend/purchases/api", () => ({
  setAutoBalance: (...args: any[]) => mockSetAutoBalance(...args),
}));

describe("automatic deposit presentation", () => {
  beforeEach(() => {
    mockStripeEnabled = false;
    mockAutoBalance = undefined;
    mockSetAutoBalance.mockReset();
    mockSetAutoBalance.mockResolvedValue(undefined);
    mockRunFreshAuthAction.mockClear();
  });

  it("hides automatic deposits when Stripe billing is unavailable", () => {
    render(<AutoBalance />);

    expect(screen.queryByText("Automatic deposits:")).toBeNull();
  });

  it("shows disabled defaults and their strategy without another click", () => {
    mockStripeEnabled = true;

    render(<AutoBalance />);

    expect(
      screen.getByRole("switch", { name: "Automatic deposits" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Automatic deposits are disabled.")).toBeTruthy();
    expect(
      screen.getByText(describeAutoBalance(getAutoBalanceConfig())),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "CoCalc will automatically charge a saved card according to the strategy shown below.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("confirmation")).toHaveStyle({
      maxWidth: "360px",
    });
    expect(screen.getByText("Edit settings")).toBeTruthy();
  });

  it("enables the displayed default strategy through fresh auth", async () => {
    mockStripeEnabled = true;

    render(<AutoBalance />);
    fireEvent.click(screen.getByText("Enable", { selector: "button" }));

    await waitFor(() => {
      expect(mockSetAutoBalance).toHaveBeenCalledWith({
        ...getAutoBalanceConfig(),
        enabled: true,
      });
    });
    expect(mockRunFreshAuthAction).toHaveBeenCalledTimes(1);
  });

  it("keeps enablement out of the settings modal", () => {
    mockStripeEnabled = true;

    render(<AutoBalance />);
    fireEvent.click(screen.getByText("Edit settings"));

    expect(screen.getByText("Automatic deposit settings")).toBeTruthy();
    expect(screen.getByText("If the balance goes below")).toBeTruthy();
    expect(screen.getByText("Deposit automatically")).toBeTruthy();
    expect(screen.getByText("But no more than")).toBeTruthy();
    expect(screen.getByText("During one")).toBeTruthy();
    expect(screen.getByTestId("settings-form")).toHaveAttribute(
      "data-layout",
      "horizontal",
    );
    expect(screen.getByTestId("settings-form")).toHaveAttribute(
      "data-colon",
      "false",
    );
    expect(screen.queryByText("Enable automatic deposits")).toBeNull();
  });
});
