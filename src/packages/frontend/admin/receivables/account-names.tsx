/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { useEffect, useState } from "react";

import { webapp_client } from "@cocalc/frontend/webapp-client";
import { displayNameFromAccount } from "@cocalc/util/accounts/display-name";
import { formatShortId } from "./shared";

export type AccountDisplayNames = Record<string, string>;

function uniqueAccountIds(accountIds: Array<string | null | undefined>) {
  return [...new Set(accountIds.filter((id): id is string => !!id))].sort();
}

export async function loadAccountDisplayNames(
  accountIds: Array<string | null | undefined>,
): Promise<AccountDisplayNames> {
  const ids = uniqueAccountIds(accountIds);
  if (!ids.length) return {};
  const accounts = await webapp_client.users_client.getNames(ids);
  return Object.fromEntries(
    ids.map((accountId) => [
      accountId,
      displayNameFromAccount(accounts[accountId]),
    ]),
  );
}

export function useAccountDisplayNames(
  accountIds: Array<string | null | undefined>,
): AccountDisplayNames {
  const key = uniqueAccountIds(accountIds).join(",");
  const [names, setNames] = useState<AccountDisplayNames>({});

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(",") : [];
    if (!ids.length) {
      setNames({});
      return;
    }
    void loadAccountDisplayNames(ids)
      .then((next) => {
        if (!cancelled) setNames(next);
      })
      .catch(() => {
        if (!cancelled) setNames({});
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return names;
}

export function AccountIdentity({
  accountId,
  names,
  unknownLabel = "Unknown account",
}: {
  accountId?: string | null;
  names: AccountDisplayNames;
  unknownLabel?: string;
}) {
  if (!accountId) return <>{unknownLabel}</>;
  return (
    <span title={accountId}>
      {names[accountId] || formatShortId(accountId)}
    </span>
  );
}
