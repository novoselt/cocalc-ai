/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  buildBandwidthRelayEvidence,
  detectBandwidthRelayCommand,
  detectProjectBandwidthRelayEvidence,
} from "./bandwidth-relay-detector";

describe("project-host bandwidth relay detector", () => {
  it("requires both tunneling and automated transfer evidence", () => {
    const tunnel = detectBandwidthRelayCommand({
      pid: 10,
      command: "/home/user/cloudflared tunnel --token secret-value",
    });
    const uploader = detectBandwidthRelayCommand({
      pid: 11,
      command: "python /home/user/uploader_bot/bot.py",
    });

    expect(buildBandwidthRelayEvidence(tunnel)).toBeUndefined();
    expect(buildBandwidthRelayEvidence(uploader)).toBeUndefined();
    expect(buildBandwidthRelayEvidence([...tunnel, ...uploader])).toEqual(
      expect.objectContaining({
        confidence: "high",
        detector_version: "project-host-bandwidth-relay-v2",
        signals: expect.arrayContaining([
          expect.objectContaining({
            kind: "tunnel_process",
            pattern: "cloudflared-tunnel",
          }),
          expect.objectContaining({
            kind: "automated_uploader_process",
            pattern: "automated-uploader-script",
          }),
        ]),
      }),
    );
  });

  it("does not retain complete commands or tunnel credentials", () => {
    const signals = detectBandwidthRelayCommand({
      pid: 10,
      command: "/home/user/cloudflared tunnel --token secret-value",
    });

    expect(signals).toEqual([
      {
        kind: "tunnel_process",
        pattern: "cloudflared-tunnel",
        matched: "cloudflared tunnel",
        pid: 10,
        executable: "cloudflared",
      },
    ]);
    expect(JSON.stringify(signals)).not.toContain("secret-value");
  });

  it.each([
    "cloudflared --version",
    "bash -c echo cloudflared tunnel",
    "python research.py",
    "aria2c https://example.com/data.tar",
  ])(
    "does not create high-confidence evidence from one process: %s",
    (command) => {
      expect(
        buildBandwidthRelayEvidence(
          detectBandwidthRelayCommand({ pid: 10, command }),
        ),
      ).toBeUndefined();
    },
  );

  it.each([
    "aria2c https://example.com/data.tar",
    "rclone sync /home/user remote:backup",
    "yt-dlp https://example.com/video",
    "youtube-dl https://example.com/video",
  ])("ignores legitimate generic transfer tooling: %s", (command) => {
    expect(detectBandwidthRelayCommand({ pid: 10, command })).toEqual([]);
  });

  it("walks the live process tree to combine independent indicators", async () => {
    const files: Record<string, string> = {
      "/proc/100/cmdline": "bash\0",
      "/proc/100/task/100/children": "101 102",
      "/proc/101/cmdline":
        "/home/user/cloudflared\0tunnel\0--token\0secret-value\0",
      "/proc/101/task/101/children": "",
      "/proc/102/cmdline": "python\0/home/user/uploader_bot/bot.py\0",
      "/proc/102/task/102/children": "",
    };

    const evidence = await detectProjectBandwidthRelayEvidence({
      rootPid: 100,
      readFileFn: jest.fn(async (path: string) => {
        if (!(path in files)) throw Error("missing");
        return files[path];
      }),
    });

    expect(evidence?.confidence).toBe("high");
    expect(JSON.stringify(evidence)).not.toContain("secret-value");
  });

  it("preserves both required signal classes when evidence is truncated", () => {
    const tunnels = Array.from({ length: 12 }, (_, index) => ({
      kind: "tunnel_process" as const,
      pattern: `tunnel-${index}`,
      matched: "tunnel",
    }));
    const transfer = {
      kind: "automated_uploader_process" as const,
      pattern: "automated-uploader-script",
      matched: "uploader_bot/bot.py",
    };

    const evidence = buildBandwidthRelayEvidence([...tunnels, transfer]);

    expect(evidence?.signals).toHaveLength(8);
    expect(evidence?.signals).toEqual(expect.arrayContaining([transfer]));
    expect(evidence?.signals[0]).toEqual(tunnels[0]);
  });
});
