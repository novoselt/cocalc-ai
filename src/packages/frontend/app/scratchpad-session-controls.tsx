/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Button, Popover, Space, Typography } from "antd";
import {
  React,
  redux,
  useEffect,
  useTypedRedux,
} from "@cocalc/frontend/app-framework";
import { Icon } from "@cocalc/frontend/components/icon";
import { TimeAgo } from "@cocalc/frontend/components/time-ago";
import { COLORS } from "@cocalc/util/theme";

const DARK_MODE_STORAGE_KEY = "cocalc-scratchpad-dark-mode";

function plainSettings(value: any): Record<string, unknown> {
  return value?.toJS?.() ?? value ?? {};
}

export function setScratchpadDarkMode(
  enabled: boolean,
  opts: {
    appRedux?: typeof redux;
    storage?: Pick<Storage, "setItem">;
  } = {},
): void {
  const appRedux = opts.appRedux ?? redux;
  const accountStore = appRedux.getStore("account");
  const currentSettings: any = accountStore?.get("other_settings");
  const current = plainSettings(currentSettings);
  const nextSettings =
    typeof currentSettings?.set === "function"
      ? currentSettings.set("dark_mode", enabled)
      : { ...current, dark_mode: enabled };
  appRedux.getActions("account").setState({
    other_settings: nextSettings,
  });
  try {
    (opts.storage ?? window.localStorage).setItem(
      DARK_MODE_STORAGE_KEY,
      enabled ? "1" : "0",
    );
  } catch {
    // The toggle still works for this page when browser storage is unavailable.
  }
}

function storedDarkMode(): boolean | undefined {
  try {
    const value = window.localStorage.getItem(DARK_MODE_STORAGE_KEY);
    if (value === "1") return true;
    if (value === "0") return false;
  } catch {
    // Use the account default when browser storage is unavailable.
  }
  return undefined;
}

export function ScratchpadSessionControls({
  deleteAt,
}: {
  deleteAt?: string;
}): React.JSX.Element {
  const otherSettings = useTypedRedux("account", "other_settings");
  const darkMode = !!otherSettings?.get?.("dark_mode");
  const deadline = new Date(`${deleteAt ?? ""}`);
  const validDeadline = Number.isFinite(deadline.valueOf());

  useEffect(() => {
    const stored = storedDarkMode();
    if (stored != null && stored !== darkMode) {
      setScratchpadDarkMode(stored);
    }
  }, []);

  const reminder = (
    <Space vertical size={4} style={{ maxWidth: 320 }}>
      <Typography.Text strong>Temporary scratchpad</Typography.Text>
      <Typography.Text>
        This project and all of its files will be permanently erased{" "}
        {validDeadline ? (
          <TimeAgo
            date={deadline}
            live
            click_to_toggle={false}
            time_ago_absolute={false}
          />
        ) : (
          "at the configured deletion time"
        )}
        . Nothing from this project is retained.
      </Typography.Text>
      {validDeadline && (
        <Typography.Text type="secondary">
          {deadline.toLocaleString()}
        </Typography.Text>
      )}
    </Space>
  );

  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        gap: 6,
        position: "fixed",
        right: 8,
        top: 6,
        zIndex: 1000,
      }}
    >
      <Button
        size="small"
        shape="round"
        icon={<Icon name="sun" />}
        onClick={() => setScratchpadDarkMode(!darkMode)}
        aria-label={darkMode ? "Use light mode" : "Use dark mode"}
      >
        {darkMode ? "Light mode" : "Dark mode"}
      </Button>
      <Popover content={reminder} trigger="click" placement="bottomRight">
        <Button
          size="small"
          shape="round"
          icon={<Icon name="stopwatch" />}
          style={{
            background: COLORS.ANTD_ORANGE,
            borderColor: COLORS.FEATURE_ORANGE,
          }}
        >
          Temporary
        </Button>
      </Popover>
    </div>
  );
}
