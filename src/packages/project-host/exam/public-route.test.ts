/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { verifyExamPublicRoute } from "./public-route";

describe("exam public route readiness", () => {
  it("requires the host-served exam page", async () => {
    const fetchImpl = jest.fn(async () => {
      return new Response('<meta name="cocalc-scratchpad" content="exam">', {
        status: 200,
      });
    }) as unknown as typeof fetch;

    await verifyExamPublicRoute("exam-123.example.test", {
      deadlineMs: 50,
      retryMs: 1,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://exam-123.example.test/",
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("fails closed when the public origin never serves the exam page", async () => {
    const fetchImpl = jest.fn(async () => {
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    await expect(
      verifyExamPublicRoute("exam-123.example.test", {
        deadlineMs: 5,
        retryMs: 1,
        fetchImpl,
      }),
    ).rejects.toThrow("exam public route readiness failed");
  });
});
