/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Divider,
  Input,
  InputNumber,
  Popconfirm,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import { BookOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "@cocalc/frontend/app-framework";
import type {
  Host,
  HostExamConfig,
  HostExamConfigInput,
  HostExamState,
  HostRootfsImage,
} from "@cocalc/conat/hub/api/hosts";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import {
  FreshAuthModal,
  useFreshAuthAction,
} from "@cocalc/frontend/auth/fresh-auth";
import { openAppDocs } from "@cocalc/frontend/docs/navigation";
import { RootfsCatalogPicker } from "@cocalc/frontend/rootfs/catalog-picker";
import {
  managedRootfsCatalogUrl,
  useRootfsImages,
} from "@cocalc/frontend/rootfs/manifest";
import {
  getHostCpuCount,
  getHostRamGiB,
} from "@cocalc/frontend/hosts/utils/format";
import {
  managedRootfsContentKey,
  type RootfsImageEntry,
} from "@cocalc/util/rootfs-images";

const DEFAULT_CONFIG: HostExamConfigInput = {
  enabled: false,
  title: "Exam Scratchpad",
  max_projects: 100,
  project_cpu: 1,
  project_memory_mb: 2_000,
  project_disk_mb: 5_000,
  project_ttl_minutes: 360,
  cleanup_grace_minutes: 10,
  terminal_enabled: false,
  network_mode: "disabled",
};

const RECOMMENDED_EXAM_CPU = 8;
const SUBSTANTIALLY_LOW_CPU = 4;
const SUBSTANTIALLY_LOW_RAM_RATIO = 0.4;
const EXAM_STATE_TIMEOUT_MS = 30_000;
const EXAM_MUTATION_TIMEOUT_MS = 2 * 60_000;
const EXAM_LIFECYCLE_TIMEOUT_MS = 12 * 60_000;
const EXAM_TRANSIENT_POLL_MS = 2_000;
const EXAM_TRANSIENT_STATUSES = new Set(["preparing", "closing", "cleaning"]);

function defaultExamDeadline(projectTtlMinutes: number): Dayjs {
  // Keep clear of both server boundaries: at least one minute ahead and no
  // later than the configured maximum run measured from request time.
  const minutes = Math.max(2, Math.min(360, projectTtlMinutes - 1));
  return dayjs().add(minutes, "minute").startOf("minute");
}

function editableExamConfig(config: HostExamConfig): HostExamConfigInput {
  return {
    enabled: config.enabled,
    title: config.title,
    max_projects: config.max_projects,
    project_cpu: config.project_cpu,
    project_memory_mb: config.project_memory_mb,
    project_disk_mb: config.project_disk_mb,
    project_ttl_minutes: config.project_ttl_minutes,
    cleanup_grace_minutes: config.cleanup_grace_minutes,
    terminal_enabled: config.terminal_enabled,
    network_mode: "disabled",
  };
}

function sameExamConfig(
  left: HostExamConfigInput,
  right: HostExamConfigInput,
): boolean {
  return (
    left.enabled === right.enabled &&
    (left.title ?? "Exam Scratchpad").trim() ===
      (right.title ?? "Exam Scratchpad").trim() &&
    left.max_projects === right.max_projects &&
    left.project_cpu === right.project_cpu &&
    left.project_memory_mb === right.project_memory_mb &&
    left.project_disk_mb === right.project_disk_mb &&
    left.project_ttl_minutes === right.project_ttl_minutes &&
    left.cleanup_grace_minutes === right.cleanup_grace_minutes &&
    !!left.terminal_enabled === !!right.terminal_enabled &&
    (left.network_mode ?? "disabled") === (right.network_mode ?? "disabled")
  );
}

export type ExamHostCapacityAssessment = {
  level: "success" | "close" | "warning" | "unknown";
  recommendedCpu: number;
  recommendedRamGiB: number;
};

export function assessExamHostCapacity({
  maxProjects,
  cpu,
  ramGiB,
}: {
  maxProjects: number;
  cpu?: number;
  ramGiB?: number;
}): ExamHostCapacityAssessment {
  // The strict guidance is RAM (GB) > 3 + students / 2. Host sizes use
  // whole GiB, so round up to the smallest integer that satisfies it.
  const recommendedRamGiB = Math.floor(3 + Math.max(1, maxProjects) / 2) + 1;
  const recommendation = {
    recommendedCpu: RECOMMENDED_EXAM_CPU,
    recommendedRamGiB,
  };
  if (cpu == null || ramGiB == null) {
    return { level: "unknown", ...recommendation };
  }
  if (cpu >= RECOMMENDED_EXAM_CPU && ramGiB >= recommendedRamGiB) {
    return { level: "success", ...recommendation };
  }
  if (
    cpu < SUBSTANTIALLY_LOW_CPU ||
    ramGiB < recommendedRamGiB * SUBSTANTIALLY_LOW_RAM_RATIO
  ) {
    return { level: "warning", ...recommendation };
  }
  return { level: "close", ...recommendation };
}

function ExamHostCapacityAlert({
  host,
  maxProjects,
}: {
  host: Host;
  maxProjects: number;
}) {
  const cpu = getHostCpuCount(host);
  const ramGiB = getHostRamGiB(host);
  const assessment = assessExamHostCapacity({ maxProjects, cpu, ramGiB });
  const students = Math.max(1, maxProjects);
  const guidance = `For ${students} simultaneous students, we recommend at least ${assessment.recommendedCpu} vCPU and ${assessment.recommendedRamGiB} GB RAM.`;
  const actual =
    cpu != null && ramGiB != null
      ? ` This host has ${cpu} vCPU and ${ramGiB} GB RAM.`
      : " CoCalc cannot determine this host's CPU and RAM yet.";

  if (assessment.level === "success") {
    return (
      <Alert
        type="success"
        showIcon
        title="Host capacity meets the exam guideline"
        description={`${guidance}${actual}`}
      />
    );
  }
  if (assessment.level === "unknown") {
    return (
      <Alert
        type="info"
        showIcon
        title="Confirm host capacity before the exam"
        description={`${guidance}${actual} This advisory does not block exam setup.`}
      />
    );
  }
  if (assessment.level === "warning") {
    return (
      <Alert
        type="error"
        showIcon
        title="Host capacity is substantially below exam guidance"
        description={`${guidance}${actual} Resize the host or complete a representative full-load rehearsal before a live exam. This advisory does not block exam setup.`}
      />
    );
  }
  return (
    <Alert
      type="warning"
      showIcon
      title="Host capacity is below the recommended headroom"
      description={`${guidance}${actual} The workload may still fit, but complete a representative full-load rehearsal before the exam. This advisory does not block exam setup.`}
    />
  );
}

function idempotencyKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function statusColor(status?: string): string {
  switch (status) {
    case "open":
      return "green";
    case "ready":
      return "blue";
    case "preparing":
    case "cleaning":
    case "closing":
      return "orange";
    case "error":
      return "red";
    default:
      return "default";
  }
}

export function examRootfsCatalogEntries({
  cachedImages,
  catalogImages,
}: {
  cachedImages: HostRootfsImage[];
  catalogImages: RootfsImageEntry[];
}): RootfsImageEntry[] {
  const cached = cachedImages.filter((entry) => !!entry.digest);
  const used = new Set<string>();
  const entries: RootfsImageEntry[] = [];
  for (const catalog of catalogImages) {
    const match = cached.find(
      (entry) =>
        !used.has(entry.image) &&
        (entry.image === catalog.image ||
          (!!entry.release_id && entry.release_id === catalog.release_id)),
    );
    if (!match) continue;
    used.add(match.image);
    entries.push({ ...catalog, digest: match.digest ?? catalog.digest });
  }
  for (const entry of cached) {
    if (used.has(entry.image)) continue;
    const contentKey = managedRootfsContentKey(entry.image);
    entries.push({
      id: entry.release_id || entry.image,
      release_id: entry.release_id,
      image: entry.image,
      digest: entry.digest,
      label: contentKey
        ? `Cached RootFS ${contentKey.slice(0, 12)}…`
        : entry.image,
      description: "This immutable RootFS is cached on the project host.",
    });
  }
  return entries;
}

export function HostExamPanel({
  host,
  rootfsImages,
}: {
  host: Host;
  rootfsImages: HostRootfsImage[];
}) {
  const [state, setState] = useState<HostExamState>();
  const [config, setConfig] = useState<HostExamConfigInput>(DEFAULT_CONFIG);
  const [rootfsImage, setRootfsImage] = useState<string>();
  const [deadline, setDeadline] = useState<Dayjs>(() =>
    defaultExamDeadline(DEFAULT_CONFIG.project_ttl_minutes),
  );
  const [stopHostAtDeadline, setStopHostAtDeadline] = useState(true);
  const [runCapacity, setRunCapacity] = useState<number>();
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<"prepare">();
  const [error, setError] = useState("");
  const [rootfsSearch, setRootfsSearch] = useState("");
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction();
  const api = webapp_client.conat_client.hub.hosts;
  const {
    images: rootfsCatalog,
    loading: rootfsCatalogLoading,
    error: rootfsCatalogError,
  } = useRootfsImages([managedRootfsCatalogUrl()], { limit: 200 });
  const selectableRootfsImages = useMemo(
    () =>
      examRootfsCatalogEntries({
        cachedImages: rootfsImages,
        catalogImages: rootfsCatalog,
      }),
    [rootfsCatalog, rootfsImages],
  );

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const next = await api.getHostExamState({
        id: host.id,
        timeout: EXAM_STATE_TIMEOUT_MS,
      });
      setState(next);
      setToken(next.token ?? "");
      if (next.config) {
        setConfig(editableExamConfig(next.config));
      }
      if (next.run && next.run.status !== "stopped") {
        setRootfsImage(next.run.rootfs_image);
        setDeadline(dayjs(next.run.scheduled_stop_at));
        setStopHostAtDeadline(next.run.stop_host_at_deadline !== false);
        setRunCapacity(next.run.max_projects);
      } else {
        if (next.run?.rootfs_image) {
          setRootfsImage(next.run.rootfs_image);
        }
        setDeadline(
          defaultExamDeadline(
            next.config?.project_ttl_minutes ??
              DEFAULT_CONFIG.project_ttl_minutes,
          ),
        );
        setStopHostAtDeadline(true);
        setRunCapacity(undefined);
      }
    } catch (err) {
      setError(`${(err as Error)?.message ?? err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [host.id, host.status]);

  useEffect(() => {
    const status = state?.run?.status;
    if (loading || status == null || !EXAM_TRANSIENT_STATUSES.has(status)) {
      return;
    }
    const timer = window.setTimeout(() => {
      void refresh();
    }, EXAM_TRANSIENT_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [host.id, loading, state?.run?.status]);

  useEffect(() => {
    if (rootfsImage || rootfsImages.length === 0) return;
    setRootfsImage(rootfsImages.find((entry) => !!entry.digest)?.image);
  }, [rootfsImage, rootfsImages]);

  const mutate = async (
    action: () => Promise<HostExamState & { token?: string }>,
    actionName?: "prepare",
  ) => {
    setError("");
    try {
      const completed = await runFreshAuthAction(async () => {
        setPendingAction(actionName);
        setLoading(true);
        setError("");
        try {
          const next = await action();
          setState(next);
          setToken(next.token ?? "");
        } finally {
          setLoading(false);
          setPendingAction(undefined);
        }
      });
      if (completed) {
        message.success(
          actionName === "prepare"
            ? "Exam run prepared and tested"
            : "Exam host updated",
        );
      }
    } catch (err) {
      const text = `${(err as Error)?.message ?? err}`;
      await refresh();
      setError(text);
      message.error(text);
    }
  };

  const mutateIdempotently = (
    prefix: string,
    action: (
      idempotency_key: string,
    ) => Promise<HostExamState & { token?: string }>,
    actionName?: "prepare",
  ) => {
    // A fresh-auth challenge may invoke the action again after elevation. One
    // click is still one logical mutation, so every retry must reuse its key.
    const idempotency_key = idempotencyKey(prefix);
    return mutate(() => action(idempotency_key), actionName);
  };

  const run = state?.run;
  const runtime = state?.runtime;
  const hostStatus = state?.host_status ?? host.status;
  const hostRunning = hostStatus === "running";
  const hasActiveRun = !!run && run.status !== "stopped";
  const configDirty =
    state != null &&
    (!state.config ||
      !sameExamConfig(config, editableExamConfig(state.config)));
  const selectedRootfsIsReady = rootfsImages.some(
    (entry) => entry.image === rootfsImage && !!entry.digest,
  );
  const now = Date.now();
  const earliestDeadline = now + 60_000;
  const latestDeadline = now + config.project_ttl_minutes * 60_000;
  const deadlineTooSoon = deadline.valueOf() < earliestDeadline;
  const deadlineTooLate = deadline.valueOf() > latestDeadline;
  const prepareBlockers = [
    !config.enabled ? "Enable and save exam mode." : undefined,
    configDirty ? "Save the exam configuration changes." : undefined,
    !hostRunning ? "Start the project host." : undefined,
    !selectedRootfsIsReady
      ? "Select a cached RootFS that has a digest."
      : undefined,
    deadlineTooSoon
      ? "Choose a project-deletion time at least one minute in the future."
      : undefined,
    deadlineTooLate
      ? `Choose a project-deletion time within the configured ${config.project_ttl_minutes}-minute maximum run.`
      : undefined,
  ].filter((value): value is string => !!value);
  const canPrepare = !hasActiveRun && prepareBlockers.length === 0;
  const runScheduleDirty =
    !!run &&
    (dayjs(run.scheduled_stop_at).valueOf() !== deadline.valueOf() ||
      (run.stop_host_at_deadline !== false) !== stopHostAtDeadline);
  const requestedRunCapacity = runCapacity ?? run?.max_projects ?? 1;
  const studentUrl = state?.config?.hostname
    ? `https://${state.config.hostname}`
    : undefined;
  const admissionUrl =
    studentUrl && token
      ? `${studentUrl}/#token=${encodeURIComponent(token)}`
      : undefined;

  return (
    <Spin
      spinning={loading}
      tip={
        pendingAction === "prepare" ? (
          <Alert
            type="info"
            showIcon
            title="Preparing and testing the exam environment"
            description="Creating a smoke-test project, starting Jupyter, checking network isolation and cleanup, then erasing the test project. This usually takes about one minute."
            style={{ maxWidth: 560, textAlign: "left" }}
          />
        ) : undefined
      }
    >
      <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
        <Alert
          type="info"
          showIcon
          message="Ephemeral exam scratchpads"
          description={
            <>
              Students get anonymous local projects on this on-demand host.
              Outbound project networking is disabled. Existing private-host
              billing applies.
              <br />
              <Button
                icon={<BookOutlined />}
                onClick={() => openAppDocs("hosts/exam-scratchpads")}
                size="small"
                style={{ height: "auto", padding: 0 }}
                type="link"
              >
                Read the setup, testing, and cleanup guide.
              </Button>
            </>
          }
        />
        {error && <Alert type="error" showIcon message={error} />}
        {!hostRunning && (
          <Alert
            type="warning"
            showIcon
            title="Start the project host to prepare an exam"
            description={`The host is currently ${hostStatus || "unavailable"}. Saved exam configuration remains available, but preparation and live status checks require the host to be running.`}
          />
        )}
        {state && !state.eligible && (
          <Alert
            type="warning"
            showIcon
            message="Exam mode is not enabled for this account"
            description={state.eligibility_reason}
          />
        )}

        <Card size="small" title="Host configuration">
          <Space orientation="vertical" size="middle" style={{ width: "100%" }}>
            <Space wrap>
              <Switch
                checked={config.enabled}
                disabled={hasActiveRun || state?.eligible === false}
                onChange={(enabled) =>
                  setConfig((value) => ({ ...value, enabled }))
                }
              />
              <Typography.Text strong>Enable exam mode</Typography.Text>
            </Space>
            <label>
              Public scratchpad title
              <Input
                maxLength={100}
                value={config.title}
                placeholder="Exam Scratchpad"
                onChange={(event) =>
                  setConfig((value) => ({
                    ...value,
                    title: event.target.value,
                  }))
                }
              />
            </label>
            <Space wrap>
              <label>
                Maximum projects (students)
                <InputNumber
                  min={1}
                  max={1000}
                  value={config.max_projects}
                  onChange={(value) =>
                    setConfig((current) => ({
                      ...current,
                      max_projects: Number(value ?? 1),
                    }))
                  }
                />
              </label>
              <label>
                CPU per project
                <InputNumber
                  min={0.1}
                  max={128}
                  step={0.5}
                  value={config.project_cpu}
                  onChange={(value) =>
                    setConfig((current) => ({
                      ...current,
                      project_cpu: Number(value ?? 1),
                    }))
                  }
                />
              </label>
              <label>
                Memory (MB)
                <InputNumber
                  min={256}
                  value={config.project_memory_mb}
                  onChange={(value) =>
                    setConfig((current) => ({
                      ...current,
                      project_memory_mb: Number(value ?? 256),
                    }))
                  }
                />
              </label>
              <label>
                Disk (MB)
                <InputNumber
                  min={1000}
                  value={config.project_disk_mb}
                  onChange={(value) =>
                    setConfig((current) => ({
                      ...current,
                      project_disk_mb: Number(value ?? 1000),
                    }))
                  }
                />
              </label>
              <label>
                Maximum run (minutes)
                <InputNumber
                  min={180}
                  max={2880}
                  value={config.project_ttl_minutes}
                  onChange={(value) =>
                    setConfig((current) => ({
                      ...current,
                      project_ttl_minutes: Number(value ?? 180),
                    }))
                  }
                />
              </label>
              <label>
                Cleanup grace (minutes)
                <InputNumber
                  min={1}
                  max={60}
                  value={config.cleanup_grace_minutes}
                  onChange={(value) =>
                    setConfig((current) => ({
                      ...current,
                      cleanup_grace_minutes: Number(value ?? 10),
                    }))
                  }
                />
              </label>
            </Space>
            <ExamHostCapacityAlert
              host={host}
              maxProjects={config.max_projects}
            />
            <Space wrap>
              <Switch
                checked={config.terminal_enabled}
                onChange={(terminal_enabled) =>
                  setConfig((value) => ({ ...value, terminal_enabled }))
                }
              />
              <Typography.Text>
                Allow terminals (disabled by default)
              </Typography.Text>
            </Space>
            <Button
              type="primary"
              disabled={
                loading ||
                hasActiveRun ||
                state?.eligible === false ||
                !configDirty
              }
              onClick={() =>
                void mutate(() =>
                  api.setHostExamConfig({
                    id: host.id,
                    browser_id: webapp_client.browser_id,
                    config,
                    timeout: EXAM_MUTATION_TIMEOUT_MS,
                  }),
                )
              }
            >
              Save configuration
            </Button>
          </Space>
        </Card>

        {!hasActiveRun && (
          <Card size="small" title="Prepare an exam run">
            <Space
              orientation="vertical"
              size="middle"
              style={{ width: "100%" }}
            >
              <RootfsCatalogPicker
                images={selectableRootfsImages}
                selectedImage={rootfsImage}
                onSelect={(entry) => setRootfsImage(entry.image)}
                loading={
                  rootfsCatalogLoading && selectableRootfsImages.length === 0
                }
                disabled={loading || !hostRunning}
                search={rootfsSearch}
                onSearchChange={setRootfsSearch}
                searchPlaceholder="Search cached exam images..."
                emptyText="No cached RootFS images match this search. Cache an image on the host before preparing the exam."
                height={320}
              />
              {rootfsCatalogError && (
                <Typography.Text type="secondary">
                  Catalog metadata is unavailable; cached images are shown by
                  immutable reference. {rootfsCatalogError}
                </Typography.Text>
              )}
              <Space wrap align="center">
                <Typography.Text strong>
                  Delete all exam projects at
                </Typography.Text>
                <DatePicker
                  showTime
                  showNow={false}
                  value={deadline}
                  onChange={(value) => value && setDeadline(value)}
                  minDate={dayjs()}
                  status={
                    deadlineTooSoon || deadlineTooLate ? "error" : undefined
                  }
                />
              </Space>
              <Checkbox
                checked={stopHostAtDeadline}
                onChange={(event) =>
                  setStopHostAtDeadline(event.target.checked)
                }
              >
                Also shut down the project host to save resources
              </Checkbox>
              <Alert
                type="info"
                showIcon
                title="Preparation runs a complete rehearsal"
                description="Allow about one minute. CoCalc freezes the selected RootFS and limits, creates an isolated smoke-test project, starts Jupyter, verifies network isolation and cleanup, then erases the test project. Admission remains closed until you select Open admission."
              />
              {prepareBlockers.length > 0 && (
                <Alert
                  type="info"
                  showIcon
                  title="Complete these steps before preparing the run"
                  description={prepareBlockers.join(" ")}
                />
              )}
              <Button
                type="primary"
                loading={pendingAction === "prepare"}
                disabled={loading || !canPrepare}
                onClick={() => {
                  void mutateIdempotently(
                    "create",
                    (idempotency_key) =>
                      api.createHostExamRun({
                        id: host.id,
                        browser_id: webapp_client.browser_id,
                        rootfs_image: rootfsImage!,
                        scheduled_stop_at: deadline.toISOString(),
                        stop_host_at_deadline: stopHostAtDeadline,
                        idempotency_key,
                        timeout: EXAM_LIFECYCLE_TIMEOUT_MS,
                      }),
                    "prepare",
                  );
                }}
              >
                Prepare and test run
              </Button>
            </Space>
          </Card>
        )}

        {hasActiveRun && run && (
          <Card
            size="small"
            title={
              <Space>
                Current run
                <Tag color={statusColor(run.status)}>{run.status}</Tag>
              </Space>
            }
          >
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="Student URL">
                {studentUrl ? (
                  <Typography.Link href={studentUrl} target="_blank">
                    {studentUrl}
                  </Typography.Link>
                ) : (
                  "not configured"
                )}
              </Descriptions.Item>
              <Descriptions.Item label="RootFS">
                <code>{run.rootfs_image}</code>
              </Descriptions.Item>
              <Descriptions.Item label="All exam projects deleted at">
                {dayjs(run.scheduled_stop_at).format("YYYY-MM-DD HH:mm Z")}
              </Descriptions.Item>
              <Descriptions.Item label="Project host afterward">
                {run.stop_host_at_deadline !== false
                  ? "shuts down to save resources"
                  : "keeps running"}
              </Descriptions.Item>
              <Descriptions.Item label="Projects">
                {runtime?.active_projects ?? 0} / {run.max_projects}
              </Descriptions.Item>
              <Descriptions.Item label="Terminal">
                {run.terminal_enabled ? "allowed" : "disabled"}
              </Descriptions.Item>
              <Descriptions.Item label="Network">
                outbound disabled
              </Descriptions.Item>
            </Descriptions>
            {runtime?.readiness && (
              <Space wrap>
                {runtime.readiness.map((check) => (
                  <Tag key={check.name} color={check.ok ? "green" : "red"}>
                    {check.name}
                  </Tag>
                ))}
              </Space>
            )}
            {(run.status === "ready" || run.status === "open") && (
              <>
                <Divider />
                <Space
                  orientation="vertical"
                  size="small"
                  style={{ width: "100%" }}
                >
                  <Space wrap align="center">
                    <Typography.Text strong>
                      Maximum students for this run
                    </Typography.Text>
                    <InputNumber
                      aria-label="Maximum students for this run"
                      min={run.max_projects}
                      max={1_000}
                      precision={0}
                      value={requestedRunCapacity}
                      onChange={(value) =>
                        setRunCapacity(Number(value ?? run.max_projects))
                      }
                    />
                    <Button
                      disabled={
                        loading || requestedRunCapacity <= run.max_projects
                      }
                      onClick={() => {
                        void mutateIdempotently("capacity", (idempotency_key) =>
                          api.increaseHostExamCapacity({
                            id: host.id,
                            browser_id: webapp_client.browser_id,
                            run_id: run.run_id,
                            max_projects: requestedRunCapacity,
                            idempotency_key,
                            timeout: EXAM_MUTATION_TIMEOUT_MS,
                          }),
                        );
                      }}
                    >
                      Increase capacity
                    </Button>
                  </Space>
                  <Typography.Text type="secondary">
                    One student uses one temporary project. Capacity can be
                    increased immediately during an exam, but cannot be reduced.
                    The saved default remains{" "}
                    {state?.config?.max_projects ?? run.max_projects}.
                  </Typography.Text>
                  {requestedRunCapacity > run.max_projects && (
                    <ExamHostCapacityAlert
                      host={host}
                      maxProjects={requestedRunCapacity}
                    />
                  )}
                </Space>
              </>
            )}
            {token && (
              <>
                <Divider />
                <Space
                  orientation="vertical"
                  size="small"
                  style={{ width: "100%" }}
                >
                  <Alert
                    type="info"
                    title="Student admission"
                    description="Share the admission link when the exam opens. It prefills the token without sending it to the server in the URL. The token grants only one temporary project per student browser for this run."
                  />
                  {admissionUrl && (
                    <Input
                      aria-label="Student admission link"
                      value={admissionUrl}
                      readOnly
                      addonAfter={
                        <Button
                          type="text"
                          onClick={() =>
                            void navigator.clipboard.writeText(admissionUrl)
                          }
                        >
                          Copy link
                        </Button>
                      }
                    />
                  )}
                  <Typography.Text type="secondary">
                    Manual token
                  </Typography.Text>
                  <Input
                    aria-label="Manual exam token"
                    value={token}
                    readOnly
                    addonAfter={
                      <Button
                        type="text"
                        onClick={() =>
                          void navigator.clipboard.writeText(token)
                        }
                      >
                        Copy token
                      </Button>
                    }
                  />
                </Space>
              </>
            )}
            <Divider />
            <Space wrap>
              {run.status === "ready" && (
                <>
                  <Button
                    type="primary"
                    disabled={loading}
                    onClick={() => {
                      void mutateIdempotently("open", (idempotency_key) =>
                        api.openHostExamRun({
                          id: host.id,
                          browser_id: webapp_client.browser_id,
                          run_id: run.run_id,
                          idempotency_key,
                          timeout: EXAM_MUTATION_TIMEOUT_MS,
                        }),
                      );
                    }}
                  >
                    Open admission
                  </Button>
                  <Button
                    disabled={loading}
                    onClick={() => {
                      void mutateIdempotently("rotate", (idempotency_key) =>
                        api.rotateHostExamToken({
                          id: host.id,
                          browser_id: webapp_client.browser_id,
                          run_id: run.run_id,
                          idempotency_key,
                          timeout: EXAM_MUTATION_TIMEOUT_MS,
                        }),
                      );
                    }}
                  >
                    Rotate token
                  </Button>
                </>
              )}
              {(run.status === "ready" || run.status === "open") && (
                <>
                  <Space wrap align="center">
                    <Typography.Text strong>
                      Delete all exam projects at
                    </Typography.Text>
                    <DatePicker
                      showTime
                      showNow={false}
                      value={deadline}
                      onChange={(value) => value && setDeadline(value)}
                      minDate={dayjs()}
                      status={
                        deadlineTooSoon || deadlineTooLate ? "error" : undefined
                      }
                    />
                  </Space>
                  <Checkbox
                    checked={stopHostAtDeadline}
                    onChange={(event) =>
                      setStopHostAtDeadline(event.target.checked)
                    }
                  >
                    Also shut down the project host to save resources
                  </Checkbox>
                  <Button
                    disabled={
                      loading ||
                      !runScheduleDirty ||
                      deadlineTooSoon ||
                      deadlineTooLate
                    }
                    onClick={() => {
                      void mutateIdempotently("deadline", (idempotency_key) =>
                        api.updateHostExamDeadline({
                          id: host.id,
                          browser_id: webapp_client.browser_id,
                          run_id: run.run_id,
                          scheduled_stop_at: deadline.toISOString(),
                          stop_host_at_deadline: stopHostAtDeadline,
                          idempotency_key,
                          timeout: EXAM_MUTATION_TIMEOUT_MS,
                        }),
                      );
                    }}
                  >
                    Update cleanup time
                  </Button>
                </>
              )}
              {run.status !== "stopped" && (
                <Popconfirm
                  title={
                    stopHostAtDeadline
                      ? "Erase all exam projects and shut down this host?"
                      : "Erase all exam projects now?"
                  }
                  description={
                    stopHostAtDeadline
                      ? "This permanently deletes every temporary exam project, then shuts down the project host."
                      : "This permanently deletes every temporary exam project but leaves the project host running."
                  }
                  okText={stopHostAtDeadline ? "Erase and shut down" : "Erase"}
                  okButtonProps={{ danger: true, disabled: loading }}
                  onConfirm={() =>
                    mutateIdempotently("stop", (idempotency_key) =>
                      api.stopAndEraseHostExamRun({
                        id: host.id,
                        browser_id: webapp_client.browser_id,
                        run_id: run.run_id,
                        stop_host: stopHostAtDeadline,
                        idempotency_key,
                        timeout: EXAM_LIFECYCLE_TIMEOUT_MS,
                      }),
                    )
                  }
                >
                  <Button danger disabled={loading}>
                    End exam and erase now
                  </Button>
                </Popconfirm>
              )}
            </Space>
          </Card>
        )}
        <Button onClick={() => void refresh()}>Refresh status</Button>
      </Space>
      <FreshAuthModal {...freshAuthModalProps} />
    </Spin>
  );
}
