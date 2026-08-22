/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { SPEC } from "./install";

describe("sandbox tool install scripts", () => {
  it("installs Blit at the path checked by the installer", () => {
    const script = SPEC.blit.script();
    expect(script).toContain(
      `install -m 0755 "$tmp/bin/blit" "${SPEC.blit.path}"`,
    );
  });

  it("installs xwayland-satellite at the path checked by the installer", () => {
    const script = SPEC.xwaylandSatellite.script();
    expect(script).toContain(
      `bin/xwayland-satellite" "${SPEC.xwaylandSatellite.path}"`,
    );
  });
});
