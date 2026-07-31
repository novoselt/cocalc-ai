/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Button, Col, Flex, Row, Typography } from "antd";

import { PublicSection } from "@cocalc/frontend/public/layout/shell";
import { PUBLIC_TYPE } from "@cocalc/frontend/public/theme";
import { COLORS } from "@cocalc/util/theme";
import {
  BulletList,
  featureAppPath as appPath,
  featureAsset,
  LinkButton,
} from "./page-components";
import { FeatureInfo, FeatureInfoHeading, ZoomableImage } from "./feature-info";
import { ContextList, FeatureFinalBand } from "./feature-visuals";

const { Paragraph, Title } = Typography;

export default function RStatisticalSoftwareFeaturePage({
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
  const finalLabel = isAuthenticated ? "Open projects" : "Start using R";

  return (
    <Flex vertical gap={36}>
      <PublicSection>
        <Row align="top" gutter={[44, 32]} style={{ padding: "22px 0 14px" }}>
          <Col xs={24} lg={14}>
            <Flex vertical gap={20}>
              <Title level={2} style={{ margin: 0, maxWidth: 760 }}>
                R statistical software online, from analysis to report.
              </Title>
              <Paragraph
                style={{ fontSize: PUBLIC_TYPE.lead, margin: 0, maxWidth: 720 }}
              >
                Run R in your browser: Jupyter notebooks, a full IDE, RMarkdown
                and Quarto reports, knitr LaTeX documents, and plain R scripts,
                all in one shared project.
              </Paragraph>
              <Flex wrap gap={12}>
                <Button type="primary" href={primaryHref}>
                  {primaryLabel}
                </Button>
                <LinkButton href={appPath("features/jupyter-notebook")}>
                  Jupyter notebooks
                </LinkButton>
                <LinkButton href={appPath("features/latex-editor")}>
                  LaTeX editor
                </LinkButton>
              </Flex>
            </Flex>
          </Col>
          <Col xs={24} lg={10}>
            <ContextList
              accent={COLORS.FEATURE_R_BLUE}
              items={[
                { icon: "r", label: "R with the IRkernel in notebooks" },
                { icon: "server", label: "Browser-based R IDE with one click" },
                { icon: "markdown", label: "RMarkdown and Quarto rendering" },
                { icon: "tex", label: "Knitr .Rnw in the LaTeX editor" },
              ]}
              title="R online"
            />
          </Col>
        </Row>
      </PublicSection>

      <PublicSection>
        <div style={{ margin: "0 auto", maxWidth: 940 }}>
          <ZoomableImage
            alt="A faceted ggplot2 boxplot in an R Jupyter notebook in CoCalc"
            priority
            src={featureAsset("cocalc-r-hero-ggplot2-20260731.png")}
          />
        </div>
      </PublicSection>

      <PublicSection>
        <FeatureInfoHeading
          anchor="a-overview"
          description={
            <>
              There are many ways to use R online in CoCalc. Pick the interface
              that fits the task; the data, packages, and history stay in the
              same project.
            </>
          }
        >
          Feature overview
        </FeatureInfoHeading>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent={COLORS.FEATURE_R_BLUE}
          alt="The same R Jupyter notebook synchronized across two views"
          anchor="a-notebooks"
          icon="jupyter"
          image="cocalc-r-synced-editing-20260731.png"
          title="R in collaborative Jupyter notebooks"
        >
          <Paragraph>
            R images ship the <strong>IRkernel</strong>, so notebooks run R
            natively: fit models, plot with ggplot2, and keep narrative text
            next to the code.
          </Paragraph>
          <Paragraph>
            CoCalc notebooks add <strong>real-time collaboration</strong>:
            everyone sees the same cells, output, and kernel session, with chat
            anchored to the notebook and TimeTravel recording every edit. That
            makes review and pair analysis practical without screen sharing.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent={COLORS.RUN}
          alt="A Quarto document with R and Python code next to its rendered HTML"
          anchor="a-rmarkdown"
          icon="markdown"
          image="cocalc-r-qmd-quarto-20260731.png"
          title="RMarkdown and Quarto reports"
        >
          <Paragraph>
            Edit <code>.Rmd</code> and <code>.qmd</code> files with the source
            and the rendered result side by side. CoCalc runs{" "}
            <strong>
              <code>rmarkdown::render</code> and <code>quarto render</code>
            </strong>{" "}
            for you and shows the build log when something goes wrong.
          </Paragraph>
          <Paragraph>
            The result is a <strong>reproducible report</strong>: code, text,
            and figures in one file, rendered to HTML or PDF from the same
            project that holds the data.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent={COLORS.FEATURE_ORANGE}
          alt="A knitr .Rnw document with R code next to its compiled PDF"
          anchor="a-knitr"
          icon="tex"
          image="cocalc-r-rnw-knitr-20260731.png"
          title="Knitr documents in the LaTeX editor"
        >
          <Paragraph>
            Statistical papers that embed R belong in <code>.Rnw</code> or{" "}
            <code>.Rtex</code> files. The{" "}
            <a href={appPath("features/latex-editor")}>LaTeX editor</a>{" "}
            <strong>runs knitr and then LaTeX in one build</strong>, with
            forward and inverse search between source and PDF, in an image that
            provides both R and TeX Live.
          </Paragraph>
          <Paragraph>
            Starter templates for knitr documents are built in, and{" "}
            <strong>collaborators see the same compiled PDF</strong> while the
            source stays synchronized in real time.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent={COLORS.FEATURE_PURPLE}
          anchor="a-ide"
          icon="server"
          title="A full R IDE and Shiny apps"
        >
          <Paragraph>
            Prefer a classic IDE? The R images include a browser-based R IDE
            server: <strong>launch it with one click</strong> from the project's
            Apps tab and work on the project's files and packages in a familiar
            layout.
          </Paragraph>
          <Paragraph>
            Shiny is installed as well, and a bundled example app{" "}
            <strong>runs through the project's app proxy</strong>, so you can
            try an interactive app straight from the browser.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent={COLORS.FEATURE_BLUE}
          alt="Rscript running an R file in a CoCalc terminal next to the editor"
          anchor="a-commandline"
          icon="terminal"
          image="cocalc-r-script-mandelbrot-20260731.png"
          title="R scripts on the command line"
        >
          <Paragraph>
            Your existing scripts run unchanged:{" "}
            <strong>
              <code>Rscript analysis.R</code> in a real Linux terminal
            </strong>
            , with the project's filesystem, Git, and automatic backups and
            snapshots around it.
          </Paragraph>
          <Paragraph>
            Long-running model fits{" "}
            <strong>keep going when you close the browser</strong>, and package
            installs persist in the project, on top of the image's preinstalled
            R stack.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureFinalBand
          action={{
            body: "Open a project on an R image and use notebooks, the IDE, reports, or plain scripts as the work demands.",
            href: primaryHref,
            label: finalLabel,
            title: "Start analyzing in R",
          }}
          relatedLinks={[
            {
              href: appPath("features/jupyter-notebook"),
              label: "Jupyter notebooks",
            },
            { href: appPath("features/latex-editor"), label: "LaTeX editor" },
            {
              href: appPath("features/software-environment"),
              label: "Software environments",
            },
            { href: appPath("features/python"), label: "Python" },
            ...(helpEmail
              ? [{ href: `mailto:${helpEmail}`, label: "Contact support" }]
              : []),
          ]}
          title="From analysis to a shared report"
        >
          <BulletList
            items={[
              "Develop the model in a notebook or the IDE, with packages and data in the project.",
              "Render an RMarkdown or Quarto report, or build a knitr LaTeX paper, from the same project.",
              "Collaborators and reviewers open the project and see the exact code, output, and TimeTravel history.",
              "Re-run it later: the environment, data, and report build are still there.",
            ]}
          />
        </FeatureFinalBand>
      </PublicSection>
    </Flex>
  );
}
