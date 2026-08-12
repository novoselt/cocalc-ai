/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Button, Col, Flex, Row, Typography } from "antd";

import { CodeBlock } from "@cocalc/frontend/public/common";
import { PublicSection } from "@cocalc/frontend/public/layout/shell";
import { COLORS } from "@cocalc/util/theme";
import { PUBLIC_TYPE } from "@cocalc/frontend/public/theme";
import {
  BulletList,
  featureAppPath as appPath,
  LinkButton,
} from "./page-components";
import { FEATURE_ACCENTS } from "./feature-accents";
import { FeatureInfo, FeatureInfoHeading } from "./feature-info";
import { ContextList, FeatureFinalBand } from "./feature-visuals";

const { Paragraph, Title } = Typography;

const JULIA_IMAGE = "rootfs/julia";

export default function JuliaFeaturePage({
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
  const finalLabel = isAuthenticated ? "Open projects" : "Start using Julia";

  return (
    <Flex vertical gap={36}>
      <PublicSection>
        <Row align="top" gutter={[44, 32]} style={{ padding: "22px 0 14px" }}>
          <Col xs={24} lg={14}>
            <Flex vertical gap={20}>
              <Title level={2} style={{ margin: 0, maxWidth: 760 }}>
                Run Julia online, in notebooks, Pluto, and the terminal.
              </Title>
              <Paragraph
                style={{ fontSize: PUBLIC_TYPE.lead, margin: 0, maxWidth: 720 }}
              >
                Start a project on the Julia image and everything is in place:
                Julia with its Jupyter kernel, Pluto for reactive notebooks, and
                a full Linux system with your files, packages, and
                collaborators.
              </Paragraph>
              <Flex wrap gap={12}>
                <Button type="primary" href={primaryHref}>
                  {primaryLabel}
                </Button>
                <LinkButton href={appPath(JULIA_IMAGE)}>
                  See the Julia image
                </LinkButton>
                <LinkButton href={appPath("features/jupyter-notebook")}>
                  Jupyter notebooks
                </LinkButton>
              </Flex>
            </Flex>
          </Col>
          <Col xs={24} lg={10}>
            <ContextList
              accent={FEATURE_ACCENTS.julia}
              items={[
                { icon: "jupyter", label: "Julia in Jupyter notebooks" },
                { icon: "layout", label: "Pluto reactive notebooks" },
                { icon: "terminal", label: "julia REPL and .jl scripts" },
                { icon: "cube", label: "Package environments per project" },
              ]}
              title="Julia online"
            />
          </Col>
        </Row>
      </PublicSection>

      <PublicSection>
        <FeatureInfoHeading
          anchor="a-overview"
          description={
            <>
              Julia's own editors are the right choice when the work is only
              Julia. CoCalc earns its place when Julia is one part of a larger
              project, next to data, write-ups, and the people reviewing it.
            </>
          }
        >
          Julia where the rest of the project lives
        </FeatureInfoHeading>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent={COLORS.FEATURE_BLUE}
          anchor="a-notebooks"
          icon="jupyter"
          title="Julia in collaborative Jupyter notebooks"
        >
          <Paragraph>
            The Julia image ships <strong>IJulia</strong>, so Julia is a
            selectable kernel in every notebook: run cells, plot with Plots.jl,
            and keep the narrative next to the code.
          </Paragraph>
          <Paragraph>
            CoCalc notebooks add <strong>real-time collaboration</strong>:
            everyone sees the same cells, output, and kernel session, chat
            threads attach to individual cells, and TimeTravel records every
            edit. The{" "}
            <a href={appPath("features/jupyter-notebook")}>
              Jupyter notebooks page
            </a>{" "}
            covers the editor in detail.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent={FEATURE_ACCENTS.julia}
          anchor="a-pluto"
          icon="layout"
          title="Pluto notebooks, one click away"
        >
          <Paragraph>
            Pluto is installed and{" "}
            <strong>starts from the project's Apps panel</strong>: reactive
            notebooks where changing a cell updates everything that depends on
            it, served through the project behind your login.
          </Paragraph>
          <Paragraph>
            The image also brings <strong>bundled Pluto examples</strong> you
            can copy into your home directory, and VS Code in the browser for
            the parts that are more comfortable in an editor.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent={COLORS.RUN}
          anchor="a-packages"
          icon="cube"
          imageComponent={
            <CodeBlock
              ariaLabel="Creating a Julia package environment and running a script in a CoCalc project"
              code={`julia --project=. -e 'using Pkg; Pkg.add(["DataFrames", "Plots"])'
julia --project=. -e 'using Pkg; Pkg.status()'

julia --project=. simulate.jl`}
            />
          }
          title="Package environments that stay with the project"
        >
          <Paragraph>
            A <code>Project.toml</code> in the project directory is all it
            takes: <code>Pkg.add</code> installs into{" "}
            <strong>an environment that lives with your files</strong>, so
            collaborators instantiate the same versions instead of guessing.
          </Paragraph>
          <Paragraph>
            The image's own depot is shared and read-only, so common packages
            are already compiled, and{" "}
            <strong>what you add on top persists</strong> across restarts and
            travels with the project.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent={COLORS.FEATURE_ORANGE}
          anchor="a-scripts"
          icon="terminal"
          title=".jl files, the REPL, and long runs"
        >
          <Paragraph>
            <code>.jl</code> files open in the collaborative code editor, and
            the editor's Shell button starts{" "}
            <strong>a julia REPL next to your source</strong>, so a function can
            be tried without leaving the file.
          </Paragraph>
          <Paragraph>
            Longer simulations belong in a{" "}
            <a href={appPath("features/terminal")}>real Linux terminal</a>: the
            session <strong>keeps running when you close the browser</strong>,
            and you reconnect to the same output later.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureFinalBand
          action={{
            body: "Open a project on the Julia image and use notebooks, Pluto, source files, or the terminal as the work demands.",
            href: primaryHref,
            label: finalLabel,
            title: "Start using Julia",
          }}
          relatedLinks={[
            { href: appPath(JULIA_IMAGE), label: "Julia image" },
            {
              href: appPath("features/jupyter-notebook"),
              label: "Jupyter notebooks",
            },
            {
              href: appPath("features/software-environment"),
              label: "Software environments",
            },
            { href: appPath("features/linux"), label: "Linux environment" },
            { href: appPath("features/teaching"), label: "Teaching" },
            ...(helpEmail
              ? [{ href: `mailto:${helpEmail}`, label: "Contact support" }]
              : []),
          ]}
          title="When Julia belongs in CoCalc"
        >
          <BulletList
            items={[
              "Models that mix Julia with Python, R, data, and a written report in one project.",
              "A shared package environment that collaborators instantiate instead of rebuilding.",
              "Review with real-time editing, visible cursors, and TimeTravel history.",
              "Courses where students open a working Julia setup instead of installing one.",
            ]}
          />
        </FeatureFinalBand>
      </PublicSection>
    </Flex>
  );
}
