/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { MANAGE_SEATS_MODAL_BODY_STYLE } from "./manage-seats";

describe("ManageSeats modal layout", () => {
  it("contains long seat tables in a viewport-bounded scrolling body", () => {
    expect(MANAGE_SEATS_MODAL_BODY_STYLE).toEqual({
      maxHeight: "calc(100vh - 180px)",
      overflowX: "hidden",
      overflowY: "auto",
    });
  });
});
