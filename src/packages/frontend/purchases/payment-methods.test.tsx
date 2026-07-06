/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import React from "react";

import PaymentMethods from "./payment-methods";
import {
  deletePaymentMethod,
  getPaymentMethods,
  setDefaultPaymentMethod,
} from "./api";

function freshAuthRequiredError() {
  const err: any = new Error("fresh auth is required");
  err.code = "fresh_auth_required";
  return err;
}

const paymentMethods = [
  {
    id: "pm_default",
    type: "card",
    card: {
      brand: "visa",
      display_brand: "visa",
      exp_month: 1,
      exp_year: 2030,
      last4: "1111",
    },
  },
  {
    id: "pm_other",
    type: "card",
    card: {
      brand: "mastercard",
      display_brand: "mastercard",
      exp_month: 2,
      exp_year: 2031,
      last4: "2222",
    },
  },
];

jest.mock("antd", () => {
  const React = jest.requireActual("react");
  return {
    Button: ({ children, disabled, onClick }: any) => (
      <button disabled={disabled} onClick={onClick} type="button">
        {children}
      </button>
    ),
    Flex: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Popconfirm: ({ children, onConfirm }: any) =>
      React.isValidElement(children)
        ? React.cloneElement(children, { onClick: onConfirm })
        : children,
    Space: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Table: ({ columns, dataSource }: any) => (
      <table>
        <tbody>
          {dataSource.map((row: any) => (
            <tr key={row.id}>
              {columns.map((column: any, i: number) => (
                <td key={column.key ?? column.dataIndex ?? i}>
                  {column.render
                    ? column.render(row[column.dataIndex], row)
                    : row[column.dataIndex]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    ),
    Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  };
});

jest.mock("@cocalc/frontend/auth/fresh-auth", () => ({
  ...jest.requireActual("@cocalc/frontend/auth/fresh-auth"),
  FreshAuthModal: ({ onCancel, onSuccess, open }: any) =>
    open ? (
      <section>
        <div>Confirm security action</div>
        <button onClick={onCancel} type="button">
          Cancel fresh auth
        </button>
        <button
          onClick={async () => {
            await onSuccess();
          }}
          type="button"
        >
          Verify fresh auth
        </button>
      </section>
    ) : null,
}));

jest.mock("@cocalc/frontend/components/error", () => ({
  __esModule: true,
  default: ({ error }: { error?: string }) =>
    error ? <div>{error}</div> : null,
}));

jest.mock("@cocalc/frontend/components/icon", () => ({
  Icon: ({ name }: { name: string }) => <span>{name}</span>,
  isIconName: () => true,
}));

jest.mock("./stripe-payment", () => ({
  AddPaymentMethodButton: () => (
    <button type="button">Add payment method</button>
  ),
  BigSpin: () => <div>loading</div>,
}));

jest.mock("./address", () => ({
  AddressButton: () => <button type="button">Address</button>,
}));

jest.mock("./util", () => ({
  describeNumberOf: ({ n }: { n?: number }) => (
    <span>{n ?? 0} Payment Method(s)</span>
  ),
  RawJson: () => <div>raw json</div>,
  SectionDivider: ({ children }: { children?: ReactNode }) => (
    <section>{children}</section>
  ),
}));

jest.mock("./api", () => ({
  deletePaymentMethod: jest.fn(),
  getPaymentMethods: jest.fn(),
  setDefaultPaymentMethod: jest.fn(),
}));

describe("PaymentMethods", () => {
  beforeEach(() => {
    jest.mocked(deletePaymentMethod).mockReset();
    jest.mocked(getPaymentMethods).mockReset();
    jest.mocked(getPaymentMethods).mockResolvedValue({
      data: paymentMethods,
      default_payment_method: "pm_default",
      has_more: false,
    } as any);
    jest.mocked(setDefaultPaymentMethod).mockReset();
  });

  it("uses fresh auth before setting the default payment method when required", async () => {
    jest
      .mocked(setDefaultPaymentMethod)
      .mockRejectedValueOnce(freshAuthRequiredError())
      .mockResolvedValueOnce(undefined as any);

    render(<PaymentMethods />);

    await waitFor(() => {
      expect(screen.getByText("Set as Default")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Set as Default"));

    await waitFor(() => {
      expect(screen.getByText("Confirm security action")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Verify fresh auth"));

    await waitFor(() => {
      expect(setDefaultPaymentMethod).toHaveBeenCalledTimes(2);
      expect(setDefaultPaymentMethod).toHaveBeenLastCalledWith({
        default_payment_method: "pm_other",
      });
    });
  });

  it("uses fresh auth before deleting a payment method when required", async () => {
    jest
      .mocked(deletePaymentMethod)
      .mockRejectedValueOnce(freshAuthRequiredError())
      .mockResolvedValueOnce(undefined as any);

    render(<PaymentMethods />);

    await waitFor(() => {
      expect(screen.getAllByText("Delete")).toHaveLength(2);
    });
    fireEvent.click(screen.getAllByText("Delete")[0]);

    await waitFor(() => {
      expect(screen.getByText("Confirm security action")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Verify fresh auth"));

    await waitFor(() => {
      expect(deletePaymentMethod).toHaveBeenCalledTimes(2);
      expect(deletePaymentMethod).toHaveBeenLastCalledWith({
        payment_method: "pm_default",
      });
      expect(screen.queryByText("•••• 1111")).toBeNull();
    });
  });
});
