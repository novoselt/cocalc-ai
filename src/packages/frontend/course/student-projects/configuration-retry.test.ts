/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  courseConfigurationErrorMessage,
  isTransientCourseConfigurationError,
  retryCourseConfigurationWrite,
} from "./configuration-retry";

describe("course project configuration retries", () => {
  it("recognizes structured and wrapped RPC timeouts", () => {
    expect(isTransientCourseConfigurationError({ code: 408 })).toBe(true);
    expect(
      isTransientCourseConfigurationError(
        "timeout - callHub: name='db.userQuery', code='408'",
      ),
    ).toBe(true);
    expect(isTransientCourseConfigurationError(new Error("timed out"))).toBe(
      true,
    );
    expect(
      isTransientCourseConfigurationError(new Error("not authorized")),
    ).toBe(false);
  });

  it("retries transient writes with bounded exponential delays", async () => {
    const operation = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: 408 }))
      .mockRejectedValueOnce(new Error("timed out"))
      .mockResolvedValue("ok");
    const wait = jest.fn<Promise<void>, [number]>().mockResolvedValue();

    await expect(
      retryCourseConfigurationWrite(operation, {
        maxAttempts: 3,
        retryDelayMs: 100,
        wait,
      }),
    ).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 100);
    expect(wait).toHaveBeenNthCalledWith(2, 200);
  });

  it("does not retry permanent errors", async () => {
    const error = new Error("not authorized");
    const operation = jest.fn<Promise<void>, []>().mockRejectedValue(error);
    const wait = jest.fn<Promise<void>, [number]>().mockResolvedValue();

    await expect(
      retryCourseConfigurationWrite(operation, { wait }),
    ).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("removes internal callHub details from the course error", () => {
    expect(
      courseConfigurationErrorMessage(
        "timeout - callHub: subject='hub.account.test.api', name='db.userQuery', code='408'",
      ),
    ).toBe("Error configuring student projects - timeout");
  });
});
