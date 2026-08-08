import { waitForAnyTrue } from "./server";

describe("cluster interest aggregation", () => {
  it("does not let an early negative link mask later interest", async () => {
    let resolveLater: (value: boolean) => void = () => undefined;
    const later = new Promise<boolean>((resolve) => {
      resolveLater = resolve;
    });
    let settled = false;
    const result = waitForAnyTrue([Promise.resolve(false), later]).finally(
      () => {
        settled = true;
      },
    );

    await Promise.resolve();
    expect(settled).toBe(false);

    resolveLater(true);
    await expect(result).resolves.toBe(true);
  });

  it("returns false after every link answers negatively", async () => {
    await expect(
      waitForAnyTrue([Promise.resolve(false), Promise.resolve(false)]),
    ).resolves.toBe(false);
  });

  it("treats a rejected link as a negative answer", async () => {
    await expect(
      waitForAnyTrue([
        Promise.reject(new Error("link closed")),
        Promise.resolve(true),
      ]),
    ).resolves.toBe(true);
  });
});
