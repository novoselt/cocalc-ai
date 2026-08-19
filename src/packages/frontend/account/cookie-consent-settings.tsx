/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Alert, Button, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";

import { useTypedRedux } from "@cocalc/frontend/app-framework";
import {
  COOKIE_CATEGORIES,
  getConsentSnapshot,
  onConsentChange,
  showPreferences,
  type ConsentSnapshot,
} from "@cocalc/frontend/cookie-consent";
import { COOKIES_SECTION_TITLE } from "@cocalc/frontend/cookie-consent/categories";

const { Text, Title } = Typography;

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) return timestamp;
  return date.toLocaleString();
}

function CategoryStatus({
  accepted,
  label,
}: {
  accepted: boolean;
  label: string;
}) {
  return (
    <Space>
      <Text>{label}</Text>
      <Tag color={accepted ? "green" : undefined}>
        {accepted ? "Accepted" : "Off"}
      </Tag>
    </Space>
  );
}

// Cookie half of the combined communication card.  The banner's communication
// categories are deliberately left out: they are the same choice as the
// marketing switch shown next to this section, and showing both would present
// one setting twice.
export function CookieConsentSection(): React.JSX.Element | null {
  const cookieBannerEnabled = useTypedRedux(
    "customize",
    "cookie_banner_enabled",
  );
  const [snap, setSnap] = useState<ConsentSnapshot | null>(() =>
    getConsentSnapshot(),
  );

  useEffect(() => onConsentChange(setSnap), []);

  if (!cookieBannerEnabled) return null;

  return (
    <Space vertical style={{ width: "100%" }}>
      <Title level={5} style={{ margin: 0 }}>
        {COOKIES_SECTION_TITLE}
      </Title>
      {snap == null ? (
        <Alert
          type="warning"
          showIcon
          title="You have not yet acknowledged the cookie banner."
        />
      ) : (
        COOKIE_CATEGORIES.filter((category) => category.kind === "cookies").map(
          (category) => (
            <CategoryStatus
              key={category.key}
              accepted={!!snap[category.key]}
              label={category.label}
            />
          ),
        )
      )}
      <Button onClick={() => showPreferences()}>Manage</Button>
      {snap?.timestamp && (
        <Text type="secondary">
          Last updated: {formatTimestamp(snap.timestamp)}
        </Text>
      )}
    </Space>
  );
}
