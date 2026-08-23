/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Flex, Select, Spin, Typography } from "antd";
import { useEffect, useRef, useState } from "react";

import { webapp_client } from "@cocalc/frontend/webapp-client";
import { displayNameFromAccount } from "@cocalc/util/accounts/display-name";
import type { UserSearchResult } from "@cocalc/util/db-schema/accounts";

const { Text } = Typography;

function accountLabel(account: UserSearchResult) {
  const name = displayNameFromAccount(account) || account.account_id;
  return (
    <Flex vertical>
      <Text strong>{name}</Text>
      {account.email_address ? (
        <Text type="secondary">{account.email_address}</Text>
      ) : null}
    </Flex>
  );
}

function mergeAccounts(
  current: UserSearchResult[],
  incoming: UserSearchResult[],
): UserSearchResult[] {
  const accounts = new Map(
    current.map((account) => [account.account_id, account]),
  );
  for (const account of incoming) accounts.set(account.account_id, account);
  return [...accounts.values()];
}

export function AccountSelector({
  accountKind,
  disabled,
  onChange,
  value,
}: {
  accountKind: "admin" | "customer";
  disabled?: boolean;
  onChange?: (value?: string) => void;
  value?: string;
}) {
  const [accounts, setAccounts] = useState<UserSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const searchRunRef = useRef(0);

  useEffect(() => {
    if (accountKind !== "admin") return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void webapp_client.conat_client.hub.commercialOrders
      .listAssignees({ reason: "List eligible receivables assignees" })
      .then((results) => {
        if (!cancelled) setAccounts(results);
      })
      .catch((err) => {
        if (!cancelled) setError(`${err}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accountKind]);

  useEffect(() => {
    if (!value) return;
    let cancelled = false;
    void webapp_client.users_client
      .user_search({ query: value, admin: true, limit: 1 })
      .then((results) => {
        if (!cancelled) {
          setAccounts((current) => mergeAccounts(current, results));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [accountKind, value]);

  async function searchCustomers(query: string) {
    if (accountKind !== "customer") return;
    const trimmed = query.trim();
    const run = ++searchRunRef.current;
    if (trimmed.length < 2) {
      setAccounts((current) =>
        value ? current.filter((account) => account.account_id === value) : [],
      );
      return;
    }
    setLoading(true);
    setError("");
    try {
      const results = await webapp_client.users_client.user_search({
        query: trimmed,
        admin: true,
        limit: 20,
      });
      if (run === searchRunRef.current) {
        setAccounts((current) => {
          const selected = value
            ? current.filter((account) => account.account_id === value)
            : [];
          return mergeAccounts(selected, results);
        });
      }
    } catch (err) {
      if (run === searchRunRef.current) setError(`${err}`);
    } finally {
      if (run === searchRunRef.current) setLoading(false);
    }
  }

  return (
    <Flex vertical gap="small">
      <Select
        allowClear
        aria-label={
          accountKind === "admin" ? "Assignee" : "Customer CoCalc account"
        }
        disabled={disabled}
        filterOption={
          accountKind === "admin"
            ? (input, option) =>
                `${option?.searchText ?? ""}`.includes(
                  input.trim().toLowerCase(),
                )
            : false
        }
        loading={loading}
        notFoundContent={
          loading ? (
            <Spin size="small" />
          ) : accountKind === "customer" ? (
            "Type at least two characters to search"
          ) : (
            "No admin account found"
          )
        }
        onChange={onChange}
        onSearch={(query) => void searchCustomers(query)}
        optionLabelProp="label"
        options={accounts.map((account) => ({
          label: accountLabel(account),
          searchText: [
            displayNameFromAccount(account),
            account.email_address,
            account.account_id,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
          value: account.account_id,
        }))}
        placeholder={
          accountKind === "admin"
            ? "Select a CoCalc admin"
            : "Search by name, email, or account ID"
        }
        showSearch
        style={{ width: "100%" }}
        value={value || undefined}
      />
      {error ? (
        <Text type="danger">
          Accounts could not be loaded. Retry by reopening this form.
        </Text>
      ) : null}
    </Flex>
  );
}
