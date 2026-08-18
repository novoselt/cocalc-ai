/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/**
 * AvatarStack - Displays a row of overlapping avatar circles.
 *
 * Shows at most `maxAvatars` avatars; the rest collapse into a `+N` bubble
 * whose tooltip lists up to `maxNamesTooltip` of the remaining names.
 *
 * This is the shared presentation used both for project collaborators (see
 * `@cocalc/frontend/projects/collaborators-avatars`) and for the users
 * currently viewing/editing a document (see `./users-viewing`).
 *
 * The container is a flexbox with `alignItems: "center"`.  That matters: a
 * bare row of `Avatar` elements is a row of inline-blocks, which the browser
 * aligns on their baselines.  An avatar showing a profile image and one
 * showing a letter have different baselines, so they end up vertically
 * offset -- https://github.com/sagemathinc/cocalc-ai/issues/126
 */

import { useMemo } from "react";

import { CSS, useTypedRedux } from "@cocalc/frontend/app-framework";
import { Popover } from "antd";
import { DEFAULT_COLOR } from "@cocalc/frontend/users/store";
import { displayNameFromAccount } from "@cocalc/util/accounts/display-name";
import { Avatar } from "./avatar";

// Keep this in sync across all avatar stacks so the UI is consistent.
export const DEFAULT_MAX_AVATARS = 5;
export const DEFAULT_MAX_NAMES_TOOLTIP = 20;

// How far each avatar overlaps the previous one.
const OVERLAP_PX = 10;

const AVATARS_CONTAINER_STYLE: CSS = {
  display: "flex",
  flexDirection: "row",
  alignItems: "center",
} as const;

const AVATAR_WRAPPER_STYLE: CSS = {
  display: "inline-block",
  marginLeft: `-${OVERLAP_PX}px`,
  border: "2px solid white",
  borderRadius: "50%",
  lineHeight: 0,
} as const;

const FIRST_AVATAR_STYLE: CSS = {
  ...AVATAR_WRAPPER_STYLE,
  marginLeft: 0,
} as const;

// Activity of a user on a document, used to fade the avatar out over time and
// to make clicking it jump to what that user is doing.
export interface AvatarActivity {
  project_id: string;
  path: string;
  last_used: Date;
}

export interface AvatarStackEntry {
  account_id: string;
  activity?: AvatarActivity;
}

interface Props {
  // Already ordered, and already filtered to exclude the current user.
  entries: AvatarStackEntry[];
  size?: number;
  maxAvatars?: number;
  maxNamesTooltip?: number;
  // Forwarded to each Avatar; only relevant when entries carry activity.
  max_age_s?: number;
  project_id?: string;
  path?: string;
  style?: CSS;
}

export function AvatarStack({
  entries,
  size = 24,
  maxAvatars = DEFAULT_MAX_AVATARS,
  maxNamesTooltip = DEFAULT_MAX_NAMES_TOOLTIP,
  max_age_s,
  project_id,
  path,
  style,
}: Props) {
  const user_map = useTypedRedux("users", "user_map");

  const displayed = entries.slice(0, maxAvatars);
  const overflow = entries.length - maxAvatars;

  // Names of the collapsed users, for the +N tooltip.
  const remainingNames = useMemo(() => {
    if (!user_map || overflow <= 0) return [];

    return entries
      .slice(maxAvatars, maxAvatars + maxNamesTooltip)
      .map(({ account_id }) => {
        const user = user_map.get(account_id);
        if (!user) return "Unknown";

        return (
          displayNameFromAccount({
            display_name: user.get("display_name"),
            first_name: user.get("first_name"),
            last_name: user.get("last_name"),
          }) ||
          user.get("email_address") ||
          "Unknown"
        );
      });
  }, [entries, user_map, maxAvatars, maxNamesTooltip, overflow]);

  // The tooltip is pointer-only (antd disables it by default on touch), so the
  // hidden names also go into the accessible name of the +N control.
  const overflowLabel = useMemo(() => {
    if (overflow <= 0) return "";
    const shown = remainingNames.join(", ");
    const unnamed = overflow - remainingNames.length;
    const suffix = unnamed > 0 ? `, and ${unnamed} more` : "";
    return shown ? `${overflow} more: ${shown}${suffix}` : `${overflow} more`;
  }, [overflow, remainingNames]);

  if (displayed.length === 0) {
    return null;
  }

  const remainingList =
    remainingNames.length > 0 ? (
      <div>
        {remainingNames.map((name, idx) => (
          <div key={idx}>{name}</div>
        ))}
        {overflow > maxNamesTooltip && (
          <div>
            <i>...and {overflow - maxNamesTooltip} more</i>
          </div>
        )}
      </div>
    ) : null;

  return (
    <div
      style={
        style
          ? { ...AVATARS_CONTAINER_STYLE, ...style }
          : AVATARS_CONTAINER_STYLE
      }
    >
      {displayed.map(({ account_id, activity }, idx) => (
        <div
          key={account_id}
          style={idx === 0 ? FIRST_AVATAR_STYLE : AVATAR_WRAPPER_STYLE}
        >
          <Avatar
            account_id={account_id}
            size={size}
            activity={activity}
            max_age_s={max_age_s}
            project_id={project_id}
            path={path}
          />
        </div>
      ))}
      {overflow > 0 && (
        <Popover
          content={remainingList ?? overflowLabel}
          placement="top"
          trigger={["hover", "click"]}
        >
          {/* A button rather than a div, and a Popover rather than the shared
              Tooltip.  The hidden names are content, not a hint: the shared
              Tooltip removes itself entirely on touch devices and whenever the
              `hide_button_tooltips` account setting is on, which would leave
              no way at all to see them.  A button also makes this keyboard
              reachable, and Enter/Space on it fires the click trigger. */}
          <button
            type="button"
            aria-label={overflowLabel}
            style={{
              ...AVATAR_WRAPPER_STYLE,
              padding: 0,
              color: "inherit",
              width: size + 4,
              height: size + 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: DEFAULT_COLOR,
              fontSize: "14px",
              fontWeight: "bold",
            }}
          >
            +{overflow}
          </button>
        </Popover>
      )}
    </div>
  );
}
