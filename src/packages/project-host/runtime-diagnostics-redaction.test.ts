import { redactRuntimeLogText } from "./runtime-diagnostics-redaction";

describe("runtime diagnostic redaction", () => {
  it("redacts project-host authentication environment variables", () => {
    const text = [
      "COCALC_AGENT_TOKEN=agent-secret",
      "COCALC_BEARER_TOKEN=bearer-secret",
      "COCALC_API_KEY=api-secret",
      "COCALC_PROJECT_ID=project-id",
    ].join(" ");

    const redacted = redactRuntimeLogText(text);

    expect(redacted).not.toContain("agent-secret");
    expect(redacted).not.toContain("bearer-secret");
    expect(redacted).not.toContain("api-secret");
    expect(redacted).toContain("COCALC_AGENT_TOKEN=[REDACTED]");
    expect(redacted).toContain("COCALC_BEARER_TOKEN=[REDACTED]");
    expect(redacted).toContain("COCALC_API_KEY=[REDACTED]");
    expect(redacted).toContain("COCALC_PROJECT_ID=project-id");
  });
});
