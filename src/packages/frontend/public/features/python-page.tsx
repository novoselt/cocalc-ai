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
  featureSignUpPath,
  LinkButton,
} from "./page-components";
import { FeatureInfo, FeatureInfoHeading } from "./feature-info";
import { ContextList, FeatureFinalBand } from "./feature-visuals";

const { Paragraph, Title } = Typography;

const GUIDE_BASE = "https://sagemathinc.github.io/cocalc-guides";

export default function PythonFeaturePage({
  helpEmail,
  isAuthenticated,
}: {
  helpEmail?: string;
  isAuthenticated?: boolean;
}) {
  const primaryCtaHref = isAuthenticated
    ? appPath("projects")
    : featureSignUpPath("jupyter-python");
  const primaryCtaLabel = isAuthenticated ? "Open projects" : "Create account";
  const finalCtaLabel = isAuthenticated
    ? "Open projects"
    : "Start using Python";

  return (
    <Flex vertical gap={36}>
      <PublicSection>
        <Row align="top" gutter={[44, 32]} style={{ padding: "22px 0 14px" }}>
          <Col xs={24} lg={14}>
            <Flex vertical gap={20}>
              <Title level={2} style={{ margin: 0, maxWidth: 760 }}>
                A full Python environment online, set up the way you want.
              </Title>
              <Paragraph
                style={{ fontSize: PUBLIC_TYPE.lead, margin: 0, maxWidth: 720 }}
              >
                Every CoCalc project is a Linux machine with the scientific
                Python stack ready to use: Jupyter notebooks, scripts, and
                terminals in your browser. Install any package you need, and it
                stays with the project.
              </Paragraph>
              <Flex wrap gap={12}>
                <Button type="primary" href={primaryCtaHref}>
                  {primaryCtaLabel}
                </Button>
                <LinkButton href={appPath("features/jupyter-notebook")}>
                  Jupyter notebooks
                </LinkButton>
                <LinkButton href={appPath("features/software-environment")}>
                  Software environments
                </LinkButton>
              </Flex>
            </Flex>
          </Col>
          <Col xs={24} lg={10}>
            <ContextList
              accent={COLORS.FEATURE_BLUE}
              items={[
                { icon: "python", label: "NumPy, pandas, SciPy, scikit-learn" },
                { icon: "jupyter", label: "Jupyter notebooks and JupyterLab" },
                { icon: "download", label: "uv, pip, conda, and apt installs" },
                { icon: "server", label: "Larger machines and NVIDIA GPUs" },
              ]}
              title="Python online"
            />
          </Col>
        </Row>
      </PublicSection>

      <PublicSection>
        <FeatureInfoHeading
          anchor="a-overview"
          description={
            <>
              Scripts, notebooks, terminals, and web apps all use the same
              Python installation in the same project, so the environment stays
              the same while the work changes.
            </>
          }
        >
          Scientific Python, in an environment you control
        </FeatureInfoHeading>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent={COLORS.FEATURE_PURPLE}
          alt="A Python script in the CoCalc editor with a terminal running it next to the source"
          anchor="a-scripts"
          icon="terminal"
          image="cocalc-python-script-terminal-20260811.png"
          title="Scripts, the shell, and long-running jobs"
        >
          <Paragraph>
            <code>.py</code> files open in the collaborative code editor with a{" "}
            <strong>terminal pane right next to the source</strong>: run{" "}
            <code>python3 script.py</code>, read the output, fix a line, and run
            it again without leaving the file. The editor's Shell button opens a{" "}
            <code>python3</code> session the same way.
          </Paragraph>
          <Paragraph>
            Longer work belongs in a{" "}
            <a href={appPath("features/terminal")}>real Linux terminal</a>:{" "}
            <code>python train.py</code> runs in a session that{" "}
            <strong>keeps going when you close the browser</strong>, and you
            reconnect to the same output later.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent={COLORS.RUN}
          anchor="a-packages"
          icon="download"
          imageComponent={
            <CodeBlock
              ariaLabel="Installing Python packages with uv, pip, and apt in a CoCalc project"
              code={`uv venv .venv
source .venv/bin/activate
uv pip install polars scikit-image

pip install --user tqdm
sudo apt-get update
sudo apt-get install -y libgdal-dev

python -c "import polars; print(polars.__version__)"`}
            />
          }
          title="Install the packages you want, at any layer"
        >
          <Paragraph>
            You are not limited to what the image ships.{" "}
            <strong>Passwordless sudo works in every project</strong>, so{" "}
            <code>apt-get</code> installs system libraries, while{" "}
            <code>uv</code>, <code>pip</code>, and <code>conda</code> install
            Python packages right where the code runs, in a virtual environment
            or in your home directory.
          </Paragraph>
          <Paragraph>
            Everything you install <strong>persists with the project</strong>:
            it survives restarts, is captured in snapshots and backups, and
            moves with the project. A per-repository setup, such as a uv
            environment defined in a Git repo, works exactly as it does on your
            own machine.
          </Paragraph>
          <Paragraph>
            <LinkButton href={appPath("features/software-environment")}>
              How software environments work
            </LinkButton>
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent={COLORS.FEATURE_BLUE}
          alt="A Python Jupyter notebook in CoCalc with code, output, and a matplotlib plot"
          anchor="a-notebooks"
          icon="jupyter"
          image="jupyter-classic-20260817.png"
          title="Python in Jupyter notebooks"
        >
          <Paragraph>
            Python images ship the scientific stack and a Python 3 kernel, so a
            new notebook runs NumPy, pandas, SciPy, scikit-learn, SymPy, and
            matplotlib right away, with{" "}
            <strong>plots rendered inline next to the code</strong>.
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
          accent={COLORS.FEATURE_ORANGE}
          anchor="a-ide"
          icon="server"
          title="JupyterLab and VS Code in the browser"
        >
          <Paragraph>
            Prefer a full IDE? The project's Apps panel launches{" "}
            <strong>JupyterLab and VS Code with one click</strong>, running
            inside the project on the same files, packages, and Python
            installation as everything else.
          </Paragraph>
          <Paragraph>
            They run <strong>behind your login</strong>, so there is nothing to
            install locally and no second copy of the code to keep in sync.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent={COLORS.FEATURE_RED}
          anchor="a-compute"
          icon="tachometer-alt"
          title="Heavy computations and GPUs"
        >
          <Paragraph>
            When a computation outgrows the machine it runs on,{" "}
            <strong>move the project to a bigger one</strong> and keep your
            files, packages, and history. Live memory and CPU monitoring shows
            what the run actually uses.
          </Paragraph>
          <Paragraph>
            GPU machines are available with{" "}
            <strong>CUDA-ready PyTorch and TensorFlow images</strong>, so model
            training happens in the same project as the notebook that prepared
            the data.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureInfo
          accent={COLORS.FEATURE_TEAL}
          anchor="a-webapps"
          icon="network-wired"
          title="Python web apps and services"
        >
          <Paragraph>
            Start a Flask, FastAPI, or any other Python server on a port in your
            project, and the project's Apps panel{" "}
            <strong>lists it as a detected running HTTP app</strong>. Turn it
            into an app entry with one click and open it through a project URL,
            proxied behind your login with websocket support.
          </Paragraph>
          <Paragraph>
            An app can also be <strong>defined up front</strong>, with its
            command and port, so CoCalc starts it for you and wakes it when
            someone opens the URL. When the app needs more than the Python
            process itself, the web development image adds Node, PostgreSQL, and
            Redis next to Python.
          </Paragraph>
        </FeatureInfo>
      </PublicSection>

      <PublicSection>
        <FeatureFinalBand
          action={{
            body: "Open a project on a Python image and use notebooks, scripts, or the terminal as the work demands.",
            href: primaryCtaHref,
            label: finalCtaLabel,
            title: "Start using Python",
          }}
          relatedLinks={[
            {
              href: appPath("features/jupyter-notebook"),
              label: "Jupyter notebooks",
            },
            {
              href: appPath("features/software-environment"),
              label: "Software environments",
            },
            { href: appPath("features/linux"), label: "Linux environment" },
            { href: appPath("features/terminal"), label: "Linux terminal" },
            {
              href: `${GUIDE_BASE}/software-install/`,
              label: "Software install guide",
            },
            ...(helpEmail
              ? [{ href: `mailto:${helpEmail}`, label: "Contact support" }]
              : []),
          ]}
          title="One project, from first cell to a heavy run"
        >
          <BulletList
            items={[
              "Explore in a notebook, then move stable code into modules and scripts in the same project.",
              "Install the exact packages your code needs, at the layer that fits, and keep them with the project.",
              "Switch to a larger machine or a GPU when a computation gets heavy, without moving your files.",
              "Share the project so collaborators re-run the same code in the same environment.",
            ]}
          />
        </FeatureFinalBand>
      </PublicSection>
    </Flex>
  );
}
