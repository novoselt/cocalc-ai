/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { projectActiveUserMapPosition } from "./active-users-map-geometry";

describe("active users map projection", () => {
  it("projects the equator to the vertical center", () => {
    expect(projectActiveUserMapPosition({ latitude: 0, longitude: 0 })).toEqual(
      { left: 50, top: 50 },
    );
  });

  it("places Arizona using Mercator latitude instead of linear latitude", () => {
    const position = projectActiveUserMapPosition({
      latitude: 34.05,
      longitude: -111.09,
    });
    expect(position.left).toBeCloseTo(19.14, 1);
    expect(position.top).toBeCloseTo(39.9, 1);
  });

  it("clamps polar coordinates to finite map edges", () => {
    expect(
      projectActiveUserMapPosition({ latitude: 90, longitude: 180 }),
    ).toEqual({ left: 100, top: expect.any(Number) });
    expect(
      projectActiveUserMapPosition({ latitude: 90, longitude: 180 }).top,
    ).toBeCloseTo(0, 5);
  });
});
