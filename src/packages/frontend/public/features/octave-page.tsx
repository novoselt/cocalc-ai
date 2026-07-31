/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Button, Col, Flex, Row, Typography } from "antd";

import type { IconName } from "@cocalc/frontend/components/icon";
import { PublicSection } from "@cocalc/frontend/public/layout/shell";
import {
  PUBLIC_ELEVATION,
  PUBLIC_COLORS,
  PUBLIC_RADIUS,
  PUBLIC_TYPE,
} from "@cocalc/frontend/public/theme";
import {
  BulletList,
  featureAppPath as appPath,
  LinkButton,
} from "./page-components";
import { FEATURE_ACCENTS } from "./feature-accents";
import { FeatureInfo, FeatureInfoHeading } from "./feature-info";
import { FeatureFinalBand, IconBadge } from "./feature-visuals";

const { Paragraph, Text, Title } = Typography;

const OCTAVE_KERNEL_GUIDE = "docs/jupyter/install-octave-kernel";

function OctaveProjectMock() {
  const projectItems = [
    ["file-code", "solver.m", "source file"],
    ["jupyter", "analysis.ipynb", "interactive notebook"],
    ["terminal", "terminal run", "plots and output"],
  ] satisfies [IconName, string, string][];

  return (
    <div
      aria-label="Illustration of Octave scripts, notebooks, and terminal workflows in CoCalc"
      role="img"
      style={{
        background:
          "linear-gradient(145deg, #ffffff 0%, #fff7f1 52%, #f4f9ff 100%)",
        border: `1px solid ${PUBLIC_COLORS.border}`,
        borderRadius: PUBLIC_RADIUS.panel,
        boxShadow: PUBLIC_ELEVATION.lg,
        padding: 20,
      }}
    >
      <Flex vertical gap={16}>
        <Flex align="center" justify="space-between" wrap gap={10}>
          <Flex align="center" gap={10}>
            <IconBadge accent={FEATURE_ACCENTS.octave} icon="octave" />
            <div>
              <Text strong>Octave project</Text>
              <div style={{ color: PUBLIC_COLORS.mutedText }}>
                notebooks, .m files, plots, terminal runs, and TimeTravel
                history
              </div>
            </div>
          </Flex>
        </Flex>

        <Flex wrap gap={10}>
          {projectItems.map(([icon, title, body]) => (
            <div
              key={title}
              style={{
                background: PUBLIC_COLORS.surface,
                border: `1px solid ${PUBLIC_COLORS.border}`,
                borderRadius: PUBLIC_RADIUS.panel,
                flex: "1 1 160px",
                padding: "10px 12px",
              }}
            >
              <Flex align="center" gap={10}>
                <IconBadge
                  accent={FEATURE_ACCENTS.octave}
                  icon={icon}
                  size="sm"
                />
                <div>
                  <Text strong>{title}</Text>
                  <div style={{ color: PUBLIC_COLORS.mutedText }}>{body}</div>
                </div>
              </Flex>
            </div>
          ))}
        </Flex>
      </Flex>
    </div>
  );
}

export default function OctaveFeaturePage({
  helpEmail,
  isAuthenticated,
}: {
  helpEmail?: string;
  isAuthenticated?: boolean;
}) {
  const primaryHref = isAuthenticated
    ? appPath("projects")
    : appPath("auth/sign-up");
  const primaryLabel = isAuthenticated ? "Open projects" : "Create account";
  const finalLabel = isAuthenticated ? "Open projects" : "Start using Octave";

  return (
    <Flex vertical gap={36}>
      <PublicSection>
        <Row align="top" gutter={[28, 28]}>
          <Col xs={24} lg={11}>
            <Flex vertical gap={14}>
              <Title level={2} style={{ margin: 0 }}>
                Run GNU Octave online in a project you control.
              </Title>
              <Paragraph style={{ fontSize: PUBLIC_TYPE.lead, margin: 0 }}>
                Octave is the free numerical computing language that is largely
                compatible with MATLAB. In CoCalc it runs in a full Linux
                project: work in notebooks, terminals, and <code>.m</code> files
                with your team.
              </Paragraph>
              <Flex wrap gap={12}>
                <Button type="primary" href={primaryHref}>
                  {primaryLabel}
                </Button>
                <LinkButton href={appPath(OCTAVE_KERNEL_GUIDE)}>
                  Octave setup guide
                </LinkButton>
              </Flex>
            </Flex>
          </Col>
          <Col xs={24} lg={13}>
            <OctaveProjectMock />
          </Col>
        </Row>
      </PublicSection>

      <PublicSection>
        <FeatureInfoHeading
          anchor="a-overview"
          description={
            <>
              Octave lives inside a full CoCalc project, so collaboration,
              history, and backups come with it.
            </>
          }
        >
          Octave, with a real project around it
        </FeatureInfoHeading>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent="#2f6fda"
          alt="A Jupyter notebook running the GNU Octave kernel in CoCalc"
          anchor="a-notebooks"
          icon="jupyter"
          image="cocalc-octave-jupyter-20200511.png"
          title="Octave in Jupyter notebooks"
        >
          <Paragraph>
            With the Octave Jupyter kernel in place, following the{" "}
            <a href={appPath(OCTAVE_KERNEL_GUIDE)}>setup guide</a>, notebooks
            gain <strong>Octave as a selectable kernel</strong>: run cells,
            render plots inline, and keep narrative text next to the code.
          </Paragraph>
          <Paragraph>
            The notebook itself is a collaborative CoCalc document:{" "}
            <strong>real-time editing with visible cursors</strong>, chat
            threads anchored to cells, and TimeTravel recording every change.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent="#389e0d"
          anchor="a-scripts"
          icon="terminal"
          title=".m files, plots, and the command line"
        >
          <Paragraph>
            <code>.m</code> files open in the collaborative code editor with{" "}
            <strong>Octave syntax highlighting</strong>, and the editor's Shell
            button starts <code>octave</code> in a pane right next to your file.
          </Paragraph>
          <Paragraph>
            Longer runs belong in the{" "}
            <a href={appPath("features/terminal")}>terminal</a>:{" "}
            <strong>sessions survive disconnects</strong>, so you can start a
            computation, close the laptop, and check the result later.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureFinalBand
          action={{
            body: "Open a project and keep the numerical work in one durable place.",
            href: primaryHref,
            label: finalLabel,
            title: "Start in a project",
          }}
          relatedLinks={[
            {
              href: appPath(OCTAVE_KERNEL_GUIDE),
              label: "Octave setup guide",
            },
            { href: appPath("features/linux"), label: "Linux environment" },
            {
              href: appPath("features/jupyter-notebook"),
              label: "Jupyter notebooks",
            },
            { href: appPath("features/teaching"), label: "Teaching" },
            ...(helpEmail
              ? [{ href: `mailto:${helpEmail}`, label: "Contact support" }]
              : []),
          ]}
          title="When Octave belongs in CoCalc"
        >
          <BulletList
            items={[
              "Numerical research and prototyping that benefits from shared files and history.",
              "Work that mixes Octave with notebooks, data, and write-ups in one project.",
              "A team that opens each other's Octave work and reviews it together.",
              "A numerical course where students share one consistent environment.",
            ]}
          />
        </FeatureFinalBand>
      </PublicSection>
    </Flex>
  );
}
