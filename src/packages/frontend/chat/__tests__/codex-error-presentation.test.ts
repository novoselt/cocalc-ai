import {
  addCodexProjectRestartHint,
  CODEX_PROJECT_RESTART_HINT,
} from "../codex-error-presentation";

describe("Codex error presentation", () => {
  it("adds a project restart solution to outdated Codex errors", () => {
    const error =
      "The 'gpt-5.6-sol' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.";

    expect(addCodexProjectRestartHint(error)).toBe(
      `${error} ${CODEX_PROJECT_RESTART_HINT}`,
    );
  });

  it("leaves unrelated errors unchanged", () => {
    expect(addCodexProjectRestartHint("Codex is not signed in")).toBe(
      "Codex is not signed in",
    );
  });
});
