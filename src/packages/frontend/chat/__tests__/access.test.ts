import { isAcpAssistantMessage } from "../access";

describe("isAcpAssistantMessage", () => {
  it("recognizes ACP rows from structural markers without an account id", () => {
    expect(
      isAcpAssistantMessage({
        event: "chat",
        sender_id: "openai-codex-agent",
        date: "2026-07-11T00:00:00.000Z",
        history: [],
        generating: true,
        acp_log_key: "thread-1:message-1",
        thread_id: "thread-1",
        message_id: "message-1",
      }),
    ).toBe(true);
  });

  it("does not classify an ordinary generating chat row as ACP", () => {
    expect(
      isAcpAssistantMessage({
        event: "chat",
        sender_id: "assistant",
        date: "2026-07-11T00:00:00.000Z",
        history: [],
        generating: true,
      }),
    ).toBe(false);
  });
});
