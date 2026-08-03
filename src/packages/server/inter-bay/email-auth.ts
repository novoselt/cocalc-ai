/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { createInterBayAccountDirectoryClient } from "@cocalc/conat/inter-bay/api";
import {
  completeEmailAuthMfaDirect,
  completeEmailFreshAuthDirect,
  consumeEmailAuthExchangeDirect,
  getEmailAuthChallengeStatusDirect,
  prepareEmailAuthExchangeDirect,
  redeemEmailAuthCodeDirect,
  redeemEmailAuthLinkDirect,
  resendEmailAuthChallengeDirect,
  startEmailAuthChallengeDirect,
} from "@cocalc/server/auth/email/challenge-store";
import type {
  CompleteEmailAuthMfaOptions,
  CompleteEmailFreshAuthOptions,
  GetEmailAuthChallengeStatusOptions,
  ConsumeEmailAuthExchangeOptions,
  PrepareEmailAuthExchangeOptions,
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

export async function prepareEmailAuthExchange(
  opts: PrepareEmailAuthExchangeOptions,
) {
  return useDirectSeedAuthority()
    ? await prepareEmailAuthExchangeDirect(opts)
    : await seedClient().prepareEmailAuthExchange(opts);
}

export async function consumeEmailAuthExchange(
  opts: ConsumeEmailAuthExchangeOptions,
) {
  return useDirectSeedAuthority()
    ? await consumeEmailAuthExchangeDirect(opts)
    : await seedClient().consumeEmailAuthExchange(opts);
}

export async function completeEmailAuthMfa(
  opts: CompleteEmailAuthMfaOptions,
): Promise<void> {
  return useDirectSeedAuthority()
    ? await completeEmailAuthMfaDirect(opts)
    : await seedClient().completeEmailAuthMfa(opts);
}

export async function completeEmailFreshAuth(
  opts: CompleteEmailFreshAuthOptions,
) {
  return useDirectSeedAuthority()
    ? await completeEmailFreshAuthDirect(opts)
    : await seedClient().completeEmailFreshAuth(opts);
}
