/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import refCache from "./refcache";

describe("refCache", () => {
  it("replaces invalid entries without letting old references evict the replacement", async () => {
    let nextId = 0;
    const closed: number[] = [];
    const get = refCache<
      { key: string },
      { id: number; valid: boolean; close: () => void }
    >({
      name: "refcache-invalid-entry-test",
      createKey: ({ key }) => key,
      createObject: async () => {
        const id = ++nextId;
        return {
          id,
          valid: true,
          close: () => {
            closed.push(id);
          },
        };
      },
      isValid: (obj) => obj.valid,
    });

    const first = await get({ key: "shared" });
    const secondReference = await get({ key: "shared" });
    expect(secondReference).toBe(first);

    first.valid = false;
    const replacement = await get({ key: "shared" });
    expect(replacement).not.toBe(first);
    expect(get.one()).toBe(replacement);

    first.close();
    secondReference.close();
    expect(closed).toEqual([first.id]);
    expect(get.one()).toBe(replacement);

    replacement.close();
    expect(closed).toEqual([first.id, replacement.id]);
    expect(get.size()).toBe(0);
  });
});
