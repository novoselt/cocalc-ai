export {};

describe("sync-impl explicit client routing", () => {
  it("requires an explicit Conat client", async () => {
    const { history } = await import("./sync-impl");

    await expect(
      history({
        project_id: "00000000-1000-4000-8000-000000000000",
        path: "a.txt",
      }),
    ).rejects.toThrow("must provide an explicit Conat client");
  });

  it("accepts a client wrapper that exposes conat()", async () => {
    const { history } = await import("./sync-impl");

    async function* getAllPatches() {
      yield { seq: 1, patch: "x" } as any;
    }

    const closeAstream = jest.fn();
    const closeAkv = jest.fn();
    const rawClient = {
      sync: {
        astream: jest.fn(() => ({
          getAll: jest.fn(async () => getAllPatches()),
          close: closeAstream,
        })),
        akv: jest.fn(() => ({
          keys: jest.fn(async () => ['["meta","snapshot"]']),
          get: jest.fn(async () => ({ seq: 1 })),
          close: closeAkv,
        })),
      },
    };

    await expect(
      history({
        project_id: "00000000-1000-4000-8000-000000000000",
        path: "a.txt",
        client: {
          conat: () => rawClient,
        },
      }),
    ).resolves.toEqual({
      patches: [{ seq: 1, patch: "x" }],
      info: { snapshot: { seq: 1 } },
    });
    expect(closeAstream).toHaveBeenCalledTimes(1);
    expect(closeAkv).toHaveBeenCalledTimes(1);
  });
});
