/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Fragment, type CSSProperties } from "react";

import { Alert, Card, Space, Tag, theme, Typography } from "antd";

import {
  buildMembershipTierPresentation,
  type MembershipTierDetail,
  type MembershipTierDetailGroup,
  type MembershipTierPresentation,
  type MembershipTierPresentationInput,
} from "@cocalc/util/membership-tier-presentation";

const { Paragraph, Text, Title } = Typography;

export type MembershipTierDetailsTier = MembershipTierPresentationInput & {
  presentation?: MembershipTierPresentation;
};

export const SHARED_SERVICE_PARAMETERS_NOTICE =
  "These are the current membership parameters. Shared-service values are usage limits, not reserved capacity or an SLA, and may change as capacity, costs, security requirements, and the product evolve. Use a dedicated project host for fixed compute specifications, or self-host CoCalc for full infrastructure control.";

function presentationFor(
  tier: MembershipTierDetailsTier,
): MembershipTierPresentation {
  // Rebuild when talking to an older API during a rolling deployment.
  if (tier.presentation?.detailGroups != null) {
    return tier.presentation;
  }
  return buildMembershipTierPresentation(tier);
}

function DetailsNotice() {
  return (
    <Alert
      description={SHARED_SERVICE_PARAMETERS_NOTICE}
      showIcon
      title="About these limits"
      type="info"
    />
  );
}

function DetailLabel({ detail }: { detail: MembershipTierDetail }) {
  return (
    <Space orientation="vertical" size={0}>
      <Text strong>{detail.label}</Text>
      {detail.help ? (
        <Text style={{ fontSize: 12 }} type="secondary">
          {detail.help}
        </Text>
      ) : null}
    </Space>
  );
}

export function MembershipTierDetails({
  showNotice = true,
  tier,
}: {
  showNotice?: boolean;
  tier: MembershipTierDetailsTier;
}) {
  const presentation = presentationFor(tier);
  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      {showNotice ? <DetailsNotice /> : null}
      {presentation.detailGroups.map((group) => (
        <Card key={group.key} size="small" title={group.title}>
          <dl
            style={{
              display: "grid",
              gap: "10px 20px",
              gridTemplateColumns: "minmax(220px, 2fr) minmax(120px, 1fr)",
              margin: 0,
            }}
          >
            {group.details.map((detail) => (
              <div key={detail.key} style={{ display: "contents" }}>
                <dt>
                  <DetailLabel detail={detail} />
                </dt>
                <dd style={{ margin: 0, textAlign: "right" }}>
                  <Text>{detail.value}</Text>
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      ))}
    </Space>
  );
}

type ComparisonGroup = {
  key: string;
  title: string;
  details: MembershipTierDetail[];
};

function mergedGroups(
  presentations: readonly MembershipTierPresentation[],
): ComparisonGroup[] {
  const groups = new Map<
    string,
    {
      title: string;
      details: Map<string, MembershipTierDetail>;
    }
  >();
  for (const presentation of presentations) {
    for (const group of presentation.detailGroups) {
      const merged = groups.get(group.key) ?? {
        title: group.title,
        details: new Map<string, MembershipTierDetail>(),
      };
      for (const detail of group.details) {
        if (!merged.details.has(detail.key)) {
          merged.details.set(detail.key, detail);
        }
      }
      groups.set(group.key, merged);
    }
  }
  return [...groups].map(([key, group]) => ({
    key,
    title: group.title,
    details: [...group.details.values()],
  }));
}

function detailValue(
  group: MembershipTierDetailGroup | undefined,
  detailKey: string,
): string | undefined {
  return group?.details.find((detail) => detail.key === detailKey)?.value;
}

export function MembershipTierComparison({
  currentTierId,
  showNotice = true,
  showTitle = true,
  tiers,
}: {
  currentTierId?: string;
  showNotice?: boolean;
  showTitle?: boolean;
  tiers: readonly MembershipTierDetailsTier[];
}) {
  const { token } = theme.useToken();
  const presentations = tiers.map(presentationFor);
  const groups = mergedGroups(presentations);
  const border = `1px solid ${token.colorBorderSecondary}`;
  const tableStyle: CSSProperties = {
    borderCollapse: "collapse",
    minWidth: Math.max(760, 260 + tiers.length * 180),
    width: "100%",
  };
  const headerStyle: CSSProperties = {
    borderBottom: border,
    padding: token.paddingSM,
    textAlign: "center",
    verticalAlign: "bottom",
  };
  const labelStyle: CSSProperties = {
    borderBottom: border,
    maxWidth: 360,
    minWidth: 260,
    padding: token.paddingSM,
    textAlign: "left",
    verticalAlign: "top",
  };
  const valueStyle: CSSProperties = {
    borderBottom: border,
    minWidth: 180,
    padding: token.paddingSM,
    textAlign: "center",
    verticalAlign: "top",
  };

  if (tiers.length === 0) {
    return <Text type="secondary">No membership tiers are configured.</Text>;
  }

  return (
    <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
      {showTitle ? (
        <Space orientation="vertical" size={2}>
          <Title level={2} style={{ margin: 0 }}>
            Compare Memberships
          </Title>
          <Paragraph style={{ margin: 0 }} type="secondary">
            Exact current limits and capabilities for every available tier.
          </Paragraph>
        </Space>
      ) : null}
      {showNotice ? <DetailsNotice /> : null}
      <div style={{ overflowX: "auto", width: "100%" }}>
        <table aria-label="Membership comparison" style={tableStyle}>
          <thead>
            <tr>
              <th style={headerStyle} />
              {tiers.map((tier) => (
                <th key={tier.id} scope="col" style={headerStyle}>
                  <Space orientation="vertical" size={2}>
                    <Text strong style={{ fontSize: 18 }}>
                      {tier.label ?? tier.id}
                    </Text>
                    {tier.id === currentTierId ? (
                      <Tag color="blue">Current</Tag>
                    ) : null}
                  </Space>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.key}>
                <tr key={`${group.key}-heading`}>
                  <th
                    colSpan={tiers.length + 1}
                    scope="colgroup"
                    style={{
                      background: token.colorFillAlter,
                      borderBottom: border,
                      padding: token.paddingSM,
                      textAlign: "left",
                    }}
                  >
                    <Text strong style={{ fontSize: 17 }}>
                      {group.title}
                    </Text>
                  </th>
                </tr>
                {group.details.map((detail) => (
                  <tr key={`${group.key}-${detail.key}`}>
                    <th scope="row" style={labelStyle}>
                      <DetailLabel detail={detail} />
                    </th>
                    {tiers.map((tier, index) => (
                      <td key={tier.id} style={valueStyle}>
                        <Text>
                          {detailValue(
                            presentations[index].detailGroups.find(
                              ({ key }) => key === group.key,
                            ),
                            detail.key,
                          ) ?? "—"}
                        </Text>
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Space>
  );
}
