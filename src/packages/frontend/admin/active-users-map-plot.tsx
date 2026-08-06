/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { ActiveUserMapCountry } from "@cocalc/conat/hub/api/system";
import { Tooltip } from "@cocalc/frontend/components";
import { COLORS } from "@cocalc/util/theme";
import { ACTIVE_USERS_MAP_COUNTRY_LABELS } from "./active-users-map-country-labels";
import {
  ACTIVE_USERS_MAP_ASSET_URL,
  projectActiveUserMapPosition,
} from "./active-users-map-geometry";

export function activeUsersMapCountryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function bubbleSize(count: number): number {
  return Math.min(52, Math.max(18, 14 + Math.sqrt(count) * 8));
}

export function activeUsersMapCountryPosition(country: ActiveUserMapCountry): {
  left: number;
  top: number;
} {
  const [longitude, latitude] = ACTIVE_USERS_MAP_COUNTRY_LABELS[
    country.country_code
  ] ?? [country.longitude, country.latitude];
  return projectActiveUserMapPosition({ latitude, longitude });
}

export function ActiveUsersMapPlot({
  countries,
  selectedCountryCode,
  onSelect,
}: {
  countries: ActiveUserMapCountry[];
  selectedCountryCode?: string;
  onSelect: (countryCode: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="World map of active users"
      style={{
        aspectRatio: "2 / 1",
        background: COLORS.BLUE_LLL,
        borderRadius: 8,
        overflow: "hidden",
        position: "relative",
        width: "100%",
      }}
    >
      <img
        alt=""
        aria-hidden="true"
        src={ACTIVE_USERS_MAP_ASSET_URL}
        style={{
          height: "100%",
          inset: 0,
          position: "absolute",
          width: "100%",
        }}
      />
      {countries.map((country) => {
        const size = bubbleSize(country.count);
        const name = activeUsersMapCountryName(country.country_code);
        const selected = selectedCountryCode === country.country_code;
        const label = `${name}: ${country.count} active user${country.count === 1 ? "" : "s"}`;
        const position = activeUsersMapCountryPosition(country);
        return (
          <Tooltip key={country.country_code} title={label}>
            <button
              aria-label={label}
              aria-pressed={selected}
              onClick={() => onSelect(country.country_code)}
              style={{
                alignItems: "center",
                background: selected ? COLORS.BLUE_D : COLORS.BLUE_L,
                border: `2px solid ${COLORS.BLUE_D}`,
                borderRadius: "50%",
                boxShadow: selected ? `0 0 0 4px ${COLORS.BLUE_L}` : undefined,
                color: selected ? COLORS.GRAY_LLL : COLORS.BLUE_D,
                cursor: "pointer",
                display: "flex",
                fontSize: Math.min(14, Math.max(10, size / 3)),
                fontWeight: 700,
                height: size,
                justifyContent: "center",
                left: `${position.left}%`,
                padding: 0,
                position: "absolute",
                top: `${position.top}%`,
                transform: "translate(-50%, -50%)",
                width: size,
              }}
              type="button"
            >
              {country.count}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
