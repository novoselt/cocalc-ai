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
        detector_version: "project-host-bandwidth-relay-v1",
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
});
