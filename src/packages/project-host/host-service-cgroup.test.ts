import { describe, expect, it, jest } from "@jest/globals";

import {
  __test__,
  attachCurrentProcessToHostServiceCgroup,
} from "./host-service-cgroup";

describe("host service cgroup attachment", () => {
  it("attaches the current service process through the privileged helper", () => {
    const spawn = jest.fn(() => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));
    expect(
      attachCurrentProcessToHostServiceCgroup({
        pid: 1234,
        spawn,
      }),
    ).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      "sudo",
      ["-n", __test__.STORAGE_WRAPPER, "attach-host-service-cgroup", "1234"],
      {
        encoding: "utf8",
        timeout: __test__.COMMAND_TIMEOUT_MS,
        stdio: "pipe",
      },
    );
  });

  it("does not claim attachment after a helper failure", () => {
    const spawn = jest.fn(() => ({
      status: 2,
      stdout: "",
      stderr: "unsupported command",
    }));
    expect(attachCurrentProcessToHostServiceCgroup({ pid: 1234, spawn })).toBe(
      false,
    );
  });
});
