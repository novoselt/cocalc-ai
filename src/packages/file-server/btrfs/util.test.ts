import { executeCode } from "@cocalc/backend/execute-code";
import { withBtrfsMutationContext } from "./mutation-context";
import { withBtrfsMutationLock } from "./operation-cache";
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

  it("promotes only the lock-held scheduled transaction", async () => {
    await withBtrfsMutationContext({ priority: "scheduled" }, async () => {
      await btrfs({ args: ["subvolume", "show", "/mnt/source"] });
      await withBtrfsMutationLock({
        mount: "/mnt/test",
        operation: "snapshot-create",
        run: async () => {
          await btrfs({
            args: ["subvolume", "snapshot", "-r", "/mnt/source", "/mnt/dest"],
          });
        },
      });
    });

    expect(mockedExecuteCode.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        args: expect.arrayContaining([
          "btrfs-maintenance",
          "subvolume",
          "show",
        ]),
      }),
    );
    expect(mockedExecuteCode.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        args: expect.arrayContaining(["btrfs", "subvolume", "snapshot"]),
      }),
    );
  });
});
