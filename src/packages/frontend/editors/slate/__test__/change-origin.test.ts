import {
  hasOnlySelectionOperations,
  isLocalContentChange,
} from "../change-origin";

describe("Slate change origin", () => {
  it("does not treat remote synchronization as a local edit", () => {
    expect(
      isLocalContentChange({
        operations: [{ type: "insert_text" }],
        syncCausedUpdate: true,
      }),
    ).toBe(false);
  });

  it("does not treat selection changes as content edits", () => {
    const operations = [{ type: "set_selection" }];
    expect(hasOnlySelectionOperations(operations)).toBe(true);
    expect(isLocalContentChange({ operations, syncCausedUpdate: false })).toBe(
      false,
    );
  });

  it("treats local content operations as edits", () => {
    expect(
      isLocalContentChange({
        operations: [{ type: "insert_text" }],
        syncCausedUpdate: false,
      }),
    ).toBe(true);
  });

  it("preserves initial empty-operation change handling", () => {
    expect(
      isLocalContentChange({ operations: [], syncCausedUpdate: false }),
    ).toBe(true);
  });
});
