/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { useEffect, useState } from "react";

import { Alert, Button, Flex, Space, Typography } from "antd";

import { MembershipTierComparison } from "@cocalc/frontend/account/membership-tier-details";
import {
  filterMembershipTiersForBillingInterval,
  MembershipBillingSelector,
  MembershipPricingTierGrid,
  MembershipPricingTierTile,
  type BillingInterval,
  type MembershipPricingTier,
} from "@cocalc/frontend/account/membership-pricing-chooser";
import { appBasePath } from "@cocalc/frontend/customize/app-base-path";
import { sortMembershipTiersByDisplayOrder } from "@cocalc/util/membership-tier-order";
import { joinUrlPath } from "@cocalc/util/url-path";

import { PublicGrid, PublicSection } from "../layout/shell";
import { publicPath } from "../routes";

const { Paragraph, Title } = Typography;

type PublicMembershipTier = MembershipPricingTier;

function appPath(path: string): string {
  return joinUrlPath(appBasePath, path);
}

function supportPurchasePath(subject: string, body: string): string {
  const params = new URLSearchParams({
    body,
    subject,
    title: "Ask Sales",
    type: "purchase",
  });
  return `${appPath("support/new")}?${params.toString()}`;
}

async function loadMembershipTiers(): Promise<
  PublicMembershipTier[] | undefined
> {
  try {
    const resp = await fetch(
      joinUrlPath(appBasePath, "api/v2/purchases/get-membership-tiers"),
    );
    const payload = await resp.json();
    return Array.isArray(payload?.tiers) ? payload.tiers : undefined;
  } catch {
    return undefined;
  }
}

export default function PricingPage({
  isAuthenticated = false,
}: {
  isAuthenticated?: boolean;
}) {
  const [billingInterval, setBillingInterval] =
    useState<BillingInterval>("year");
  const [tiers, setTiers] = useState<PublicMembershipTier[]>();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let canceled = false;
    void loadMembershipTiers()
      .then((value) => {
        if (!canceled) setTiers(value ?? []);
      })
      .finally(() => {
        if (!canceled) setLoaded(true);
      });
    return () => {
      canceled = true;
    };
  }, []);

  const publicTiers = sortMembershipTiersByDisplayOrder(
    (tiers ?? []).filter((tier) => tier.store_visible && !tier.disabled),
  );
  const visibleTiers = filterMembershipTiersForBillingInterval(
    publicTiers,
    billingInterval,
  );

  return (
    <>
      <PublicSection>
        <Title level={2} style={{ margin: 0 }}>
          Find the right fit
        </Title>
        <Paragraph style={{ margin: 0 }}>
          The right setup depends on two things: where CoCalc runs, and how your
          team buys. Compare the operating models first — hosted, local, or
          self-hosted — then choose a plan below.
        </Paragraph>
        <Alert
          showIcon
          style={{ maxWidth: 720 }}
          title="AI integration included; AI usage requires your ChatGPT plan or API key."
          type="info"
        />
        <Flex gap={12} wrap>
          <Button href={publicPath("products")}>
            Compare operating models
          </Button>
        </Flex>
      </PublicSection>

      {publicTiers.length > 0 ? (
        <Flex vertical gap="large">
          <MembershipBillingSelector
            billingInterval={billingInterval}
            setBillingInterval={setBillingInterval}
          />
          {visibleTiers.length > 0 ? (
            <>
              <MembershipPricingTierGrid>
                {visibleTiers.map((tier) => (
                  <MembershipPricingTierTile
                    billingInterval={billingInterval}
                    hoverable
                    href={
                      isAuthenticated
                        ? appPath("settings/membership")
                        : appPath("auth/sign-up")
                    }
                    key={tier.id}
                    tier={tier}
                  />
                ))}
              </MembershipPricingTierGrid>
              <PublicSection>
                <MembershipTierComparison tiers={visibleTiers} />
              </PublicSection>
            </>
          ) : (
            <PublicSection>
              <Alert
                title={`No ${billingInterval === "month" ? "monthly" : "annual"} membership tiers are currently configured.`}
                showIcon
                type="info"
              />
            </PublicSection>
          )}
        </Flex>
      ) : loaded ? (
        <PublicSection>
          <Alert
            title="No public membership tiers are currently configured."
            showIcon
            type="info"
          />
        </PublicSection>
      ) : null}

      <PublicSection>
        <Title level={2} style={{ margin: 0 }}>
          For Teams and Organizations
        </Title>
        <PublicGrid columns={2}>
          <PublicSection>
            <Space orientation="vertical" size="middle">
              <Title level={3} style={{ margin: 0 }}>
                Team seats
              </Title>
              <Paragraph style={{ margin: 0 }}>
                Buy membership seats for a group, then assign them to the people
                who need access. One account manages payment while each person
                works from their own CoCalc account.
              </Paragraph>
              <Button href={appPath("settings/team-licenses")}>
                Manage team seats
              </Button>
            </Space>
          </PublicSection>

          <PublicSection>
            <Space orientation="vertical" size="middle">
              <Title level={3} style={{ margin: 0 }}>
                Organization licenses
              </Title>
              <Paragraph style={{ margin: 0 }}>
                Departments, universities, labs, companies, and research groups
                can arrange access for many people under one license.
              </Paragraph>
              <Button
                href={supportPurchasePath(
                  "Organization license",
                  "I want to discuss a CoCalc organization license.",
                )}
              >
                Contact sales
              </Button>
            </Space>
          </PublicSection>

          <PublicSection>
            <Space orientation="vertical" size="middle">
              <Title level={3} style={{ margin: 0 }}>
                Dedicated project hosts
              </Title>
              <Paragraph style={{ margin: 0 }}>
                Run projects on dedicated compute when shared resources are not
                enough. Memberships determine which dedicated host options are
                available to your account.
              </Paragraph>
              <Button href={appPath("hosts")}>Open project hosts</Button>
            </Space>
          </PublicSection>

          <PublicSection>
            <Space orientation="vertical" size="middle">
              <Title level={3} style={{ margin: 0 }}>
                Quotes and customized invoices
              </Title>
              <Paragraph style={{ margin: 0 }}>
                For purchases above $100 or billing workflows that do not fit
                self-service checkout, contact us for a quote or customized
                invoice.
              </Paragraph>
              <Button
                href={supportPurchasePath(
                  "Quote or customized invoice",
                  "I want to request a quote or customized invoice for CoCalc.",
                )}
              >
                Request a quote
              </Button>
            </Space>
          </PublicSection>
        </PublicGrid>
      </PublicSection>
    </>
  );
}
