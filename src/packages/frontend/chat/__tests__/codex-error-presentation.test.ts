import {
  formatCodexErrorForDisplay,
  formatCodexErrorMarkdown,
  CODEX_PROJECT_RESTART_HINT,
  CODEX_PROJECT_RESTART_TITLE,
} from "../codex-error-presentation";

describe("Codex error presentation", () => {
  const error = JSON.stringify({
    type: "error",
    status: 400,
    error: {
      type: "invalid_request_error",
      message:
        "The 'gpt-5.6-sol' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
    },
  });

  it("replaces outdated Codex errors with a project restart solution", () => {
    expect(formatCodexErrorForDisplay(error)).toBe(
      `${CODEX_PROJECT_RESTART_TITLE} ${CODEX_PROJECT_RESTART_HINT}`,
    );
  });

  it("formats the project restart solution for assistant Markdown", () => {
    expect(formatCodexErrorMarkdown(error)).toBe(
      `**${CODEX_PROJECT_RESTART_TITLE}**\n\n${CODEX_PROJECT_RESTART_HINT}`,
    );
  });

  it("leaves unrelated errors unchanged", () => {
    expect(formatCodexErrorForDisplay("Codex is not signed in")).toBe(
      "Codex is not signed in",
    );
    expect(formatCodexErrorMarkdown("Codex is not signed in")).toBe(
      "Codex is not signed in",
    );
  });
});
