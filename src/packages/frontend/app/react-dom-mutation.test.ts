/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { isReactDomMutationError } from "./react-dom-mutation";

describe("isReactDomMutationError", () => {
  test.each([
    "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
    "Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.",
    "Node.removeChild: The node to be removed is not a child of this node",
    "Node.insertBefore: Child to insert before is not a child of this node",
  ])("recognizes a React host-node reconciliation failure: %s", (message) => {
    const error = Object.assign(new Error(message), { name: "NotFoundError" });
    expect(isReactDomMutationError(error)).toBe(true);
  });

  test.each([
    new Error("The node is not a child of this node"),
    Object.assign(new Error("Permission denied"), { name: "NotFoundError" }),
    Object.assign(new Error("removeChild failed"), { name: "TypeError" }),
    undefined,
  ])("does not classify an unrelated error: %p", (error) => {
    expect(isReactDomMutationError(error)).toBe(false);
  });
});
