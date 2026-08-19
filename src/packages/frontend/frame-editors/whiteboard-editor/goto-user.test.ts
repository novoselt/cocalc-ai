/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

/*
Regression test: `gotoUser` is reached by clicking another user's avatar, which
happens whenever presence shows them -- but presence and retained cursor state
are independent. A user can be present with no cursor entry at all, and then
`cursors[account_id]?.locs` is undefined. Iterating that threw
"locs is not iterable". Jupyter's implementation already guarded this.
*/

import { Actions } from "./actions";

describe("whiteboard gotoUser", () => {
  const account_id = "5b8f0d2c-8a4e-4f2a-9c3d-1e6b7a9f0c11";

  function actionsWithCursors(cursors: unknown) {
    const actions = Object.create(Actions.prototype) as any;
    actions._syncstring = { get_cursors: () => ({ toJS: () => cursors }) };
    actions.scrollElementIntoView = jest.fn();
    return actions;
  }

  it("does nothing when the user is present but has no cursor entry", () => {
    const actions = actionsWithCursors({});

    expect(() => actions.gotoUser(account_id)).not.toThrow();
    expect(actions.scrollElementIntoView).not.toHaveBeenCalled();
  });

  it("does nothing when the user's cursor entry carries no locs", () => {
    const actions = actionsWithCursors({ [account_id]: {} });

    expect(() => actions.gotoUser(account_id)).not.toThrow();
    expect(actions.scrollElementIntoView).not.toHaveBeenCalled();
  });

  it("scrolls to the first loc that identifies an element", () => {
    const actions = actionsWithCursors({
      [account_id]: { locs: [{ y: 3 }, { id: "elt-7" }] },
    });

    actions.gotoUser(account_id, "frame-1");

    expect(actions.scrollElementIntoView).toHaveBeenCalledWith(
      "elt-7",
      "frame-1",
    );
  });
});
