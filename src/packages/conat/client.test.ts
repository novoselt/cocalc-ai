/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  closeConatClientForTests,
  conat,
  numSubscriptions,
  setConatClient,
} from "./client";

describe("global Conat client", () => {
  const previousTestMode = process.env.COCALC_TEST_MODE;

  beforeEach(() => {
    process.env.COCALC_TEST_MODE = "1";
    closeConatClientForTests();
  });

  afterAll(() => {
    closeConatClientForTests();
    if (previousTestMode == null) {
      delete process.env.COCALC_TEST_MODE;
    } else {
      process.env.COCALC_TEST_MODE = previousTestMode;
    }
  });

  it("reports subscriptions from the initialized underlying client", () => {
    const client = {
      close: jest.fn(),
      numSubscriptions: jest.fn(() => 23),
    } as any;
    setConatClient({ conat: () => client });

    expect(numSubscriptions()).toBe(0);
    expect(conat()).toBe(client);
    expect(numSubscriptions()).toBe(23);
  });
});
