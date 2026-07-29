/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { createInterBayAccountDirectoryClient } from "@cocalc/conat/inter-bay/api";
import {
  getEmailAuthChallengeStatusDirect,
  redeemEmailAuthCodeDirect,
  redeemEmailAuthLinkDirect,
  resendEmailAuthChallengeDirect,
  startEmailAuthChallengeDirect,
} from "@cocalc/server/auth/email/challenge-store";
import type {
  GetEmailAuthChallengeStatusOptions,
  RedeemEmailAuthCodeOptions,
  RedeemEmailAuthLinkOptions,
  ResendEmailAuthChallengeOptions,
  StartEmailAuthChallengeOptions,
} from "@cocalc/server/auth/email/types";
import {
  getConfiguredClusterRole,
  isMultiBayCluster,
} from "@cocalc/server/cluster-config";
import { getInterBayFabricClient } from "@cocalc/server/inter-bay/fabric";

function useDirectSeedAuthority(): boolean {
  return !isMultiBayCluster() || getConfiguredClusterRole() === "seed";
}

function seedClient() {
  return createInterBayAccountDirectoryClient({
    client: getInterBayFabricClient(),
  });
}

export async function startEmailAuthChallenge(
  opts: StartEmailAuthChallengeOptions,
) {
  return useDirectSeedAuthority()
    ? await startEmailAuthChallengeDirect(opts)
    : await seedClient().startEmailAuthChallenge(opts);
}

export async function getEmailAuthChallengeStatus(
  opts: GetEmailAuthChallengeStatusOptions,
) {
  return useDirectSeedAuthority()
    ? await getEmailAuthChallengeStatusDirect(opts)
    : await seedClient().getEmailAuthChallengeStatus(opts);
}

export async function resendEmailAuthChallenge(
  opts: ResendEmailAuthChallengeOptions,
) {
  return useDirectSeedAuthority()
    ? await resendEmailAuthChallengeDirect(opts)
    : await seedClient().resendEmailAuthChallenge(opts);
}

export async function redeemEmailAuthCode(opts: RedeemEmailAuthCodeOptions) {
  return useDirectSeedAuthority()
    ? await redeemEmailAuthCodeDirect(opts)
    : await seedClient().redeemEmailAuthCode(opts);
}

export async function redeemEmailAuthLink(opts: RedeemEmailAuthLinkOptions) {
  return useDirectSeedAuthority()
    ? await redeemEmailAuthLinkDirect(opts)
    : await seedClient().redeemEmailAuthLink(opts);
}
