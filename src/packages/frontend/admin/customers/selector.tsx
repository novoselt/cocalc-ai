/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { Select } from "antd";
import { useEffect, useRef, useState } from "react";

import { webapp_client } from "@cocalc/frontend/webapp-client";
import type {
  CrmOpportunity,
  CrmOrganizationSummary,
  CrmPerson,
} from "@cocalc/util/crm";

export function CustomerSelector({
  disabled,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange?: (value?: string) => void;
  value?: string;
}) {
  const [options, setOptions] = useState<CrmOrganizationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const run = useRef(0);

  async function search(query: string) {
    const id = ++run.current;
    setLoading(true);
    try {
      const result =
        await webapp_client.conat_client.hub.adminCrm.searchOrganizations({
          query,
          reason: "Search CRM customer selector",
          limit: 20,
        });
      if (id === run.current) setOptions(result.organizations);
    } finally {
      if (id === run.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (value) void search(value);
  }, [value]);

  return (
    <Select
      allowClear
      aria-label="Customer organization"
      disabled={disabled}
      filterOption={false}
      loading={loading}
      onChange={onChange}
      onSearch={(query) => void search(query)}
      options={options.map((organization) => ({
        label: `${organization.display_name} · ${organization.customer_number}`,
        value: organization.id,
      }))}
      placeholder="Search name, customer number, or domain"
      showSearch
      style={{ width: "100%" }}
      value={value || undefined}
    />
  );
}

export function PersonSelector({
  disabled,
  onChange,
  onSelectPerson,
  organization,
  value,
}: {
  disabled?: boolean;
  onChange?: (value?: string) => void;
  onSelectPerson?: (person?: CrmPerson) => void;
  organization?: string;
  value?: string;
}) {
  const [options, setOptions] = useState<CrmPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const run = useRef(0);

  async function search(query: string) {
    const id = ++run.current;
    setLoading(true);
    try {
      const result = await webapp_client.conat_client.hub.adminCrm.searchPeople(
        {
          organization,
          search: query,
          reason: "Search CRM contact selector",
          limit: 20,
        },
      );
      if (id === run.current) setOptions(result.people);
    } finally {
      if (id === run.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (value) void search(value);
  }, [organization, value]);

  return (
    <Select
      allowClear
      aria-label="CRM contact"
      disabled={disabled}
      filterOption={false}
      loading={loading}
      onChange={(next) => {
        onChange?.(next);
        onSelectPerson?.(options.find(({ id }) => id === next));
      }}
      onSearch={(query) => void search(query)}
      options={options.map((person) => {
        const primaryEmail =
          person.emails.find(({ is_primary }) => is_primary)?.email_address ??
          person.emails[0]?.email_address;
        return {
          label: [person.display_name, primaryEmail]
            .filter(Boolean)
            .join(" · "),
          value: person.id,
        };
      })}
      placeholder="Search reviewed customer contacts"
      showSearch
      style={{ width: "100%" }}
      value={value || undefined}
    />
  );
}

export function OpportunitySelector({
  disabled,
  onChange,
  organization,
  value,
}: {
  disabled?: boolean;
  onChange?: (value?: string) => void;
  organization?: string;
  value?: string;
}) {
  const [options, setOptions] = useState<CrmOpportunity[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!organization) {
      setOptions([]);
      return;
    }
    setLoading(true);
    void webapp_client.conat_client.hub.adminCrm
      .listOpportunities({
        organization,
        reason: "List CRM opportunities for selector",
        limit: 50,
      })
      .then((result) => {
        if (!cancelled) setOptions(result.opportunities);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organization]);

  return (
    <Select
      allowClear
      aria-label="CRM opportunity"
      disabled={disabled || !organization}
      loading={loading}
      onChange={onChange}
      options={options.map((opportunity) => ({
        label: `${opportunity.name} · ${opportunity.stage.replace(/_/g, " ")}`,
        value: opportunity.id,
      }))}
      placeholder={
        organization
          ? "Select a customer opportunity"
          : "Select an organization first"
      }
      showSearch
      style={{ width: "100%" }}
      value={value || undefined}
    />
  );
}
