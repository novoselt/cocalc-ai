/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  Alert,
  Button,
  DatePicker,
  Drawer,
  List,
  Radio,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import { CaretRightFilled, PauseOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ActiveUserMapOverview,
  ActiveUserMapUser,
  ActiveUserMapWindowMinutes,
} from "@cocalc/conat/hub/api/system";
import type {
  ActiveUserMapHistorySeries,
  ActiveUserMapHistorySnapshot,
  ActiveUserMapHistoryWindowMinutes,
} from "@cocalc/conat/inter-bay/api";
import { displayNameFromAccount } from "@cocalc/util/accounts/display-name";
import { Icon, TimeAgo } from "@cocalc/frontend/components";
import ShowError from "@cocalc/frontend/components/error";
import {
  user_search,
  type User,
} from "@cocalc/frontend/frame-editors/generic/client";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import { UserResult } from "./users/user";
import { activeUsersMapCountryName } from "./active-users-map-country";
import { ActiveUsersMapPlot } from "./active-users-map-plot";
import { ActiveUsersMapHistoryPlot } from "./active-users-map-history-plot";
import { ActiveUsersMapSummary } from "./active-users-map-summary";

const { Paragraph, Text } = Typography;
dayjs.extend(utc);
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

const HISTORY_WINDOW_OPTIONS: Array<{
  label: string;
  value: ActiveUserMapHistoryWindowMinutes;
}> = [
  { label: "1 hour", value: 60 },
  { label: "1 day", value: 1440 },
];
const SPEED_OPTIONS = [1, 2, 4, 8].map((speed) => ({
  label: `${speed}×`,
  value: speed,
}));
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  label: `${hour.toString().padStart(2, "0")}:00 UTC`,
  value: hour,
}));

type MapView = "live" | "history";
type Playback = "date" | "time";

function PlaybackIcon({ playing }: { playing: boolean }) {
  return playing ? <PauseOutlined /> : <CaretRightFilled />;
}

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
  const [view, setView] = useState<MapView>("live");
  const [liveActiveMinutes, setLiveActiveMinutes] =
    useState<ActiveUserMapWindowMinutes>(15);
  const [historyActiveMinutes, setHistoryActiveMinutes] =
    useState<ActiveUserMapHistoryWindowMinutes>(60);
  const [overview, setOverview] = useState<ActiveUserMapOverview>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [history, setHistory] = useState<ActiveUserMapHistorySeries>();
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string>();
  const [historySnapshot, setHistorySnapshot] =
    useState<ActiveUserMapHistorySnapshot>();
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string>();
  const [historyCountry, setHistoryCountry] = useState<string>();
  const [playback, setPlayback] = useState<Playback>();
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [selectedGroup, setSelectedGroup] = useState<string>();
  const [selectedUser, setSelectedUser] = useState<User>();
  const [loadingUser, setLoadingUser] = useState(false);
  const [drawerWidth, setDrawerWidth] = useState<number | undefined>(
    readDrawerWidth,
  );
  const requestInFlight = useRef(false);
  const snapshotRequest = useRef(0);
  const requestedHistorySnapshot = useRef<string | undefined>(undefined);
  const snapshotCache = useRef(
    new Map<string, ActiveUserMapHistorySnapshot | null>(),
  );
  const plotActiveMinutes: ActiveUserMapHistoryWindowMinutes =
    view === "history"
      ? historyActiveMinutes
      : liveActiveMinutes === 1440
        ? 1440
        : 60;

  const load = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setLoading(true);
    setError(undefined);
    try {
      const next = await webapp_client.conat_client.hub.system.getActiveUserMap(
        {
          active_minutes: liveActiveMinutes,
        },
      );
      setOverview(next);
    } catch (err) {
      setError(`${err}`);
    } finally {
      requestInFlight.current = false;
      setLoading(false);
    }
  }, [liveActiveMinutes]);

  useEffect(() => {
    if (view !== "live") return;
    void load();
    const timer = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) {
        void load();
      }
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, view]);

  useEffect(() => {
    let disposed = false;
    setHistoryLoading(true);
    setHistoryError(undefined);
    void (async () => {
      try {
        const next =
          await webapp_client.conat_client.hub.system.getActiveUserMapHistorySeries(
            {
              active_minutes: plotActiveMinutes,
              country_code: historyCountry,
            },
          );
        if (!disposed) setHistory(next);
      } catch (err) {
        if (!disposed) setHistoryError(`${err}`);
      } finally {
        if (!disposed) setHistoryLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [historyCountry, plotActiveMinutes]);

  const loadHistorySnapshot = useCallback(
    async ({
      activeMinutes,
      snapshotHour,
      direction = "nearest",
    }: {
      activeMinutes: ActiveUserMapHistoryWindowMinutes;
      snapshotHour?: string;
      direction?: "backward" | "forward" | "nearest";
    }): Promise<ActiveUserMapHistorySnapshot | null> => {
      const cacheKey = `${activeMinutes}:${snapshotHour ?? "latest"}:${direction}`;
      const request = ++snapshotRequest.current;
      if (snapshotHour && snapshotCache.current.has(cacheKey)) {
        const cached = snapshotCache.current.get(cacheKey) ?? null;
        if (cached) setHistorySnapshot(cached);
        setSnapshotLoading(false);
        return cached;
      }
      setSnapshotLoading(true);
      setSnapshotError(undefined);
      try {
        const next =
          await webapp_client.conat_client.hub.system.getActiveUserMapHistorySnapshot(
            {
              active_minutes: activeMinutes,
              snapshot_hour: snapshotHour,
              direction,
            },
          );
        if (next) {
          if (snapshotHour) snapshotCache.current.set(cacheKey, next);
          snapshotCache.current.set(
            `${activeMinutes}:${next.snapshot_hour}:nearest`,
            next,
          );
        }
        if (request === snapshotRequest.current && next) {
          setHistorySnapshot(next);
        }
        return next;
      } catch (err) {
        if (request === snapshotRequest.current) setSnapshotError(`${err}`);
        return null;
      } finally {
        if (request === snapshotRequest.current) setSnapshotLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (view !== "history") return;
    setPlayback(undefined);
    const snapshotHour = requestedHistorySnapshot.current;
    requestedHistorySnapshot.current = undefined;
    void loadHistorySnapshot({
      activeMinutes: historyActiveMinutes,
      snapshotHour,
    });
  }, [historyActiveMinutes, loadHistorySnapshot, view]);

  const stepHistorySnapshot = useCallback(
    async (kind: Playback, amount: -1 | 1) => {
      if (!historySnapshot) return null;
      const snapshotHour = dayjs
        .utc(historySnapshot.snapshot_hour)
        .add(amount, kind === "date" ? "day" : "hour")
        .toISOString();
      return await loadHistorySnapshot({
        activeMinutes: historyActiveMinutes,
        snapshotHour,
        direction: amount < 0 ? "backward" : "forward",
      });
    },
    [historyActiveMinutes, historySnapshot, loadHistorySnapshot],
  );

  useEffect(() => {
    if (!playback || view !== "history" || snapshotLoading) return;
    const currentSnapshotHour = historySnapshot?.snapshot_hour;
    const timer = setTimeout(() => {
      void (async () => {
        const next = await stepHistorySnapshot(playback, 1);
        if (!next || next.snapshot_hour === currentSnapshotHour) {
          setPlayback(undefined);
        }
      })();
    }, 1000 / playbackSpeed);
    return () => clearTimeout(timer);
  }, [
    historySnapshot?.snapshot_hour,
    playback,
    playbackSpeed,
    snapshotLoading,
    stepHistorySnapshot,
    view,
  ]);

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
  const historicalDate = historySnapshot
    ? dayjs.utc(historySnapshot.snapshot_hour)
    : undefined;
  const pendingHistoryFallback = snapshotLoading ? overview : undefined;
  const displaySummary =
    view === "history" ? (historySnapshot ?? pendingHistoryFallback) : overview;
  const displayCountries =
    view === "history"
      ? (historySnapshot?.countries ?? pendingHistoryFallback?.countries)
      : overview?.countries;

  function selectHistoryDate(value: Dayjs | null) {
    if (!value || !historicalDate) return;
    const snapshotHour = historicalDate
      .year(value.year())
      .month(value.month())
      .date(value.date())
      .toISOString();
    void loadHistorySnapshot({
      activeMinutes: historyActiveMinutes,
      snapshotHour,
    });
  }

  function selectHistoryHour(hour: number) {
    if (!historicalDate) return;
    void loadHistorySnapshot({
      activeMinutes: historyActiveMinutes,
      snapshotHour: historicalDate.hour(hour).toISOString(),
    });
  }

  function selectPlotSnapshot(snapshotHour: string) {
    const activeMinutes = history?.active_minutes ?? plotActiveMinutes;
    requestedHistorySnapshot.current = snapshotHour;
    setHistoryActiveMinutes(activeMinutes);
    setSelectedGroup(undefined);
    setSelectedUser(undefined);
    setView("history");
    if (view === "history" && activeMinutes === historyActiveMinutes) {
      requestedHistorySnapshot.current = undefined;
      void loadHistorySnapshot({ activeMinutes, snapshotHour });
    }
  }

  return (
    <Space vertical size={16} style={{ width: "100%" }}>
      <Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Accounts across registered bays whose <code>last_active</code> changed
        during the selected window. Locations are approximate, short-lived
        Cloudflare observations; no IP address or account-linked location
        history is stored. Country-level history includes only accounts that
        enabled Usage metrics and is retained indefinitely as aggregate data.
      </Paragraph>
      <Space wrap>
        <Radio.Group
          buttonStyle="solid"
          optionType="button"
          options={[
            { label: "Live", value: "live" },
            { label: "History", value: "history" },
          ]}
          value={view}
          onChange={({ target: { value } }) => {
            const nextView = value as MapView;
            setPlayback(undefined);
            setSelectedGroup(undefined);
            setSelectedUser(undefined);
            if (nextView === "history") {
              setSnapshotLoading(true);
            }
            setView(nextView);
          }}
        />
        <Space>
          <Text>Active within:</Text>
          <Radio.Group
            buttonStyle="solid"
            optionType="button"
            options={view === "live" ? WINDOW_OPTIONS : HISTORY_WINDOW_OPTIONS}
            value={view === "live" ? liveActiveMinutes : historyActiveMinutes}
            onChange={({ target: { value } }) => {
              setPlayback(undefined);
              if (view === "live") {
                setSelectedGroup(undefined);
                setSelectedUser(undefined);
                setLiveActiveMinutes(value as ActiveUserMapWindowMinutes);
              } else {
                requestedHistorySnapshot.current =
                  historySnapshot?.snapshot_hour;
                setSnapshotLoading(true);
                setHistoryActiveMinutes(
                  value as ActiveUserMapHistoryWindowMinutes,
                );
              }
            }}
          />
        </Space>
        {view === "history" && (
          <Space>
            <Text>Date:</Text>
            <Space.Compact>
              <Button
                aria-label="Previous day"
                disabled={!historicalDate || snapshotLoading}
                icon={<Icon name="chevron-left" />}
                onClick={() => void stepHistorySnapshot("date", -1)}
              />
              <DatePicker
                allowClear={false}
                disabled={!historicalDate || snapshotLoading}
                format="MMMM D, YYYY"
                value={historicalDate}
                onChange={selectHistoryDate}
              />
              <Button
                aria-label="Next day"
                disabled={!historicalDate || snapshotLoading}
                icon={<Icon name="chevron-right" />}
                onClick={() => void stepHistorySnapshot("date", 1)}
              />
              <Button
                aria-label={
                  playback === "date"
                    ? "Pause daily playback"
                    : "Play one day per frame"
                }
                disabled={!historicalDate}
                icon={<PlaybackIcon playing={playback === "date"} />}
                onClick={() =>
                  setPlayback((current) =>
                    current === "date" ? undefined : "date",
                  )
                }
                type={playback === "date" ? "primary" : "default"}
              />
            </Space.Compact>
          </Space>
        )}
        {view === "history" && (
          <Space>
            <Text>Time:</Text>
            <Space.Compact>
              <Button
                aria-label="Previous hour"
                disabled={!historicalDate || snapshotLoading}
                icon={<Icon name="chevron-left" />}
                onClick={() => void stepHistorySnapshot("time", -1)}
              />
              <Select
                disabled={!historicalDate || snapshotLoading}
                options={HOUR_OPTIONS}
                value={historicalDate?.hour()}
                onChange={selectHistoryHour}
                style={{ width: 120 }}
              />
              <Button
                aria-label="Next hour"
                disabled={!historicalDate || snapshotLoading}
                icon={<Icon name="chevron-right" />}
                onClick={() => void stepHistorySnapshot("time", 1)}
              />
              <Button
                aria-label={
                  playback === "time"
                    ? "Pause hourly playback"
                    : "Play one hour per frame"
                }
                disabled={!historicalDate}
                icon={<PlaybackIcon playing={playback === "time"} />}
                onClick={() =>
                  setPlayback((current) =>
                    current === "time" ? undefined : "time",
                  )
                }
                type={playback === "time" ? "primary" : "default"}
              />
            </Space.Compact>
          </Space>
        )}
        {view === "history" && (
          <Space>
            <Text>Speed:</Text>
            <Radio.Group
              buttonStyle="solid"
              optionType="button"
              options={SPEED_OPTIONS}
              value={playbackSpeed}
              onChange={({ target: { value } }) =>
                setPlaybackSpeed(Number(value))
              }
            />
          </Space>
        )}
      </Space>
      {error && <ShowError error={error} setError={setError} />}
      {snapshotError && (
        <ShowError error={snapshotError} setError={setSnapshotError} />
      )}
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
          {displaySummary ? (
            <ActiveUsersMapSummary
              total={displaySummary.total_active}
              mapped={displaySummary.mapped_active}
              usageMetricsNotEnabled={
                view === "history"
                  ? historySnapshot?.usage_metrics_not_enabled
                  : undefined
              }
              unavailable={displaySummary.unknown_location}
              onShowUnavailable={
                view === "live" ? () => setSelectedGroup("unknown") : undefined
              }
            />
          ) : snapshotLoading || loading ? (
            <div style={{ padding: 48, textAlign: "center" }}>
              <Spin />
            </div>
          ) : null}
          <ActiveUsersMapPlot
            key="active-users-map"
            countries={displayCountries ?? []}
            selectedCountryCode={
              view === "history"
                ? historyCountry
                : selectedCountry?.country_code
            }
            onSelect={view === "history" ? setHistoryCountry : setSelectedGroup}
          />
          {historyError && (
            <ShowError error={historyError} setError={setHistoryError} />
          )}
          <ActiveUsersMapHistoryPlot
            history={history}
            loading={historyLoading}
            selectedCountryCode={historyCountry}
            selectedSnapshotHour={
              view === "history" ? historySnapshot?.snapshot_hour : undefined
            }
            onCountryChange={setHistoryCountry}
            onSelectSnapshot={selectPlotSnapshot}
          />
        </>
      ) : loading && !overview ? (
        <div style={{ padding: 48, textAlign: "center" }}>
          <Spin />
        </div>
      ) : null}
      <Drawer
        open={view === "live" && selectedGroup != null}
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
