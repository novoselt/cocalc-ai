/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { MembershipAllocationChannel } from "@cocalc/conat/hub/api/purchases";

export const MEMBERSHIP_CHANNEL_OPTIONS: ReadonlyArray<{
  label: string;
  value: MembershipAllocationChannel;
}> = [
  { value: "personal", label: "Personal" },
  { value: "direct-student", label: "Student-pay" },
  { value: "course", label: "Course packages" },
  { value: "team", label: "Team license" },
  { value: "site", label: "Site license" },
];

export const ALL_MEMBERSHIP_CHANNELS = MEMBERSHIP_CHANNEL_OPTIONS.map(
  ({ value }) => value,
);

export function membershipChannelLabel(
  channel: MembershipAllocationChannel,
): string {
  return (
    MEMBERSHIP_CHANNEL_OPTIONS.find(({ value }) => value === channel)?.label ??
    channel
  );
}

export function membershipChannelOrder(
  channel: MembershipAllocationChannel,
): number {
  return ALL_MEMBERSHIP_CHANNELS.indexOf(channel);
}
