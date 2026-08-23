import { render, screen } from "@testing-library/react";

import {
  formatReceivablesError,
  IndependentStateAlerts,
  StateTriplet,
} from "./shared";

describe("receivables independent states", () => {
  it("labels workflow, collection, and fulfillment independently", () => {
    render(
      <StateTriplet
        order={{
          workflow_state: "awaiting_payment",
          collection_state: "overdue",
          fulfillment_state: "provisioned",
        }}
      />,
    );

    expect(screen.getByText(/Workflow:/)).toBeVisible();
    expect(screen.getByText("Awaiting payment")).toBeVisible();
    expect(screen.getByText(/Collection:/)).toBeVisible();
    expect(screen.getByText("Overdue")).toBeVisible();
    expect(screen.getByText(/Fulfillment:/)).toBeVisible();
    expect(screen.getByText("Provisioned")).toBeVisible();
  });

  it("warns when provisioned service remains unpaid", () => {
    render(
      <IndependentStateAlerts
        order={{
          collection_state: "open",
          fulfillment_state: "provisioned",
        }}
      />,
    );

    expect(
      screen.getByText(
        "Service is provisioned, but collection is not complete",
      ),
    ).toBeVisible();
  });

  it("warns when paid service remains unfulfilled", () => {
    render(
      <IndependentStateAlerts
        order={{
          collection_state: "paid",
          fulfillment_state: "not_provisioned",
        }}
      />,
    );

    expect(
      screen.getByText("Payment is complete, but service is not provisioned"),
    ).toBeVisible();
  });

  it("turns staged feature-flag errors into an actionable admin message", () => {
    expect(
      formatReceivablesError(
        "commercial receivables capability 'stripeSend' is disabled by site settings",
      ),
    ).toContain("Admin → Site Settings");
  });
});
