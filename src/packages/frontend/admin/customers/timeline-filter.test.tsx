/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { fireEvent, render, screen } from "@testing-library/react";

import { TimelineFilter } from "./timeline-filter";

test("timeline filter exposes its input and result count accessibly", () => {
  const onChange = jest.fn();
  render(
    <TimelineFilter
      matchingCount={2}
      onChange={onChange}
      totalCount={11}
      value="invoice"
      visibleCount={2}
    />,
  );

  const input = screen.getByRole("textbox", {
    name: "Filter customer timeline",
  });
  expect(input).toHaveValue("invoice");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Showing 2 of 2 matching events (11 total)",
  );

  fireEvent.change(input, { target: { value: "Zendesk" } });
  expect(onChange).toHaveBeenCalledWith("Zendesk");
});
