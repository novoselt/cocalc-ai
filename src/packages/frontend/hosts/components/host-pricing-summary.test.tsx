/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { PriceSummaryRow } from "./host-pricing-summary";

describe("PriceSummaryRow", () => {
  it("keeps compact table prices inside the available width", () => {
    const { container } = render(
      <PriceSummaryRow
        current
        label="Standard"
        estimate={{
          usd_per_hour: 2.02,
          usd_per_month: 1473.12,
          hourly_label: "$2.02/hr",
          monthly_label: "$1473.12/mo",
          line_items: [],
          notes: [],
        }}
      />,
    );

    expect(container.firstElementChild).toHaveStyle({
      boxSizing: "border-box",
      width: "100%",
    });
    for (const label of ["$2.02/hr", "$1473.12/mo"]) {
      expect(screen.getByText(label).closest(".ant-typography")).toHaveStyle({
        whiteSpace: "nowrap",
      });
    }
  });
});
