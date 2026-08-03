import { executeCode } from "@cocalc/backend/execute-code";
import { withBtrfsMutationContext } from "./mutation-context";
import { btrfs } from "./util";

jest.mock("@cocalc/backend/execute-code", () => ({
  executeCode: jest.fn(),
}));

const mockedExecuteCode = jest.mocked(executeCode);

describe("btrfs privileged command routing", () => {
  beforeEach(() => {
    mockedExecuteCode.mockReset();
    mockedExecuteCode.mockResolvedValue({
      type: "blocking",
      stdout: "",
      stderr: "",
      exit_code: 0,
    } as any);
  });

  it("uses the normal command for interactive mutations", async () => {
    await btrfs({ args: ["subvolume", "show", "/mnt/cocalc"] });

    expect(mockedExecuteCode).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "sudo",
        args: [
          "-n",
          "/usr/local/sbin/cocalc-runtime-storage",
          "btrfs",
          "subvolume",
          "show",
          "/mnt/cocalc",
        ],
      }),
    );
  });

  it("moves scheduled mutations through the maintenance command", async () => {
    await withBtrfsMutationContext({ priority: "scheduled" }, async () => {
      await btrfs({
        args: ["subvolume", "snapshot", "-r", "/mnt/source", "/mnt/dest"],
      });
    });

    expect(mockedExecuteCode).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "sudo",
        args: [
          "-n",
          "/usr/local/sbin/cocalc-runtime-storage",
          "btrfs-maintenance",
          "subvolume",
          "snapshot",
          "-r",
          "/mnt/source",
          "/mnt/dest",
        ],
      }),
    );
  });
});
