import {
  clearLocalHistory,
  saveLocalHistory,
  takeLocalHistory,
} from "./local-history-cache";

describe("local editor history cache", () => {
  it("restores history only when the editor value still matches", () => {
    const key = "matching";
    const history = { undos: ["change"], redos: [] };

    saveLocalHistory(key, "current value", history);

    expect(takeLocalHistory(key, "current value")).toBe(history);
    expect(takeLocalHistory(key, "current value")).toBeUndefined();
  });

  it("discards stale history after an external value change", () => {
    const key = "changed";

    saveLocalHistory(key, "old value", { undos: ["change"] });

    expect(takeLocalHistory(key, "new value")).toBeUndefined();
    expect(takeLocalHistory(key, "old value")).toBeUndefined();
  });

  it("can explicitly invalidate an unmounted editor history", () => {
    const key = "cleared";

    saveLocalHistory(key, "value", { undos: ["change"] });
    clearLocalHistory(key);

    expect(takeLocalHistory(key, "value")).toBeUndefined();
  });
});
