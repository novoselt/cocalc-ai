/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  addBlitPassphrase,
  BLIT_APP_ID,
  BLIT_PASSPHRASE,
  createBlitAppSpec,
} from "./blit-app";

describe("Blit managed app", () => {
  it("uses the private websocket-aware prefix-stripping proxy", () => {
    const spec = createBlitAppSpec();
    expect(spec.id).toBe(BLIT_APP_ID);
    expect(spec.kind).toBe("service");
    expect(spec.proxy).toMatchObject({
      open_mode: "proxy",
      strip_prefix: true,
      websocket: true,
    });
    expect(spec.command.env).toEqual({ BLIT_PASSPHRASE });
  });

  it("keeps the Blit credential in the URL fragment", () => {
    const url = addBlitPassphrase(
      "https://host/project/port/1234/?auth=secret#old",
    );
    expect(url).toBe(
      `https://host/project/port/1234/?auth=secret#psk=${encodeURIComponent(BLIT_PASSPHRASE)}`,
    );
  });

  it("starts both managed processes and provides a CPU-host Vulkan fallback", () => {
    const spec = createBlitAppSpec();
    const script = spec.command.args[1];
    expect(script).toContain('"$blit_bin" server');
    expect(script).toContain('"$blit_bin" terminal start');
    expect(script).toContain('"$blit_bin" gateway');
    expect(script).toContain("vk_swiftshader_icd.json");
    expect(script).toContain("BLIT_SERVER_NAME=cocalc-x11");
    expect(script).toContain('wait -n "$server_pid" "$gateway_pid"');
  });
});
