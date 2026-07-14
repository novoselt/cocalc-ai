/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const MAX_MERCATOR_LATITUDE = 85.05112878;

export function projectActiveUserMapPosition({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}): { left: number; top: number } {
  const clampedLatitude = Math.min(
    MAX_MERCATOR_LATITUDE,
    Math.max(-MAX_MERCATOR_LATITUDE, latitude),
  );
  const radians = (clampedLatitude * Math.PI) / 180;
  const mercator = Math.log(Math.tan(Math.PI / 4 + radians / 2));
  return {
    left: ((longitude + 180) / 360) * 100,
    top: (1 / 2 - mercator / (2 * Math.PI)) * 100,
  };
}
