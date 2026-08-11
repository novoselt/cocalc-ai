/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Button, Col, Flex, Row, Typography } from "antd";

import { PublicSection } from "@cocalc/frontend/public/layout/shell";
import { COLORS } from "@cocalc/util/theme";
import { PUBLIC_TYPE } from "@cocalc/frontend/public/theme";
import {
  BulletList,
  featureAppPath as appPath,
  LinkButton,
} from "./page-components";
import { FeatureInfo, FeatureInfoHeading } from "./feature-info";
import { FeatureFinalBand } from "./feature-visuals";

const { Paragraph, Title } = Typography;

const OCTAVE_KERNEL_GUIDE = "docs/jupyter/install-octave-kernel";
const OCTAVE_IMAGE = "rootfs/octave-11-3";

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
          {/* TODO: split back to lg={11} + a terminal screenshot column once
              the Octave terminal capture lands. */}
          <Col xs={24}>
            <Flex vertical gap={14}>
              <Title level={2} style={{ margin: 0, maxWidth: 760 }}>
                Run GNU Octave online in a project you control.
              </Title>
              <Paragraph
                style={{ fontSize: PUBLIC_TYPE.lead, margin: 0, maxWidth: 720 }}
              >
                Octave is the free numerical computing language that is largely
                compatible with MATLAB. Start a project on the Octave image and
                it is ready: Octave with the common packages, a Jupyter kernel,
                and a full Linux system around it.
              </Paragraph>
              <Flex wrap gap={12}>
                <Button type="primary" href={primaryHref}>
                  {primaryLabel}
                </Button>
                <LinkButton href={appPath(OCTAVE_IMAGE)}>
                  See the Octave image
                </LinkButton>
              </Flex>
            </Flex>
          </Col>
        </Row>
      </PublicSection>

      <PublicSection>
        <FeatureInfoHeading
          anchor="a-overview"
          description={
            <>
              Octave is preinstalled in its own image, and it lives inside a
              full CoCalc project, so collaboration, history, and backups come
              with it.
            </>
          }
        >
          Octave, with a real project around it
        </FeatureInfoHeading>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent={COLORS.FEATURE_OCTAVE_BLUE}
          alt="A 3D sombrero surface plotted by Octave in a CoCalc Jupyter notebook"
          anchor="a-notebooks"
          icon="jupyter"
          image="cocalc-octave-sombrero-20260811.png"
          title="Octave in Jupyter notebooks"
        >
          <Paragraph>
            On the Octave image, <strong>Octave is the default kernel</strong>{" "}
            for new notebooks: run cells, render plots inline, and keep
            narrative text next to the code. A Python kernel is there too, for
            the parts that are easier in Python.
          </Paragraph>
          <Paragraph>
            The notebook itself is a collaborative CoCalc document:{" "}
            <strong>real-time editing with visible cursors</strong>, chat
            threads anchored to cells, and TimeTravel recording every change.
            The{" "}
            <a href={appPath("features/jupyter-notebook")}>
              Jupyter notebooks page
            </a>{" "}
            covers the editor in detail.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent={COLORS.FEATURE_TEAL}
          alt="An Octave notebook integrating a function symbolically and plotting it with its antiderivative"
          anchor="a-image"
          icon="cube"
          image="cocalc-octave-symbolic-20260811.png"
          title="Octave, with the packages you expect"
        >
          <Paragraph>
            The <a href={appPath(OCTAVE_IMAGE)}>Octave image</a> is{" "}
            <strong>built from source</strong> and ships the common Octave
            packages: statistics, control, signal, image, optim, and symbolic.
            Jupyter kernels for Octave and Python come with it, and JupyterLab
            starts from the project's Apps panel.
          </Paragraph>
          <Paragraph>
            Pick it when you create a project, or switch an existing project to
            it later. Anything you add on top, from <code>pkg install</code> to{" "}
            <code>apt-get</code>, <strong>persists with the project</strong>. To
            add Octave to a different image instead, follow the{" "}
            <a href={appPath(OCTAVE_KERNEL_GUIDE)}>kernel setup guide</a>.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent={COLORS.RUN}
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
            { href: appPath(OCTAVE_IMAGE), label: "Octave image" },
            {
              href: appPath(OCTAVE_KERNEL_GUIDE),
              label: "Octave setup guide",
            },
            {
              href: appPath("features/software-environment"),
              label: "Software environments",
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
