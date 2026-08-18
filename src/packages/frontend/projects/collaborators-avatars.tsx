/*
 *  This file is part of CoCalc: Copyright © 2025 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/**
 * CollaboratorsAvatars - Displays overlapping avatars of project collaborators
 *
 * Shows up to 5 avatars in an overlapping style with a tooltip listing
 * up to 20 collaborator names.  The rendering itself is shared with the
 * "users viewing this document" indicator -- see `AvatarStack`.
 */

import { useMemo } from "react";

import {
  AvatarStack,
  DEFAULT_MAX_AVATARS,
  DEFAULT_MAX_NAMES_TOOLTIP,
} from "@cocalc/frontend/account/avatar/avatar-stack";

interface Props {
  collaboratorIds: string[]; // Already filtered to exclude current user
  size?: number;
  maxAvatars?: number;
  maxNamesTooltip?: number;
}

export function CollaboratorsAvatars({
  collaboratorIds,
  size = 24,
  maxAvatars = DEFAULT_MAX_AVATARS,
  maxNamesTooltip = DEFAULT_MAX_NAMES_TOOLTIP,
}: Props) {
  const entries = useMemo(
    () => collaboratorIds.map((account_id) => ({ account_id })),
    [collaboratorIds],
  );

  return (
    <AvatarStack
      entries={entries}
      size={size}
      maxAvatars={maxAvatars}
      maxNamesTooltip={maxNamesTooltip}
    />
  );
}
