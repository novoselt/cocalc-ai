/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  BLIT_APPLICATIONS,
  INSTALL_BLIT_APPLICATION_COMMAND,
  LAUNCH_BLIT_APPLICATION_COMMAND,
  parseBlitApplicationAvailability,
} from "./blit-applications";

describe("Blit application catalog", () => {
  it("has unique safe application and package identifiers", () => {
    const ids = BLIT_APPLICATIONS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const app of BLIT_APPLICATIONS) {
      expect(app.id).toMatch(/^[a-z0-9-]+$/);
      expect(app.command.every((argument) => argument.length > 0)).toBe(true);
      if ("install" in app) {
        expect(app.install.packages.length).toBeGreaterThan(0);
        for (const packageName of app.install.packages) {
          expect(packageName).toMatch(/^[a-z0-9][a-z0-9+.-]*$/);
        }
      }
    }
  });

  it("passes launch and install values as positional shell arguments", () => {
    const remainingArguments = '"$' + '{@:2}"';
    expect(LAUNCH_BLIT_APPLICATION_COMMAND).toContain(remainingArguments);
    expect(INSTALL_BLIT_APPLICATION_COMMAND).toContain('install -y "$@"');
    expect(LAUNCH_BLIT_APPLICATION_COMMAND).toContain(
      "socket:$HOME/.local/state/cocalc/blit/runtime/server.sock",
    );
    expect(LAUNCH_BLIT_APPLICATION_COMMAND).toContain("exec blit");
    expect(LAUNCH_BLIT_APPLICATION_COMMAND).not.toContain("/opt/cocalc/");
  });

  it("parses explicit installed and missing responses", () => {
    expect(
      parseBlitApplicationAvailability("cocalc-blit-app:installed\n"),
    ).toBe("installed");
    expect(parseBlitApplicationAvailability("cocalc-blit-app:missing\n")).toBe(
      "missing",
    );
    expect(() => parseBlitApplicationAvailability("noise")).toThrow(
      "Unable to determine",
    );
  });
});
