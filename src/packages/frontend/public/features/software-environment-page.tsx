/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Button, Col, Flex, Row, Typography } from "antd";

import { PublicSection } from "@cocalc/frontend/public/layout/shell";
import {
  PUBLIC_COLORS,
  PUBLIC_ELEVATION,
  PUBLIC_RADIUS,
  PUBLIC_TYPE,
} from "@cocalc/frontend/public/theme";
import {
  BulletList,
  featureAppPath as appPath,
  LinkButton,
} from "./page-components";
import { FeatureInfo, FeatureInfoHeading } from "./feature-info";
import { ContextList, FeatureFinalBand } from "./feature-visuals";

const { Paragraph, Text, Title } = Typography;

const GUIDE_BASE = "https://sagemathinc.github.io/cocalc-guides";

// A small sample of the real runtime-image catalog, used for the mock visual.
const CATALOG_SAMPLE = [
  { accent: "#0f80c1", label: "SageMath", note: "symbolic + numeric math" },
  { accent: "#389e0d", label: "Python + uv", note: "fast Python + Jupyter" },
  { accent: "#1d6fb8", label: "R + RStudio", note: "IRkernel, Shiny, RStudio" },
  { accent: "#7c3aed", label: "Julia + Pluto", note: "Pluto.jl notebooks" },
  { accent: "#bf7b00", label: "LaTeX", note: "TeX Live 2026" },
  { accent: "#d4380d", label: "PyTorch GPU", note: "CUDA machine learning" },
  {
    accent: "#ad6800",
    label: "Web Development",
    note: "Node, Postgres, Redis",
  },
] as const;

// Stand-in visual for the catalog section until a real screenshot of the
// runtime-image catalog lands; keeps the section in the 2:1 media/text rhythm.
function ImageCatalogMock() {
  return (
    <div
      aria-label="Illustration of the runtime image catalog"
      role="img"
      style={{
        background: PUBLIC_COLORS.surface,
        border: `1px solid ${PUBLIC_COLORS.border}`,
        borderRadius: PUBLIC_RADIUS.media,
        boxShadow: PUBLIC_ELEVATION.media,
        padding: 20,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        }}
      >
        {CATALOG_SAMPLE.map(({ accent, label, note }) => (
          <div
            key={label}
            style={{
              background: PUBLIC_COLORS.surfaceMuted,
              border: `1px solid ${PUBLIC_COLORS.border}`,
              borderRadius: PUBLIC_RADIUS.panel,
              padding: "12px 14px",
            }}
          >
            <Flex vertical gap={6}>
              <span
                style={{
                  background: accent,
                  borderRadius: "50%",
                  display: "block",
                  height: 10,
                  width: 10,
                }}
              />
              <Text strong style={{ fontSize: 14 }}>
                {label}
              </Text>
              <Text style={{ color: PUBLIC_COLORS.mutedText, fontSize: 12.5 }}>
                {note}
              </Text>
            </Flex>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SoftwareEnvironmentFeaturePage({
  helpEmail,
  isAuthenticated,
}: {
  helpEmail?: string;
  isAuthenticated?: boolean;
}) {
  const primaryCtaHref = isAuthenticated
    ? appPath("projects")
    : appPath("auth/sign-up");
  const primaryCtaLabel = isAuthenticated ? "Open projects" : "Create account";
  const finalCtaLabel = isAuthenticated
    ? "Open projects"
    : "Start with the image that fits";

  return (
    <Flex vertical gap={36}>
      <PublicSection>
        <Row align="top" gutter={[44, 32]} style={{ padding: "22px 0 14px" }}>
          <Col xs={24} lg={14}>
            <Flex vertical gap={20}>
              <Title level={2} style={{ margin: 0 }}>
                Your project's software is an image you choose
              </Title>
              <Paragraph style={{ fontSize: PUBLIC_TYPE.lead, margin: 0 }}>
                Every CoCalc project runs on a runtime image, from a lean base
                system to full scientific stacks. Customize it, switch it, or
                build your own.
              </Paragraph>
              <Flex wrap gap={12}>
                <Button type="primary" href={primaryCtaHref}>
                  {primaryCtaLabel}
                </Button>
                <LinkButton href={appPath("rootfs")}>
                  Browse the image catalog
                </LinkButton>
              </Flex>
            </Flex>
          </Col>
          <Col xs={24} lg={10}>
            <ContextList
              accent="#096dd9"
              items={[
                { icon: "cube", label: "One image per project, switchable" },
                { icon: "download", label: "Your installs persist on top" },
                { icon: "users", label: "Share images with your team" },
              ]}
              title="Highlights"
            />
          </Col>
        </Row>
      </PublicSection>

      <PublicSection>
        <FeatureInfoHeading
          anchor="a-overview"
          description={
            <>
              The software a project sees comes from its image: languages,
              kernels, apps, LaTeX. Pick a ready-made one, or make it yours.
            </>
          }
        >
          Software environments, made explicit
        </FeatureInfoHeading>
      </PublicSection>

      <PublicSection>
        {/* mock visual — replace with a screenshot of the image catalog */}
        <FeatureInfo
          accent="#096dd9"
          alt="Cards from the runtime image catalog"
          anchor="a-catalog"
          icon="server"
          imageComponent={<ImageCatalogMock />}
          title="Ready-made images for real workflows"
        >
          <Paragraph>
            The catalog covers the stacks technical work actually uses:
            SageMath, Python, R with RStudio, Julia with Pluto, Quarto, Lean,
            GPU images for PyTorch and TensorFlow, web development, Overleaf, VS
            Code in the browser, and more.
          </Paragraph>
          <Paragraph>
            Official images are curated and kept current in{" "}
            <strong>stable and preview channels</strong>. Everything you see in
            a notebook or terminal, from Jupyter kernels to LaTeX engines, comes
            from the image you picked.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent="#7c3aed"
          anchor="a-switching"
          icon="exchange"
          title="Pick per project, switch anytime"
        >
          <Paragraph>
            Choose an image when you create a project, or change it later in the
            project settings. Switching restarts the project with the new
            environment, and a <strong>one-step rollback</strong> to the
            previous image stays available.
          </Paragraph>
          <Paragraph>
            When a newer version of your image family is released, CoCalc offers
            the upgrade; you decide when to take it.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent="#389e0d"
          anchor="a-persistence"
          icon="download"
          title="Install on top: your changes persist"
        >
          <Paragraph>
            The base image is shared and read-only; everything you install on
            top is stored with your project, whether via{" "}
            <code>apt-get install</code>, <code>pip</code>, <code>npm</code>, or
            your own builds. It <strong>survives restarts</strong>, is included
            in backups, and moves with the project.
          </Paragraph>
          <Paragraph>
            The base image itself does not count against your project's disk
            quota, so a full scientific stack costs you nothing in storage.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent="#ad6800"
          anchor="a-custom"
          icon="wrench"
          title="Build and share your own images"
        >
          <Paragraph>
            Turn a configured project into a reusable image with one action:{" "}
            <strong>publish the current environment</strong> and use it for your
            next project, your collaborators, or a whole course.
          </Paragraph>
          <Paragraph>
            Prefer reproducible builds? Describe an image as a{" "}
            <strong>declarative recipe</strong> and let CoCalc build it for you.
            You can even import a Binder-style repository. Published images can
            be vulnerability-scanned and can stay private, be shared with
            collaborators, or made public.
          </Paragraph>
          <Paragraph>
            <LinkButton href={`${GUIDE_BASE}/rootfs-management/`}>
              Read the image management guide
            </LinkButton>
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureFinalBand
          action={{
            body: "Create a project on the image that matches your work, then reshape it from there.",
            href: primaryCtaHref,
            label: finalCtaLabel,
            title: "Ready to pick your environment?",
          }}
          relatedLinks={[
            { href: appPath("rootfs"), label: "Image catalog" },
            {
              href: `${GUIDE_BASE}/rootfs-management/`,
              label: "Image management guide",
            },
            {
              href: `${GUIDE_BASE}/software-install/`,
              label: "Software install guide",
            },
            {
              href: appPath("features/jupyter-notebook"),
              label: "Jupyter notebooks",
            },
            { href: appPath("features/linux"), label: "Linux environment" },
            ...(helpEmail
              ? [{ href: `mailto:${helpEmail}`, label: "Contact support" }]
              : []),
          ]}
          title="One environment decision, everything else follows"
        >
          <BulletList
            items={[
              "Notebook kernels, LaTeX engines, and command-line tools all come from the project's image.",
              "Teams and courses stay reproducible: everyone works on the same environment.",
              "Start lean and add what you need, or start from a full stack and get to work.",
            ]}
          />
        </FeatureFinalBand>
      </PublicSection>
    </Flex>
  );
}
