/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Alert, Button, Space, Typography } from "antd";
import { useEffect, useRef, useState } from "react";

import {
  accountFeedStreamName,
  type AccountFeedCliAuthChallengeSummary,
  type AccountFeedEvent,
} from "@cocalc/conat/hub/api/account-feed";
import { useTypedRedux } from "@cocalc/frontend/app-framework";
import { postAuthApi } from "@cocalc/frontend/auth/api";
import { getSharedAccountDStream } from "@cocalc/frontend/conat/account-dstream";

const { Text } = Typography;

type PendingCliFreshAuthChallenge = AccountFeedCliAuthChallengeSummary;

async function loadPendingChallenges(): Promise<
  PendingCliFreshAuthChallenge[]
> {
  const response = await postAuthApi<{
    challenges: PendingCliFreshAuthChallenge[];
  }>({
    endpoint: "auth/cli/pending",
    body: {},
  });
  return Array.isArray(response.challenges) ? response.challenges : [];
}

function requestedDurationLabel(
  challenge: PendingCliFreshAuthChallenge,
): string {
  return challenge.requested_duration === "extended"
    ? "up to 8 hours"
    : "up to 15 minutes";
}

export function CliFreshAuthBannerForAccount({
  accountId,
}: {
  accountId: string;
}) {
  const [challenges, setChallenges] = useState<PendingCliFreshAuthChallenge[]>(
    [],
  );
  const eventRevision = useRef(0);

  useEffect(() => {
    let disposed = false;
    let feed:
      | Awaited<ReturnType<typeof getSharedAccountDStream<AccountFeedEvent>>>
      | undefined;

    const load = async () => {
      const revision = eventRevision.current;
      try {
        const next = await loadPendingChallenges();
        if (!disposed && revision === eventRevision.current) {
          setChallenges(next);
        }
      } catch {
        // The CLI prints the approval URL, so this account-wide notice is a
        // discoverability enhancement rather than part of the auth protocol.
      }
    };
    const handleFeedChange = (event?: AccountFeedEvent) => {
      if (event?.type !== "cli.auth.changed") return;
      eventRevision.current += 1;
      setChallenges((current) => {
        const withoutChanged = current.filter(
          ({ challenge_id }) => challenge_id !== event.challenge_id,
        );
        if (!event.pending || event.challenge == null) return withoutChanged;
        return [event.challenge, ...withoutChanged];
      });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void load();
    };

    void getSharedAccountDStream<AccountFeedEvent>({
      account_id: accountId,
      name: accountFeedStreamName(),
      ephemeral: true,
      maxListeners: 100,
    }).then(
      (nextFeed) => {
        if (disposed) return;
        feed = nextFeed;
        feed.on("change", handleFeedChange);
      },
      () => undefined,
    );
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void load();

    return () => {
      disposed = true;
      feed?.removeListener("change", handleFeedChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [accountId]);

  useEffect(() => {
    if (challenges.length === 0) return;
    const nextExpiration = Math.min(
      ...challenges.map(({ expires_at }) => new Date(expires_at).valueOf()),
    );
    const timeout = window.setTimeout(
      () => {
        const now = Date.now();
        setChallenges((current) =>
          current.filter(
            ({ expires_at }) => new Date(expires_at).valueOf() > now,
          ),
        );
      },
      Math.max(0, nextExpiration - Date.now() + 100),
    );
    return () => window.clearTimeout(timeout);
  }, [challenges]);

  if (challenges.length === 0) return null;

  return (
    <div aria-live="assertive">
      <Alert
        banner
        showIcon
        type="warning"
        title={
          challenges.length === 1
            ? "CoCalc CLI requests fresh authentication"
            : `${challenges.length} CoCalc CLI sessions request fresh authentication`
        }
        description={
          <Space orientation="vertical" size={6}>
            <Text>
              Review this account-wide request before the CLI can perform
              sensitive account operations. Approval lasts{" "}
              {requestedDurationLabel(challenges[0])}.
            </Text>
            <Space wrap>
              {challenges.map((challenge, index) => (
                <Button
                  key={challenge.challenge_id}
                  type="primary"
                  href={challenge.approval_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={
                    challenges.length === 1
                      ? "Review CLI fresh-auth request"
                      : `Review CLI fresh-auth request ${index + 1}`
                  }
                >
                  Review CLI request
                  {challenges.length > 1 ? ` ${index + 1}` : ""}
                </Button>
              ))}
            </Space>
          </Space>
        }
        style={{ marginBottom: 10 }}
      />
    </div>
  );
}

export function CliFreshAuthBanner() {
  const accountId = useTypedRedux("account", "account_id");
  const isLoggedIn = useTypedRedux("account", "is_logged_in");
  if (!isLoggedIn || !accountId) return null;
  return <CliFreshAuthBannerForAccount accountId={accountId} />;
}
