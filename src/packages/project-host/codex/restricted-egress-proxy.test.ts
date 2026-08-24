import { connect } from "node:net";
import {
  isAllowedCodexEgressTarget,
  shutdownRestrictedCodexEgressProxyForTesting,
  startRestrictedCodexEgressProxySession,
} from "./restricted-egress-proxy";

async function connectResponse({
  proxyUrl,
  target,
  authenticated,
}: {
  proxyUrl: string;
  target: string;
  authenticated: boolean;
}): Promise<string> {
  const parsed = new URL(proxyUrl);
  const socket = connect(Number(parsed.port), "127.0.0.1");
  return await new Promise<string>((resolve, reject) => {
    let response = "";
    socket.once("error", reject);
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.includes("\r\n\r\n")) {
        socket.destroy();
        resolve(response);
      }
    });
    socket.once("connect", () => {
      const authorization = authenticated
        ? `Proxy-Authorization: Basic ${Buffer.from(
            `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`,
          ).toString("base64")}\r\n`
        : "";
      socket.write(
        `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${authorization}\r\n`,
      );
    });
  });
}

afterAll(async () => {
  await shutdownRestrictedCodexEgressProxyForTesting();
});

describe("restricted Codex egress proxy", () => {
  it("allows only exact OpenAI TLS targets", () => {
    expect(isAllowedCodexEgressTarget("chatgpt.com:443")).toBe(true);
    expect(isAllowedCodexEgressTarget("api.openai.com:443")).toBe(true);
    expect(isAllowedCodexEgressTarget("auth.openai.com:443")).toBe(true);
    expect(isAllowedCodexEgressTarget("chatgpt.com.evil.test:443")).toBe(false);
    expect(isAllowedCodexEgressTarget("github.com:443")).toBe(false);
    expect(isAllowedCodexEgressTarget("chatgpt.com:80")).toBe(false);
  });

  it("requires a session credential before checking the destination", async () => {
    const session = await startRestrictedCodexEgressProxySession();
    try {
      await expect(
        connectResponse({
          proxyUrl: session.proxyUrl,
          target: "github.com:443",
          authenticated: false,
        }),
      ).resolves.toContain("407 Proxy Authentication Required");
    } finally {
      session.close();
    }
  });

  it("starts concurrent sessions through one listener", async () => {
    await shutdownRestrictedCodexEgressProxyForTesting();
    const sessions = await Promise.all([
      startRestrictedCodexEgressProxySession(),
      startRestrictedCodexEgressProxySession(),
      startRestrictedCodexEgressProxySession(),
    ]);
    try {
      const ports = sessions.map((session) => new URL(session.proxyUrl).port);
      expect(new Set(ports).size).toBe(1);
      expect(new Set(sessions.map((session) => session.proxyUrl)).size).toBe(3);
    } finally {
      for (const session of sessions) session.close();
    }
  });

  it("rejects authenticated tunnels to non-OpenAI hosts", async () => {
    const session = await startRestrictedCodexEgressProxySession();
    try {
      await expect(
        connectResponse({
          proxyUrl: session.proxyUrl,
          target: "github.com:443",
          authenticated: true,
        }),
      ).resolves.toContain("403 Forbidden");
    } finally {
      session.close();
    }
  });
});
