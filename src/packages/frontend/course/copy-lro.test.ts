/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

export {};

const lroWaitMock = jest.fn();
const lroGetMock = jest.fn();
const listCopyRowsByOpIdMock = jest.fn();

jest.mock("../webapp-client", () => ({
  webapp_client: {
    conat_client: {
      lroWait: (...args: any[]) => lroWaitMock(...args),
      hub: {
        lro: {
          get: (...args: any[]) => lroGetMock(...args),
        },
      },
    },
    project_client: {
      listCopyRowsByOpId: (...args: any[]) => listCopyRowsByOpIdMock(...args),
    },
  },
}));

const op = {
  op_id: "11111111-1111-4111-8111-111111111111",
  scope_type: "project" as const,
  scope_id: "22222222-2222-4222-8222-222222222222",
};
const dests = [
  {
    student_id: "student-1",
    project_id: "33333333-3333-4333-8333-333333333333",
  },
  {
    student_id: "student-2",
    project_id: "44444444-4444-4444-8444-444444444444",
  },
];

describe("course copy LRO reconciliation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("recovers durable results after the live wait times out", async () => {
    const timeout = Object.assign(new Error("request timed out"), {
      code: 408,
    });
    lroWaitMock.mockRejectedValue(timeout);
    lroGetMock.mockResolvedValue({
      ...op,
      kind: "copy-path-between-projects",
      status: "succeeded",
    });
    listCopyRowsByOpIdMock.mockResolvedValue([
      {
        dest_project_id: dests[0].project_id,
        status: "done",
      },
      {
        dest_project_id: dests[1].project_id,
        status: "failed",
        last_error: "destination is full",
      },
    ]);

    const { waitForCourseCopyLro } = await import("./copy-lro");
    await expect(waitForCourseCopyLro({ op, dests })).resolves.toEqual({
      "student-1": "",
      "student-2": "destination is full",
    });
    expect(lroGetMock).toHaveBeenCalledWith({
      op_id: op.op_id,
      timeout: 60_000,
    });
  });

  it("leaves an active operation pending for later reconciliation", async () => {
    lroGetMock.mockResolvedValue({
      ...op,
      kind: "copy-path-between-projects",
      status: "running",
    });

    const { reconcileCourseCopyLro } = await import("./copy-lro");
    await expect(
      reconcileCourseCopyLro({ op, dests }),
    ).resolves.toBeUndefined();
    expect(listCopyRowsByOpIdMock).not.toHaveBeenCalled();
  });

  it("recovers destinations from persisted LRO input", async () => {
    const { courseCopyDestinationsFromSummary } = await import("./copy-lro");
    expect(
      courseCopyDestinationsFromSummary({
        ...op,
        kind: "copy-path-between-projects",
        status: "running",
        input: {
          dests: [
            {
              project_id: dests[0].project_id,
              metadata: { student_id: dests[0].student_id },
            },
            { project_id: dests[1].project_id },
          ],
        },
      } as any),
    ).toEqual([dests[0]]);
  });
});
