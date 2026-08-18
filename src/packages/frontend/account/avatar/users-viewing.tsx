/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { useInterval } from "react-interval-hook";
import { useEffect } from "react";

import {
  CSS,
  useMemo,
  useProjectMapField,
  useState,
  useTypedRedux,
} from "@cocalc/frontend/app-framework";
import { cmp } from "@cocalc/util/misc";
import {
  getDocumentPresenceUsers,
  subscribeToDocumentPresence,
} from "@cocalc/frontend/document-presence/service";
import {
  AvatarStack,
  DEFAULT_MAX_AVATARS,
  type AvatarActivity,
  type AvatarStackEntry,
} from "./avatar-stack";
import { isViewerProjectRole } from "@cocalc/frontend/project/realtime-access";

// How frequently all UsersViewing components are completely updated.
// This is only needed to ensure that faces fade out; any newly added faces
// will still be displayed instantly.  Also, updating more frequently updates
// the line positions in the tooltip.
const UPDATE_INTERVAL_S = 15;

// Cutoff for how recent activity must be to show users. Should be significantly
// longer than the default `mark_file` throttling window.
const MAX_AGE_S = 600;

type Activity = AvatarActivity;

function most_recent(activity: Activity[]): Activity {
  if (activity.length == 0) throw Error("must have some activity");
  let { last_used } = activity[0];
  let y = activity[0];
  for (let x of activity.slice(1)) {
    if (x.last_used >= last_used) {
      y = x;
      ({ last_used } = x);
    }
  }
  return y;
}

const USERS_VIEWING_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  overflow: "hidden",
  zIndex: 1,
  whiteSpace: "nowrap",
  padding: "1px",
  height: "32px",
} as const;

const DEFAULT_STYLE: CSS = { maxWidth: "120px" } as const;

// If neither project_id nor path given, then viewing all projects; if project_id
// given, then viewing that project; if both given, then viewing a particular file.
interface Props {
  project_id?: string; // optional -- must be given if path is specified
  path?: string; // optional -- if given, viewing a file.
  max_age_s?: number;
  size?: number;
  style?: React.CSSProperties;
  disabled?: boolean;
  maxAvatars?: number;
}

function useUsersViewing(
  project_id?: string,
  path?: string,
  max_age_s?: number,
  enabled: boolean = true,
) {
  const [counter, set_counter] = useState(0); // used to force update periodically.

  useEffect(() => {
    if (!enabled || project_id == null) {
      return;
    }
    return subscribeToDocumentPresence(project_id, () => {
      set_counter((counter) => counter + 1);
    });
  }, [enabled, project_id]);

  const users = useMemo(
    () =>
      !enabled || project_id == null
        ? undefined
        : getDocumentPresenceUsers({
            project_id,
            path,
            max_age_s,
          }),
    [counter, enabled, project_id, path, max_age_s],
  );

  useInterval(() => {
    // cause an update
    set_counter((counter) => counter + 1);
  }, UPDATE_INTERVAL_S * 1000);

  return { users };
}

export function UsersViewing(props: Readonly<Props>) {
  const {
    path,
    project_id,
    max_age_s = MAX_AGE_S,
    style = DEFAULT_STYLE,
    size = 24,
    disabled = false,
    maxAvatars = DEFAULT_MAX_AVATARS,
  } = props;

  // so we can exclude ourselves from list of faces
  const our_account_id: string | undefined = useTypedRedux(
    "account",
    "account_id",
  );
  const projectRole = useProjectMapField<string>(project_id, [
    "users",
    our_account_id ?? "",
    "group",
  ]);
  const publicDirectoryShareProjection = !!useProjectMapField<boolean>(
    project_id,
    "public_directory_share_projection",
  );
  const hasKnownProjectRole = project_id == null || projectRole != null;
  const isViewer =
    project_id != null && isViewerProjectRole(projectRole ?? undefined);
  const { users } = useUsersViewing(
    project_id,
    path,
    max_age_s,
    !disabled &&
      hasKnownProjectRole &&
      !isViewer &&
      !publicDirectoryShareProjection,
  );

  // Users with recent activity on this document, most recent first, excluding us.
  const entries: AvatarStackEntry[] = useMemo(() => {
    const v: AvatarStackEntry[] = [];
    if (users != null) {
      for (const account_id in users) {
        if (account_id === our_account_id) {
          continue; // only show other users
        }
        const activity = users[account_id];
        if (!activity || activity.length == 0) {
          continue; // shouldn't happen, but just be extra careful
        }
        v.push({ account_id, activity: most_recent(activity) });
      }
    }
    v.sort((a, b) => cmp(b.activity!.last_used, a.activity!.last_used));
    return v;
  }, [users, our_account_id]);

  if (our_account_id == null || isViewer) {
    return null;
  }

  return (
    <AvatarStack
      entries={entries}
      size={size}
      maxAvatars={maxAvatars}
      max_age_s={max_age_s}
      project_id={project_id}
      path={path}
      style={{ ...USERS_VIEWING_STYLE, ...style }}
    />
  );
}
