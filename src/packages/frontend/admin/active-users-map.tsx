/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  List,
  Row,
  Segmented,
  Space,
  Spin,
  Statistic,
  Tag,
  Typography,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ActiveUserMapOverview,
  ActiveUserMapUser,
  ActiveUserMapWindowMinutes,
} from "@cocalc/conat/hub/api/system";
import { displayNameFromAccount } from "@cocalc/util/accounts/display-name";
import { Icon, TimeAgo } from "@cocalc/frontend/components";
import ShowError from "@cocalc/frontend/components/error";
import {
  user_search,
  type User,
} from "@cocalc/frontend/frame-editors/generic/client";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import { UserResult } from "./users/user";
import {
  activeUsersMapCountryName,
  ActiveUsersMapPlot,
} from "./active-users-map-plot";

const { Paragraph, Text } = Typography;
const REFRESH_MS = 60_000;
const DRAWER_WIDTH_STORAGE_KEY = "cocalc:admin:activeUsersMapDrawerWidth";
const DEFAULT_DRAWER_WIDTH = "70%";
const MIN_DRAWER_WIDTH = 560;

function clampDrawerWidth(width: number): number {
  if (typeof window === "undefined") return Math.max(MIN_DRAWER_WIDTH, width);
  const maximum = Math.max(320, window.innerWidth - 48);
  const minimum = Math.min(MIN_DRAWER_WIDTH, maximum);
  return Math.min(maximum, Math.max(minimum, width));
}

function readDrawerWidth(): number | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value = Number(window.localStorage.getItem(DRAWER_WIDTH_STORAGE_KEY));
    return Number.isFinite(value) && value > 0
      ? clampDrawerWidth(value)
      : undefined;
  } catch {
    return undefined;
  }
}

function persistDrawerWidth(width: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    DRAWER_WIDTH_STORAGE_KEY,
    `${clampDrawerWidth(width)}`,
  );
}

const WINDOW_OPTIONS: Array<{
  label: string;
  value: ActiveUserMapWindowMinutes;
}> = [
  { label: "5 min", value: 5 },
  { label: "15 min", value: 15 },
  { label: "1 hour", value: 60 },
  { label: "1 day", value: 1440 },
];

function userName(user: ActiveUserMapUser): string {
  return displayNameFromAccount(user) || user.email_address || user.account_id;
}

function locationLabel(user: ActiveUserMapUser): string {
  return [user.city, user.region_code ?? user.region]
    .filter(Boolean)
    .join(", ");
}

function UserList({
  users,
  onSelect,
}: {
  users: ActiveUserMapUser[];
  onSelect: (user: ActiveUserMapUser) => void;
}) {
  return (
    <List
      dataSource={users}
      locale={{ emptyText: "No users in this group." }}
      renderItem={(user) => (
        <List.Item
          actions={[
            <Button key="details" size="small" onClick={() => onSelect(user)}>
              Admin details
            </Button>,
          ]}
        >
          <List.Item.Meta
            title={userName(user)}
            description={
              <Space size="small" wrap>
                {user.email_address && (
                  <Text copyable>{user.email_address}</Text>
                )}
                {locationLabel(user) && <Tag>{locationLabel(user)}</Tag>}
                <Tag>Bay: {user.bay_id}</Tag>
                <Text type="secondary">
                  Active <TimeAgo date={user.last_active} />
                </Text>
              </Space>
            }
          />
        </List.Item>
      )}
    />
  );
}

export function ActiveUsersMapAdmin() {
  const [activeMinutes, setActiveMinutes] =
    useState<ActiveUserMapWindowMinutes>(15);
  const [overview, setOverview] = useState<ActiveUserMapOverview>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [selectedGroup, setSelectedGroup] = useState<string>();
  const [selectedUser, setSelectedUser] = useState<User>();
  const [loadingUser, setLoadingUser] = useState(false);
  const [drawerWidth, setDrawerWidth] = useState<number | undefined>(
    readDrawerWidth,
  );
  const requestInFlight = useRef(false);

  const load = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setLoading(true);
    setError(undefined);
    try {
      const next = await webapp_client.conat_client.hub.system.getActiveUserMap(
        {
          active_minutes: activeMinutes,
        },
      );
      setOverview(next);
    } catch (err) {
      setError(`${err}`);
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }, [activeMinutes]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) {
        void load();
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const selectedCountry = overview?.countries.find(
    (country) => country.country_code === selectedGroup,
  );
  const selectedUsers =
    selectedGroup === "unknown"
      ? (overview?.unknown_users ?? [])
      : (selectedCountry?.users ?? []);

  async function openUser(user: ActiveUserMapUser) {
    setLoadingUser(true);
    setSelectedUser(undefined);
    try {
      const result = await user_search({
        query: user.account_id,
        admin: true,
        limit: 1,
      });
      setSelectedUser(result?.[0]);
    } catch (err) {
      setError(`${err}`);
    } finally {
      setLoadingUser(false);
    }
  }

  const drawerTitle =
    selectedGroup === "unknown"
      ? "Location unavailable"
      : selectedCountry
        ? `${activeUsersMapCountryName(selectedCountry.country_code)} (${selectedCountry.count})`
        : "Active users";
  const failedBays = overview?.bays.filter(({ ok }) => !ok) ?? [];
  const disabledBays =
    overview?.bays.filter(({ ok, enabled }) => ok && enabled === false) ?? [];
  const responsiveBays = overview?.bays.filter(({ ok }) => ok).length ?? 0;
  const incompleteMapReasons = [
    failedBays.length
      ? `Unavailable: ${failedBays.map(({ bay_id }) => bay_id).join(", ")}.`
      : "",
    disabledBays.length
      ? `Collection disabled: ${disabledBays
          .map(({ bay_id }) => bay_id)
          .join(", ")}.`
      : "",
  ].filter(Boolean);

  return (
    <Space vertical size={16} style={{ width: "100%" }}>
      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Accounts across registered bays whose <code>last_active</code> changed
        during the selected window. Locations are approximate, short-lived
        Cloudflare observations; no IP address or account-linked location
        history is stored. Country-level history includes only accounts that
        enabled Usage metrics and is retained for up to 24 months.
      </Paragraph>
      <Space wrap>
        <Segmented
          value={activeMinutes}
          options={WINDOW_OPTIONS}
          onChange={(value) => {
            setSelectedGroup(undefined);
            setSelectedUser(undefined);
            setActiveMinutes(value as ActiveUserMapWindowMinutes);
          }}
        />
        <Button
          icon={<Icon name="refresh" />}
          loading={loading}
          onClick={() => void load()}
        >
          Refresh
        </Button>
        {overview && (
          <Text type="secondary">
            Checked <TimeAgo date={overview.checked_at} /> · Current bay{" "}
            {overview.current_bay_id} · Bays {responsiveBays}/
            {overview.bays.length}
          </Text>
        )}
      </Space>
      {error && <ShowError error={error} setError={setError} />}
      {incompleteMapReasons.length > 0 && overview?.enabled ? (
        <Alert
          showIcon
          type="warning"
          title="The active-users map is incomplete"
          description={incompleteMapReasons.join(" ")}
        />
      ) : null}
      {overview && !overview.enabled ? (
        <Alert
          showIcon
          type="info"
          title="Active users map is disabled"
          description="Enable Active Users Map in Admin → Site Settings after verifying Cloudflare visitor-location headers."
        />
      ) : null}
      {overview?.enabled ? (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Card size="small">
                <Statistic title="Active users" value={overview.total_active} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small">
                <Statistic title="Mapped" value={overview.mapped_active} />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card
                size="small"
                hoverable={overview.unknown_location > 0}
                onClick={() =>
                  overview.unknown_location > 0 && setSelectedGroup("unknown")
                }
              >
                <Statistic
                  title="Location unavailable"
                  value={overview.unknown_location}
                />
              </Card>
            </Col>
          </Row>
          <ActiveUsersMapPlot
            countries={overview.countries}
            selectedCountryCode={selectedCountry?.country_code}
            onSelect={setSelectedGroup}
          />
        </>
      ) : loading && !overview ? (
        <div style={{ padding: 48, textAlign: "center" }}>
          <Spin />
        </div>
      ) : null}
      <Drawer
        open={selectedGroup != null}
        placement="right"
        size={drawerWidth ?? DEFAULT_DRAWER_WIDTH}
        resizable={{
          onResize: (width) => {
            const next = clampDrawerWidth(width);
            setDrawerWidth(next);
            try {
              persistDrawerWidth(next);
            } catch {
              // Resizing still works when localStorage is unavailable.
            }
          },
        }}
        title={drawerTitle}
        onClose={() => {
          setSelectedGroup(undefined);
          setSelectedUser(undefined);
        }}
      >
        <UserList
          users={selectedUsers}
          onSelect={(user) => void openUser(user)}
        />
        {loadingUser && (
          <div style={{ padding: 24, textAlign: "center" }}>
            <Spin />
          </div>
        )}
        {selectedUser && <UserResult {...selectedUser} />}
      </Drawer>
    </Space>
  );
}
