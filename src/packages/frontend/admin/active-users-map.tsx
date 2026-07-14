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
  Empty,
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
  ActiveUserMapCountry,
  ActiveUserMapOverview,
  ActiveUserMapUser,
  ActiveUserMapWindowMinutes,
} from "@cocalc/conat/hub/api/system";
import { displayNameFromAccount } from "@cocalc/util/accounts/display-name";
import { COLORS } from "@cocalc/util/theme";
import { Icon, TimeAgo, Tooltip } from "@cocalc/frontend/components";
import ShowError from "@cocalc/frontend/components/error";
import {
  user_search,
  type User,
} from "@cocalc/frontend/frame-editors/generic/client";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import { UserResult } from "./users/user";

const { Paragraph, Text } = Typography;
const REFRESH_MS = 60_000;

const WINDOW_OPTIONS: Array<{
  label: string;
  value: ActiveUserMapWindowMinutes;
}> = [
  { label: "5 min", value: 5 },
  { label: "15 min", value: 15 },
  { label: "1 hour", value: 60 },
  { label: "1 day", value: 1440 },
];

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function userName(user: ActiveUserMapUser): string {
  return displayNameFromAccount(user) || user.email_address || user.account_id;
}

function locationLabel(user: ActiveUserMapUser): string {
  return [user.city, user.region_code ?? user.region]
    .filter(Boolean)
    .join(", ");
}

function bubbleSize(count: number): number {
  return Math.min(52, Math.max(18, 14 + Math.sqrt(count) * 8));
}

function ActiveUsersMapPlot({
  countries,
  selectedCountryCode,
  onSelect,
}: {
  countries: ActiveUserMapCountry[];
  selectedCountryCode?: string;
  onSelect: (countryCode: string) => void;
}) {
  if (countries.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="No active users have a current mapped location."
      />
    );
  }
  return (
    <div
      role="group"
      aria-label="World map of active users"
      style={{
        aspectRatio: "2 / 1",
        background: COLORS.BLUE_LLL,
        borderRadius: 8,
        maxHeight: 520,
        minHeight: 260,
        overflow: "hidden",
        position: "relative",
        width: "100%",
      }}
    >
      <svg
        aria-hidden="true"
        preserveAspectRatio="xMidYMid meet"
        style={{
          height: "100%",
          inset: 0,
          position: "absolute",
          width: "100%",
        }}
        viewBox="0 0 1000 500"
      >
        <g fill="none" opacity="0.35" stroke={COLORS.BLUE_L} strokeWidth="1">
          {[125, 250, 375, 500, 625, 750, 875].map((x) => (
            <path d={`M${x} 0V500`} key={`longitude-${x}`} />
          ))}
          {[125, 250, 375].map((y) => (
            <path d={`M0 ${y}H1000`} key={`latitude-${y}`} />
          ))}
        </g>
        <g
          fill={COLORS.GRAY_LLL}
          stroke={COLORS.GRAY_M}
          strokeLinejoin="round"
          strokeWidth="2"
        >
          <path d="M45 92 78 61 137 50 177 69 211 65 248 91 281 122 267 150 229 164 207 194 173 204 150 229 121 215 102 184 70 163 47 132Z" />
          <path d="M263 55 302 34 343 43 354 70 326 95 286 91Z" />
          <path d="M261 218 302 223 333 255 348 298 333 346 309 399 285 455 264 416 249 361 230 320 236 270Z" />
          <path d="M456 113 484 92 522 98 542 119 531 140 498 139 476 157 447 145Z" />
          <path d="M478 157 533 148 574 175 590 223 570 276 538 334 507 319 489 278 460 234 451 190Z" />
          <path d="M527 91 574 61 637 67 676 52 730 69 773 64 824 89 888 99 929 129 912 159 866 170 832 194 782 183 753 207 714 190 678 205 647 180 609 168 584 143 548 139Z" />
          <path d="M808 294 844 276 891 288 925 320 908 356 870 370 829 350 796 321Z" />
          <path d="M931 235 944 220 956 238 947 266Z" />
          <path d="M35 468 129 456 230 465 330 454 433 467 536 456 642 467 752 455 858 466 960 453 981 487 25 487Z" />
        </g>
      </svg>
      {countries.map((country) => {
        const size = bubbleSize(country.count);
        const name = countryName(country.country_code);
        const selected = selectedCountryCode === country.country_code;
        const label = `${name}: ${country.count} active user${country.count === 1 ? "" : "s"}`;
        return (
          <Tooltip key={country.country_code} title={label}>
            <button
              aria-label={label}
              aria-pressed={selected}
              onClick={() => onSelect(country.country_code)}
              style={{
                alignItems: "center",
                background: selected ? COLORS.BLUE_D : COLORS.BLUE_L,
                border: `2px solid ${COLORS.BLUE_D}`,
                borderRadius: "50%",
                boxShadow: selected ? `0 0 0 4px ${COLORS.BLUE_L}` : undefined,
                color: selected ? COLORS.GRAY_LLL : COLORS.BLUE_D,
                cursor: "pointer",
                display: "flex",
                fontSize: Math.min(14, Math.max(10, size / 3)),
                fontWeight: 700,
                height: size,
                justifyContent: "center",
                left: `${((country.longitude + 180) / 360) * 100}%`,
                padding: 0,
                position: "absolute",
                top: `${((90 - country.latitude) / 180) * 100}%`,
                transform: "translate(-50%, -50%)",
                width: size,
              }}
              type="button"
            >
              {country.count}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
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
        ? `${countryName(selectedCountry.country_code)} (${selectedCountry.count})`
        : "Active users";

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Current-bay accounts whose <code>last_active</code> changed during the
        selected window. Locations are approximate, short-lived Cloudflare
        observations; no IP address or location history is stored.
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
            Checked <TimeAgo date={overview.checked_at} /> · Bay{" "}
            {overview.bay_id}
          </Text>
        )}
      </Space>
      {error && <ShowError error={error} setError={setError} />}
      {overview && !overview.enabled ? (
        <Alert
          showIcon
          type="info"
          message="Active users map is disabled"
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
          <Card styles={{ body: { padding: 8 } }}>
            <ActiveUsersMapPlot
              countries={overview.countries}
              selectedCountryCode={selectedCountry?.country_code}
              onSelect={setSelectedGroup}
            />
          </Card>
        </>
      ) : loading && !overview ? (
        <div style={{ padding: 48, textAlign: "center" }}>
          <Spin />
        </div>
      ) : null}
      <Drawer
        open={selectedGroup != null}
        width={720}
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
