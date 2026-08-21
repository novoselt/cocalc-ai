/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  addBlitPassphrase,
  BLIT_APP_ID,
  CHECK_BLIT_PREREQUISITES,
  createBlitAppSpec,
  GRAPHICAL_APPS_PACKAGES,
  INSTALL_GRAPHICAL_APPS_COMMAND,
  parseBlitPrerequisites,
} from "./blit-app";

describe("Blit managed app", () => {
  it("uses the private websocket-aware prefix-stripping proxy", () => {
    const spec = createBlitAppSpec("project-id");
    expect(spec.version).toBe(1);
    expect(spec.id).toBe(BLIT_APP_ID);
    expect(spec.kind).toBe("service");
    expect(spec.command).toEqual({
      exec: "/opt/cocalc/tools/current/cocalc-x11",
      env: { BLIT_PASSPHRASE: "project-id" },
    });
    expect(spec.proxy).toMatchObject({
      open_mode: "proxy",
      strip_prefix: true,
      websocket: true,
    });
  });

  it("adds the project-specific Blit handshake to the URL fragment", () => {
    expect(addBlitPassphrase("https://example.test/app#old", "a/b")).toBe(
      "https://example.test/app#psk=a%2Fb",
    );
  });

  it("checks every packaged graphical application dependency", () => {
    for (const packageName of GRAPHICAL_APPS_PACKAGES) {
      expect(CHECK_BLIT_PREREQUISITES).toContain(packageName);
      expect(INSTALL_GRAPHICAL_APPS_COMMAND).toContain(packageName);
    }
    expect(CHECK_BLIT_PREREQUISITES).toContain("cocalc-x11");
    expect(CHECK_BLIT_PREREQUISITES).toContain("xwayland-satellite");
    expect(INSTALL_GRAPHICAL_APPS_COMMAND).toContain("sudo -n apt-get update");
    expect(INSTALL_GRAPHICAL_APPS_COMMAND).toContain("--no-install-recommends");
  });

  it("parses missing tools and packages", () => {
    expect(
      parseBlitPrerequisites(
        "missing-tool:blit\nmissing-package:xwayland\nnoise\n",
      ),
    ).toEqual({
      missingPackages: ["xwayland"],
      missingTools: ["blit"],
    });
  });
});
