/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  Progress,
  Row,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { ProjectCollabInviteRow } from "@cocalc/conat/hub/api/projects";
import { redux, useTypedRedux } from "@cocalc/frontend/app-framework";
import { openAccountSettings } from "@cocalc/frontend/account/settings-routing";
import type { InviteInboxState } from "@cocalc/frontend/collaborators/invite-inbox";
import { Icon, Loading } from "@cocalc/frontend/components";
import type { IconName } from "@cocalc/frontend/components/icon";
import { displayNameFromAccount } from "@cocalc/util/accounts/display-name";
import { COLORS } from "@cocalc/util/theme";
import { recordProductActivity } from "@cocalc/frontend/monitoring/product-activity";
import { markFirstRunCompletedThisSession } from "@cocalc/frontend/app/onboarding-session";
import { submitNavigatorPromptInWorkspaceChat } from "@cocalc/frontend/project/new/navigator-intents";
import { useProjectRuntimeCapabilities } from "@cocalc/frontend/project/runtime-capabilities";
import { useCodexPaymentSource } from "@cocalc/frontend/chat/use-codex-payment-source";
import { getLogger } from "@cocalc/frontend/logger";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import {
  applyProjectPreset,
  createInitialProjectDraft,
} from "../create/project-create-draft";
import { useProjectCreateDraft } from "../create/use-project-create-draft";
import { chooseOnboardingRootfs, type OnboardingProjectKind } from "./rootfs";
import { onboardingArtifactCreationForProject } from "./artifact";
import {
  buildCodexOnboardingPrompt,
  codexAvailableForOnboarding,
  codexOnboardingFundingDescription,
} from "./codex";
import {
  FIRST_RUN_ONBOARDING_SETTING,
  FIRST_RUN_ONBOARDING_VERSION,
  isCourseInvitation,
  signUpUsageIntentQuery,
  type FirstRunDecision,
  type FirstRunProject,
  type OnboardingIntent,
  type StoredFirstRunOnboarding,
} from "./state";

const { Paragraph, Text, Title } = Typography;
const logger = getLogger("frontend:projects:first-run-onboarding");

type WizardStep =
  | "home"
  | "home-create"
  | "notebook"
  | "project"
  | "codex"
  | "license";

type ProjectPath = {
  kind: OnboardingProjectKind;
  title: string;
  heading: string;
  description: string;
  icon: IconName;
};

const PROJECT_PATHS: Record<OnboardingProjectKind, ProjectPath> = {
  "jupyter-python": {
    kind: "jupyter-python",
    title: "Python Notebook",
    heading: "Start a Python notebook",
    description: "Create a Jupyter notebook with a Python kernel.",
    icon: "jupyter",
  },
  "jupyter-r": {
    kind: "jupyter-r",
    title: "R Notebook",
    heading: "Start an R notebook",
    description: "Create a Jupyter notebook with an R kernel.",
    icon: "jupyter",
  },
  "jupyter-julia": {
    kind: "jupyter-julia",
    title: "Julia Notebook",
    heading: "Start a Julia notebook",
    description: "Create a Jupyter notebook with a Julia kernel.",
    icon: "jupyter",
  },
  sage: {
    kind: "sage",
    title: "SageMath",
    heading: "Use SageMath and computational mathematics",
    description: "Create a SageMath-ready project and notebook.",
    icon: "calculator",
  },
  code: {
    kind: "code",
    title: "My Code",
    heading: "Write and run code",
    description: "Create a development project and open a terminal.",
    icon: "terminal",
  },
  codex: {
    kind: "codex",
    title: "Codex Project",
    heading: "Build something with Codex",
    description: "Describe your goal and let Codex help inside the project.",
    icon: "robot",
  },
  latex: {
    kind: "latex",
    title: "LaTeX Documents",
    heading: "Write LaTeX and technical documents",
    description: "Create a project with a ready-to-edit LaTeX document.",
    icon: "file-alt",
  },
  teaching: {
    kind: "teaching",
    title: "My Course",
    heading: "Teach a course",
    description: "Create a teaching project and its first course file.",
    icon: "graduation-cap",
  },
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inviteSender(invite: ProjectCollabInviteRow): string {
  return (
    displayNameFromAccount({
      display_name: invite.inviter_name,
      first_name: invite.inviter_first_name,
      last_name: invite.inviter_last_name,
    }) ||
    `${invite.inviter_email_address ?? ""}`.trim() ||
    "A CoCalc user"
  );
}

function onboardingPathLabel(decision: FirstRunDecision): string {
  switch (decision.kind) {
    case "invitations":
      return "invitation";
    case "ready-projects":
      return "ready-project";
    case "intent":
      return "empty-project-list";
    default:
      return decision.kind;
  }
}

function IntentCard({
  title,
  description,
  icon,
  onClick,
  featured,
}: {
  title: string;
  description: string;
  icon: IconName;
  onClick: () => void;
  featured?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        appearance: "none",
        background: featured ? COLORS.BLUE_LLLL : "white",
        border: `1px solid ${featured ? COLORS.BLUE_L : COLORS.GRAY_L0}`,
        borderRadius: 12,
        color: COLORS.GRAY_DD,
        cursor: "pointer",
        display: "flex",
        gap: 14,
        height: "100%",
        padding: 18,
        textAlign: "left",
        width: "100%",
      }}
    >
      <span
        style={{
          alignItems: "center",
          background: featured ? COLORS.BLUE_D : COLORS.GRAY_LLL,
          borderRadius: 10,
          color: featured ? "white" : COLORS.BLUE_D,
          display: "flex",
          flex: "0 0 42px",
          height: 42,
          justifyContent: "center",
          width: 42,
        }}
      >
        <Icon name={icon} style={{ fontSize: 20 }} />
      </span>
      <span>
        <strong style={{ display: "block", fontSize: 16 }}>{title}</strong>
        <span style={{ color: COLORS.GRAY_M, display: "block", marginTop: 5 }}>
          {description}
        </span>
      </span>
    </button>
  );
}

function WizardFrame({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      style={{
        alignItems: "center",
        background:
          "radial-gradient(circle at 10% 0%, #eef6ff 0, transparent 34%), linear-gradient(160deg, #ffffff 0%, #f7fafc 100%)",
        display: "flex",
        flex: "1 1 auto",
        justifyContent: "center",
        minHeight: 0,
        overflow: "auto",
        padding: "28px 16px 48px",
      }}
    >
      <div style={{ maxWidth: 960, width: "100%" }}>
        <div style={{ marginBottom: 24, textAlign: "center" }}>
          <Title level={2} style={{ color: COLORS.BLUE_DDD, marginBottom: 8 }}>
            {title}
          </Title>
          {description ? (
            <Paragraph
              style={{ color: COLORS.GRAY_M, fontSize: 16, margin: "0 auto" }}
            >
              {description}
            </Paragraph>
          ) : null}
        </div>
        {children}
        {footer ? (
          <div style={{ marginTop: 22, textAlign: "center" }}>{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

async function createArtifactWhenReady({
  project_id,
  kind,
}: {
  project_id: string;
  kind: OnboardingProjectKind;
}): Promise<string | undefined> {
  const artifact = await onboardingArtifactCreationForProject({
    kind,
    project_id,
  });
  if (!artifact) return undefined;
  const actions = redux.getProjectActions(project_id);
  if (!actions) throw new Error("Project workspace did not initialize.");
  let lastError = "";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    actions.setState({ file_creation_error: "" });
    await actions.createFile({
      name: artifact.name,
      ext: artifact.ext,
      current_path: artifact.current_path,
      switch_over: artifact.switch_over,
    });
    lastError = `${actions.get_store()?.get("file_creation_error") ?? ""}`;
    if (!lastError) return artifact.relative_path;
    if (
      !/not running|closed|initializ|file server|connect|route/i.test(lastError)
    ) {
      break;
    }
    await delay(1_000);
  }
  throw new Error(lastError || "Could not create the first project file.");
}

export function FirstRunOnboarding({
  decision,
  inviteState,
  createDisabled,
  showLegacyProjects,
  onOpenAdvanced,
}: {
  decision: FirstRunDecision;
  inviteState: InviteInboxState;
  createDisabled: boolean;
  showLegacyProjects: boolean;
  onOpenAdvanced: () => void;
}) {
  const runtime = useProjectRuntimeCapabilities();
  const accountId = `${useTypedRedux("account", "account_id") ?? ""}`;
  const [step, setStep] = useState<WizardStep>("home");
  const [selectedPath, setSelectedPath] = useState<ProjectPath>();
  const [projectTitle, setProjectTitle] = useState("");
  const [codexPrompt, setCodexPrompt] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const recordedDecision = useRef("");
  const { context, rootfsImages, rootfsLoading, rootfsError, isAdmin } =
    useProjectCreateDraft({ defaultValue: "" });
  const { paymentSource: codexPaymentSource } = useCodexPaymentSource({
    enabled:
      decision.kind === "intent" ||
      step === "home-create" ||
      selectedPath?.kind === "codex",
  });
  const codexAvailable = codexAvailableForOnboarding(codexPaymentSource);
  const codexFundingDescription =
    codexOnboardingFundingDescription(codexPaymentSource);

  useEffect(() => {
    if (
      decision.kind === "hidden" ||
      decision.kind === "loading" ||
      recordedDecision.current === decision.kind
    ) {
      return;
    }
    recordedDecision.current = decision.kind;
    recordProductActivity({
      event_name: "first_project_flow_seen",
      properties: { onboarding_path: onboardingPathLabel(decision) },
    });
  }, [decision]);

  async function persist(
    status: StoredFirstRunOnboarding["status"],
    intent?: OnboardingIntent,
    project_id?: string,
  ) {
    const value: StoredFirstRunOnboarding = {
      version: FIRST_RUN_ONBOARDING_VERSION,
      status,
      intent,
      project_id,
      updated_at: new Date().toISOString(),
    };
    const actions = redux.getActions("account");
    try {
      await actions.set_other_settings_and_wait(
        FIRST_RUN_ONBOARDING_SETTING,
        value,
      );
    } catch (err) {
      // Onboarding metadata must not block a successfully created project or
      // accepted invitation. The ordinary project/invite state still prevents
      // duplicate onboarding, while diagnostics retain this failure.
      logger.warn("failed to persist first-run onboarding state", {
        status,
        intent,
        project_id,
        err: `${err}`,
      });
    }
    if (intent) {
      void webapp_client
        .async_query({ query: signUpUsageIntentQuery(intent) })
        .catch((err) => {
          // Usage intent is optional telemetry and must not block onboarding.
          logger.warn("failed to persist sign-up usage intent", {
            intent,
            err: `${err}`,
          });
        });
    }
  }

  async function complete(intent: OnboardingIntent, project_id?: string) {
    markFirstRunCompletedThisSession();
    await persist("completed", intent, project_id);
  }

  function chooseProject(kind: OnboardingProjectKind, next?: WizardStep) {
    const path = PROJECT_PATHS[kind];
    setSelectedPath(path);
    setProjectTitle(path.title);
    setError("");
    setStep(next ?? (kind === "codex" ? "codex" : "project"));
  }

  async function openProject(
    project: FirstRunProject,
    intent: OnboardingIntent,
  ) {
    setBusy(project.project_id);
    setError("");
    try {
      await complete(intent, project.project_id);
      recordProductActivity({
        event_name: "project_entered",
        project_id: project.project_id,
        properties: { onboarding_path: intent },
      });
      await redux.getActions("projects").open_project({
        project_id: project.project_id,
        target: "files",
        switch_to: true,
        restore_session: false,
      });
    } catch (err) {
      setError(`${err}`);
      setBusy("");
    }
  }

  async function acceptInvite(invite: ProjectCollabInviteRow) {
    const key = `${invite.invite_id}:accept`;
    setBusy(key);
    setError("");
    const course = isCourseInvitation(invite);
    try {
      if (!(await inviteState.respond(invite.invite_id, "accept"))) return;
      await (
        redux.getActions("projects") as any
      )?.ensureRealtimeFeedForCurrentAccount?.();
      await complete(
        course ? "course-invite" : "project-invite",
        invite.project_id,
      );
      recordProductActivity({
        event_name: "project_entered",
        project_id: invite.project_id,
        properties: {
          onboarding_path: course ? "course-invite" : "project-invite",
        },
      });
      await redux.getActions("projects").open_project({
        project_id: invite.project_id,
        target: "files",
        switch_to: true,
        restore_session: false,
      });
    } catch (err) {
      setError(`${err}`);
    } finally {
      setBusy("");
    }
  }

  async function createProject() {
    if (!selectedPath || !projectTitle.trim()) return;
    if (createDisabled) {
      setError("Verify your email address before creating a project.");
      return;
    }
    if (selectedPath.kind === "codex" && !codexPrompt.trim()) {
      setError("Describe what you want Codex to help you build.");
      return;
    }
    if (selectedPath.kind === "codex" && !codexAvailable) {
      setError(
        "Codex access is not currently available for this account. Choose another project type or connect a ChatGPT plan in Account settings.",
      );
      return;
    }
    setBusy("create");
    setError("");
    setProgress(12);
    const intent = selectedPath.kind as OnboardingIntent;
    recordProductActivity({
      event_name: "project_create_started",
      properties: { onboarding_path: intent },
    });
    let createdProjectId: string | undefined;
    try {
      let fallbackDraft = createInitialProjectDraft({
        ...context,
        defaultTitle: projectTitle.trim(),
      });
      if (selectedPath.kind === "teaching") {
        fallbackDraft = applyProjectPreset(fallbackDraft, "teaching", context);
      }
      const rootfs = chooseOnboardingRootfs({
        images: rootfsImages,
        kind: selectedPath.kind,
        fallback: {
          image: fallbackDraft.rootfs_image,
          image_id: fallbackDraft.rootfs_image_id,
        },
        isAdmin,
      });
      const project_id = await redux.getActions("projects").create_project({
        title: projectTitle.trim(),
        start: true,
        ...(runtime.rootfs && rootfs?.image
          ? {
              rootfs_image: rootfs.image,
              rootfs_image_id: rootfs.image_id,
            }
          : undefined),
      });
      createdProjectId = project_id;
      await persist("in_progress", intent, project_id);
      setProgress(42);
      await redux.getActions("projects").open_project({
        project_id,
        target: "files",
        switch_to: false,
        restore_session: false,
      });
      setProgress(68);
      let artifact: string | undefined;
      try {
        artifact = await createArtifactWhenReady({
          project_id,
          kind: selectedPath.kind,
        });
      } catch (err) {
        void message.warning(
          `Your project is ready, but CoCalc could not create the first file automatically: ${err}`,
        );
      }
      setProgress(88);
      await complete(intent, project_id);
      recordProductActivity({
        event_name: "project_ready",
        project_id,
        properties: { onboarding_path: intent },
      });
      if (selectedPath.kind === "codex") {
        await redux.getActions("projects").open_project({
          project_id,
          target: "files",
          switch_to: true,
          restore_session: false,
        });
        const visiblePrompt = codexPrompt.trim();
        const submitted = await submitNavigatorPromptInWorkspaceChat({
          project_id,
          prompt: buildCodexOnboardingPrompt(visiblePrompt),
          visiblePrompt,
          title: "Getting started",
          tag: "intent:onboarding",
          forceCodex: true,
          createNewThread: true,
          openFloating: true,
          waitForAgent: true,
        });
        if (!submitted) {
          void message.warning(
            "The project is ready, but Codex did not open automatically. Open Codex from the project to continue.",
          );
        }
      } else {
        await redux.getActions("projects").open_project({
          project_id,
          target: artifact ? `files/${artifact}` : "files",
          switch_to: true,
          restore_session: false,
        });
      }
      setProgress(100);
      recordProductActivity({
        event_name: "project_entered",
        project_id,
        properties: { onboarding_path: intent },
      });
      recordProductActivity({
        event_name: "guided_activation_done",
        project_id,
        properties: { onboarding_path: intent, outcome: "opened" },
      });
    } catch (err) {
      if (createdProjectId) {
        await complete(intent, createdProjectId);
        recordProductActivity({
          event_name: "guided_activation_done",
          project_id: createdProjectId,
          properties: { onboarding_path: intent, outcome: "project-created" },
        });
        try {
          await redux.getActions("projects").open_project({
            project_id: createdProjectId,
            target: "files",
            switch_to: true,
            restore_session: false,
          });
          void message.warning(
            `The project was created, but automatic setup did not finish: ${err}`,
          );
          return;
        } catch {
          // Fall through to the visible error; never offer to create a
          // duplicate project after the first create already succeeded.
        }
      }
      setError(`${err}`);
      setBusy("");
      setProgress(0);
    }
  }

  function routeToLicense(
    intent: OnboardingIntent,
    page: "membership" | "team-licenses" | "site-licenses",
  ) {
    void complete(intent);
    recordProductActivity({
      event_name: "guided_activation_done",
      properties: { onboarding_path: intent, outcome: "routed" },
    });
    openAccountSettings({ page });
  }

  function routeToLegacyProjects() {
    void complete("legacy-restore");
    recordProductActivity({
      event_name: "guided_activation_done",
      properties: {
        onboarding_path: "legacy-restore",
        outcome: "routed",
      },
    });
    openAccountSettings({ page: "legacy-migration" });
  }

  function goHome() {
    setStep(decision.kind === "intent" ? "home" : "home-create");
    setSelectedPath(undefined);
    setProjectTitle("");
    setCodexPrompt("");
    setError("");
  }

  function openAdvancedProjectSetup() {
    void persist("dismissed");
    recordProductActivity({
      event_name: "guided_activation_abandoned",
      properties: {
        onboarding_path: "empty-project-list",
        outcome: "advanced-project-setup",
      },
    });
    onOpenAdvanced();
  }

  if (decision.kind === "hidden") return null;
  if (decision.kind === "loading") {
    return (
      <WizardFrame title="Preparing your CoCalc account">
        <Loading theme="medium" />
      </WizardFrame>
    );
  }

  if (decision.kind === "invitations" && step === "home") {
    return (
      <WizardFrame
        title="You have been invited"
        description="Join the course or project that brought you to CoCalc."
        footer={
          <Button type="link" onClick={() => setStep("home-create")}>
            I want to create my own project instead
          </Button>
        }
      >
        <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
          {error || inviteState.error ? (
            <Alert type="error" showIcon title={error || inviteState.error} />
          ) : null}
          {decision.invitations.map((invite) => {
            const course = isCourseInvitation(invite);
            const acceptKey = `${invite.invite_id}:accept`;
            const declineKey = `${invite.invite_id}:decline`;
            return (
              <Card key={invite.invite_id} style={{ borderRadius: 12 }}>
                <Space
                  align="start"
                  size="large"
                  style={{ justifyContent: "space-between", width: "100%" }}
                  wrap
                >
                  <Space align="start" size="middle">
                    <Icon
                      name={course ? "graduation-cap" : "users"}
                      style={{ color: COLORS.BLUE_D, fontSize: 28 }}
                    />
                    <div>
                      <Tag color={course ? "green" : "blue"}>
                        {course ? "Course invitation" : "Project invitation"}
                      </Tag>
                      <Title level={4} style={{ margin: "8px 0 2px" }}>
                        {invite.project_title || "CoCalc project"}
                      </Title>
                      <Text type="secondary">
                        {inviteSender(invite)} invited you as a{" "}
                        {invite.invite_role === "viewer"
                          ? "viewer"
                          : "collaborator"}
                        .
                      </Text>
                      {invite.message ? (
                        <Paragraph style={{ margin: "10px 0 0" }}>
                          {invite.message}
                        </Paragraph>
                      ) : null}
                    </div>
                  </Space>
                  <Space>
                    <Button
                      onClick={() =>
                        void inviteState.respond(invite.invite_id, "decline")
                      }
                      loading={inviteState.busy === declineKey}
                      disabled={!!busy || !!inviteState.busy}
                    >
                      Decline
                    </Button>
                    <Button
                      type="primary"
                      onClick={() => void acceptInvite(invite)}
                      loading={
                        busy === acceptKey || inviteState.busy === acceptKey
                      }
                      disabled={
                        !!busy || (!!inviteState.busy && busy !== acceptKey)
                      }
                    >
                      Accept and open
                    </Button>
                  </Space>
                </Space>
              </Card>
            );
          })}
        </Space>
      </WizardFrame>
    );
  }

  if (decision.kind === "ready-projects" && step === "home") {
    return (
      <WizardFrame
        title="Your project is ready"
        description="Open the project that was prepared or shared with you."
        footer={
          <Button type="link" onClick={() => setStep("home-create")}>
            Create a different project
          </Button>
        }
      >
        {error ? <Alert type="error" showIcon title={error} /> : null}
        <Row gutter={[16, 16]}>
          {decision.projects.slice(0, 8).map((project) => {
            const course = project.course_type === "student";
            return (
              <Col xs={24} md={12} key={project.project_id}>
                <Card style={{ borderRadius: 12, height: "100%" }}>
                  <Tag color={course ? "green" : "blue"}>
                    {course ? "Course project" : "Shared project"}
                  </Tag>
                  <Title level={4} style={{ margin: "10px 0 6px" }}>
                    {project.title || "Untitled project"}
                  </Title>
                  <Button
                    type="primary"
                    onClick={() =>
                      void openProject(
                        project,
                        course ? "course-invite" : "existing-project",
                      )
                    }
                    loading={busy === project.project_id}
                  >
                    Open project
                  </Button>
                </Card>
              </Col>
            );
          })}
        </Row>
      </WizardFrame>
    );
  }

  if (step === "notebook") {
    return (
      <WizardFrame
        title="Which notebook environment?"
        description="CoCalc will choose a compatible project image and kernel."
        footer={<Button onClick={goHome}>Back</Button>}
      >
        <Row gutter={[16, 16]}>
          {(
            ["jupyter-python", "sage", "jupyter-r", "jupyter-julia"] as const
          ).map((kind) => (
            <Col xs={24} sm={12} key={kind}>
              <IntentCard
                {...PROJECT_PATHS[kind]}
                onClick={() => chooseProject(kind)}
              />
            </Col>
          ))}
        </Row>
      </WizardFrame>
    );
  }

  if (step === "license") {
    return (
      <WizardFrame
        title="Who needs access?"
        description="You do not need to create a compute project to purchase or manage access."
        footer={<Button onClick={goHome}>Back</Button>}
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <IntentCard
              title="Just me"
              description="Choose or manage your personal membership."
              icon="user"
              onClick={() => routeToLicense("membership-self", "membership")}
            />
          </Col>
          <Col xs={24} md={8}>
            <IntentCard
              title="A team"
              description="Purchase seats and assign them to people."
              icon="users"
              onClick={() => routeToLicense("license-team", "team-licenses")}
            />
          </Col>
          <Col xs={24} md={8}>
            <IntentCard
              title="A school or institution"
              description="Request or manage an institutional site license."
              icon="graduation-cap"
              onClick={() => routeToLicense("license-site", "site-licenses")}
            />
          </Col>
        </Row>
      </WizardFrame>
    );
  }

  if ((step === "project" || step === "codex") && selectedPath) {
    const initialDraft = createInitialProjectDraft({
      ...context,
      defaultTitle: projectTitle,
    });
    const fallbackDraft =
      selectedPath.kind === "teaching"
        ? applyProjectPreset(initialDraft, "teaching", context)
        : initialDraft;
    const selectedRootfs = chooseOnboardingRootfs({
      images: rootfsImages,
      kind: selectedPath.kind,
      fallback: {
        image: fallbackDraft.rootfs_image,
        image_id: fallbackDraft.rootfs_image_id,
      },
      isAdmin,
    });
    return (
      <WizardFrame
        title={selectedPath.heading}
        description={selectedPath.description}
        footer={
          <Space>
            <Button onClick={goHome} disabled={!!busy}>
              Back
            </Button>
            <Button
              type="primary"
              onClick={() => void createProject()}
              loading={busy === "create"}
              disabled={
                createDisabled ||
                !projectTitle.trim() ||
                rootfsLoading ||
                (selectedPath.kind === "codex" && !codexPrompt.trim())
              }
            >
              Create project and continue
            </Button>
          </Space>
        }
      >
        <Card style={{ borderRadius: 12, margin: "0 auto", maxWidth: 680 }}>
          <Space orientation="vertical" size="large" style={{ width: "100%" }}>
            {error ? <Alert type="error" showIcon title={error} /> : null}
            {rootfsError ? (
              <Alert
                type="warning"
                showIcon
                title="The image catalog is temporarily unavailable"
                description="CoCalc will use the site's default project image."
              />
            ) : null}
            <label>
              <Text strong>Project name</Text>
              <Input
                size="large"
                value={projectTitle}
                onChange={(event) => setProjectTitle(event.target.value)}
                disabled={!!busy}
                style={{ marginTop: 7 }}
              />
            </label>
            {step === "codex" ? (
              <Space
                orientation="vertical"
                size="middle"
                style={{ width: "100%" }}
              >
                <Alert
                  type="info"
                  showIcon
                  title="Codex is ready to use"
                  description={codexFundingDescription}
                />
                <label>
                  <Text strong>What would you like to make or accomplish?</Text>
                  <Input.TextArea
                    autoFocus
                    rows={5}
                    value={codexPrompt}
                    onChange={(event) => setCodexPrompt(event.target.value)}
                    placeholder="For example: Help me analyze a CSV file and make an interactive plot."
                    disabled={!!busy}
                    style={{ marginTop: 7 }}
                  />
                </label>
              </Space>
            ) : null}
            <div
              style={{
                background: COLORS.GRAY_LLL,
                borderRadius: 8,
                padding: "10px 12px",
              }}
            >
              <Text type="secondary">
                Environment:{" "}
                {rootfsLoading
                  ? "choosing the best available image..."
                  : selectedRootfs?.entry?.label ||
                    selectedRootfs?.image ||
                    "site default"}
              </Text>
            </div>
            {busy === "create" ? (
              <div>
                <Progress percent={progress} status="active" />
                <Text type="secondary">
                  {progress < 42
                    ? "Creating your project..."
                    : progress < 68
                      ? "Starting the software environment..."
                      : progress < 88
                        ? "Creating your first file..."
                        : "Opening your workspace..."}
                </Text>
              </div>
            ) : null}
          </Space>
        </Card>
      </WizardFrame>
    );
  }

  return (
    <WizardFrame
      title="What would you like to do first?"
      description="Choose a starting point. CoCalc will prepare the project and software for you."
      footer={
        <Space wrap>
          <Button type="link" onClick={openAdvancedProjectSetup}>
            Advanced project setup
          </Button>
          <Button
            type="link"
            onClick={() => {
              void persist("dismissed");
              recordProductActivity({
                event_name: "guided_activation_abandoned",
                properties: {
                  onboarding_path: "empty-project-list",
                  outcome: "dismissed",
                },
              });
            }}
          >
            Skip setup and show the Projects page
          </Button>
        </Space>
      }
    >
      {createDisabled ? (
        <Alert
          type="warning"
          showIcon
          title="Verify your email before creating a project"
          style={{ marginBottom: 18 }}
        />
      ) : null}
      <Row gutter={[16, 16]}>
        {codexAvailable ? (
          <Col xs={24} md={12}>
            <IntentCard
              title="Build something with Codex"
              description={`Describe your goal and let Codex help. ${codexFundingDescription}`}
              icon="robot"
              featured
              onClick={() => chooseProject("codex")}
            />
          </Col>
        ) : null}
        <Col xs={24} md={codexAvailable ? 12 : 24}>
          <IntentCard
            title="Start a Jupyter notebook"
            description="Use Python, SageMath, R, Julia, and other kernels."
            icon="jupyter"
            featured
            onClick={() => setStep("notebook")}
          />
        </Col>
        {(["sage", "code", "latex", "teaching"] as const).map((kind) => (
          <Col xs={24} sm={12} key={kind}>
            <IntentCard
              {...PROJECT_PATHS[kind]}
              title={PROJECT_PATHS[kind].heading}
              onClick={() => chooseProject(kind)}
            />
          </Col>
        ))}
        <Col xs={24} sm={12}>
          <IntentCard
            title="Buy or manage access"
            description="Personal memberships, team seats, and institutional licenses."
            icon="key"
            onClick={() => setStep("license")}
          />
        </Col>
        {showLegacyProjects ? (
          <Col xs={24} sm={12}>
            <IntentCard
              title="Restore my legacy projects"
              description="Bring projects from your legacy cocalc.com account into this site."
              icon="exchange"
              onClick={routeToLegacyProjects}
            />
          </Col>
        ) : null}
      </Row>
      {accountId ? null : (
        <Alert
          type="error"
          showIcon
          title="Your account session is not ready. Reload this page to continue."
          style={{ marginTop: 16 }}
        />
      )}
    </WizardFrame>
  );
}
