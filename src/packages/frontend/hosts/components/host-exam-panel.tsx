/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Divider,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import { BookOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useState } from "@cocalc/frontend/app-framework";
import type {
  Host,
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

const DEFAULT_CONFIG: HostExamConfigInput = {
  enabled: false,
  max_projects: 100,
  project_cpu: 1,
  project_memory_mb: 2_000,
  project_disk_mb: 5_000,
  project_ttl_minutes: 360,
  cleanup_grace_minutes: 10,
  terminal_enabled: false,
  network_mode: "disabled",
};

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
  const [deadline, setDeadline] = useState<Dayjs>(
    dayjs().add(6, "hour").startOf("minute"),
  );
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction();
  const api = webapp_client.conat_client.hub.hosts;

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const next = await api.getHostExamState({ id: host.id });
      setState(next);
      if (next.config) {
        setConfig({
          enabled: next.config.enabled,
          max_projects: next.config.max_projects,
          project_cpu: next.config.project_cpu,
          project_memory_mb: next.config.project_memory_mb,
          project_disk_mb: next.config.project_disk_mb,
          project_ttl_minutes: next.config.project_ttl_minutes,
          cleanup_grace_minutes: next.config.cleanup_grace_minutes,
          terminal_enabled: next.config.terminal_enabled,
          network_mode: "disabled",
        });
      }
      if (next.run) {
        setRootfsImage(next.run.rootfs_image);
        setDeadline(dayjs(next.run.scheduled_stop_at));
      }
    } catch (err) {
      setError(`${(err as Error)?.message ?? err}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [host.id]);

  useEffect(() => {
    if (rootfsImage || rootfsImages.length === 0) return;
    setRootfsImage(rootfsImages[0].image);
  }, [rootfsImage, rootfsImages]);

  const mutate = async (
    action: () => Promise<HostExamState & { token?: string }>,
  ) => {
    setError("");
    try {
      const completed = await runFreshAuthAction(async () => {
        setLoading(true);
        setError("");
        try {
          const next = await action();
          setState(next);
          if (next.token) setToken(next.token);
        } finally {
          setLoading(false);
        }
      });
      if (completed) {
        message.success("Exam host updated");
      }
    } catch (err) {
      setError(`${(err as Error)?.message ?? err}`);
    }
  };

  const run = state?.run;
  const runtime = state?.runtime;
  const hasActiveRun = !!run && run.status !== "stopped";
  const canPrepare =
    config.enabled &&
    host.status === "running" &&
    !hasActiveRun &&
    !!rootfsImage &&
    deadline.valueOf() > Date.now();

  return (
    <Spin spinning={loading}>
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
            <Space wrap>
              <label>
                Maximum projects
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
              disabled={hasActiveRun || state?.eligible === false}
              onClick={() =>
                void mutate(() =>
                  api.setHostExamConfig({
                    id: host.id,
                    browser_id: webapp_client.browser_id,
                    config,
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
              <Select
                style={{ width: "100%" }}
                value={rootfsImage}
                placeholder="Select a cached RootFS"
                onChange={setRootfsImage}
                options={rootfsImages
                  .filter((entry) => !!entry.digest)
                  .map((entry) => ({
                    value: entry.image,
                    label: `${entry.image} (${entry.digest?.slice(0, 18)}...)`,
                  }))}
              />
              <DatePicker
                showTime
                value={deadline}
                onChange={(value) => value && setDeadline(value)}
                minDate={dayjs()}
              />
              <Button
                type="primary"
                disabled={!canPrepare}
                onClick={() =>
                  void mutate(() =>
                    api.createHostExamRun({
                      id: host.id,
                      browser_id: webapp_client.browser_id,
                      rootfs_image: rootfsImage!,
                      scheduled_stop_at: deadline.toISOString(),
                      idempotency_key: idempotencyKey("create"),
                    }),
                  )
                }
              >
                Prepare and test run
              </Button>
            </Space>
          </Card>
        )}

        {run && (
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
                {state?.config?.hostname ? (
                  <Typography.Link
                    href={`https://${state.config.hostname}`}
                    target="_blank"
                  >
                    https://{state.config.hostname}
                  </Typography.Link>
                ) : (
                  "not configured"
                )}
              </Descriptions.Item>
              <Descriptions.Item label="RootFS">
                <code>{run.rootfs_image}</code>
              </Descriptions.Item>
              <Descriptions.Item label="Deadline">
                {dayjs(run.scheduled_stop_at).format("YYYY-MM-DD HH:mm Z")}
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
            {token && (
              <>
                <Divider />
                <Alert
                  type="warning"
                  message="Shared token"
                  description="This plaintext is shown only after creation or rotation. Store it securely before leaving this page."
                />
                <Input.Password
                  value={token}
                  readOnly
                  visibilityToggle
                  addonAfter={
                    <Button
                      type="text"
                      onClick={() => void navigator.clipboard.writeText(token)}
                    >
                      Copy
                    </Button>
                  }
                />
              </>
            )}
            <Divider />
            <Space wrap>
              {run.status === "ready" && (
                <>
                  <Button
                    type="primary"
                    onClick={() =>
                      void mutate(() =>
                        api.openHostExamRun({
                          id: host.id,
                          browser_id: webapp_client.browser_id,
                          run_id: run.run_id,
                          idempotency_key: idempotencyKey("open"),
                        }),
                      )
                    }
                  >
                    Open admission
                  </Button>
                  <Button
                    onClick={() =>
                      void mutate(() =>
                        api.rotateHostExamToken({
                          id: host.id,
                          browser_id: webapp_client.browser_id,
                          run_id: run.run_id,
                          idempotency_key: idempotencyKey("rotate"),
                        }),
                      )
                    }
                  >
                    Rotate token
                  </Button>
                </>
              )}
              {(run.status === "ready" || run.status === "open") && (
                <>
                  <DatePicker
                    showTime
                    value={deadline}
                    onChange={(value) => value && setDeadline(value)}
                    minDate={dayjs()}
                  />
                  <Button
                    onClick={() =>
                      void mutate(() =>
                        api.updateHostExamDeadline({
                          id: host.id,
                          browser_id: webapp_client.browser_id,
                          run_id: run.run_id,
                          scheduled_stop_at: deadline.toISOString(),
                          idempotency_key: idempotencyKey("deadline"),
                        }),
                      )
                    }
                  >
                    Update deadline
                  </Button>
                </>
              )}
              {run.status !== "stopped" && (
                <Popconfirm
                  title="Erase all exam projects and stop this host?"
                  description="This permanently deletes every temporary exam project."
                  okText="Erase and stop"
                  okButtonProps={{ danger: true }}
                  onConfirm={() =>
                    mutate(() =>
                      api.stopAndEraseHostExamRun({
                        id: host.id,
                        browser_id: webapp_client.browser_id,
                        run_id: run.run_id,
                        stop_host: true,
                        idempotency_key: idempotencyKey("stop"),
                      }),
                    )
                  }
                >
                  <Button danger>Stop and erase now</Button>
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
