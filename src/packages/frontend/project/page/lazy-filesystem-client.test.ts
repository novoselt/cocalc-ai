import { createLazyClient } from "./lazy-filesystem-client";

describe("createLazyClient", () => {
  it("does not begin routing until a filesystem operation needs the client", async () => {
    const error = new Error("host routing info is unavailable");
    const createClient = jest.fn(async () => {
      throw error;
    });
    const getClient = createLazyClient(createClient);

    expect(createClient).not.toHaveBeenCalled();
    await expect(getClient()).rejects.toBe(error);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("reuses the client promise for subsequent operations", async () => {
    const client = { listing: jest.fn() };
    const createClient = jest.fn(async () => client);
    const getClient = createLazyClient(createClient);

    await expect(getClient()).resolves.toBe(client);
    await expect(getClient()).resolves.toBe(client);
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});
