/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Input,
  Modal,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";

import {
  CopyToClipBoard,
  ErrorDisplay,
  TimeAgo,
} from "@cocalc/frontend/components";
import {
  FreshAuthModal,
  useFreshAuthAction,
} from "@cocalc/frontend/auth/fresh-auth";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import type {
  LegacyMigrationAdminAccountSummary,
  LegacyMigrationAdminLinkSummary,
  LegacyMigrationAdminProjectAccountCandidate,
  LegacyMigrationAdminProjectSummary,
} from "@cocalc/conat/hub/api/legacy-migration";

const { Text, Paragraph } = Typography;

function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}...${id.slice(-4)}`;
}

function formatDiskMb(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`;
  return `${Math.ceil(value)} MB`;
}

function renderDate(value?: Date | string | null) {
  if (!value) return <Text type="secondary">unknown</Text>;
  return <TimeAgo date={value} />;
}

function legacyAccountDisplayName(
  account: Pick<
    LegacyMigrationAdminAccountSummary,
    "display_name" | "first_name" | "last_name" | "email_address"
  >,
): string {
  return (
    account.display_name ||
    [account.first_name, account.last_name].filter(Boolean).join(" ") ||
    account.email_address ||
    "No legacy name/email"
  );
}

function AccountIdentity({
  account,
}: {
  account: Pick<
    LegacyMigrationAdminAccountSummary,
    | "legacy_account_id"
    | "email_address"
    | "first_name"
    | "last_name"
    | "display_name"
    | "project_count"
    | "target_claim_methods"
    | "support_admin_linked_account_ids"
  >;
}) {
  return (
    <Space direction="vertical" size={0}>
      <Space wrap>
        <Text code>{account.legacy_account_id}</Text>
        <CopyToClipBoard value={account.legacy_account_id} />
        {account.target_claim_methods.map((method) => (
          <Tag
            key={method}
            color={method === "support-admin" ? "blue" : undefined}
          >
            {method}
          </Tag>
        ))}
        {account.support_admin_linked_account_ids.length > 0 && (
          <Tag color="orange">support-linked elsewhere</Tag>
        )}
      </Space>
      <Text>{legacyAccountDisplayName(account)}</Text>
      {account.email_address && (
        <Text type="secondary">{account.email_address}</Text>
      )}
      <Text type="secondary">
        {account.project_count == null
          ? "Project count not loaded"
          : `${account.project_count} visible project(s)`}
      </Text>
    </Space>
  );
}

function projectCandidateAccounts(
  project: LegacyMigrationAdminProjectSummary,
): LegacyMigrationAdminProjectAccountCandidate[] {
  const candidates = project.candidate_legacy_accounts;
  if (candidates != null && candidates.length > 0) {
    return candidates;
  }
  return project.candidate_legacy_account_ids.map((legacy_account_id) => ({
    legacy_account_id,
    role:
      legacy_account_id === project.owner_legacy_account_id
        ? "owner"
        : "collaborator",
    target_claim_methods: [],
    support_admin_linked_account_ids: [],
  }));
}

function ProjectsTable({
  projects,
}: {
  projects: LegacyMigrationAdminProjectSummary[];
}) {
  return (
    <Table
      size="small"
      rowKey="legacy_project_id"
      pagination={{ pageSize: 25 }}
      dataSource={projects}
      columns={[
        {
          title: "Project",
          key: "project",
          render: (_, project) => (
            <Space direction="vertical" size={0}>
              <Text strong>{project.title}</Text>
              <Space wrap>
                <Text code>{project.legacy_project_id}</Text>
                {project.name && <Text type="secondary">{project.name}</Text>}
              </Space>
            </Space>
          ),
        },
        {
          title: "Owner",
          key: "owner",
          render: (_, project) => (
            <Space direction="vertical" size={0}>
              {project.owner_legacy_account_id ? (
                <Text code>{shortId(project.owner_legacy_account_id)}</Text>
              ) : (
                <Text type="secondary">unknown</Text>
              )}
              {project.owner_display_name && (
                <Text type="secondary">{project.owner_display_name}</Text>
              )}
            </Space>
          ),
        },
        {
          title: "Last edited",
          dataIndex: "last_edited",
          render: renderDate,
        },
        {
          title: "Size",
          dataIndex: "disk_mb",
          render: formatDiskMb,
        },
        {
          title: "Status",
          key: "status",
          render: (_, project) => (
            <Space wrap>
              <Tag>{project.artifact_status ?? "unknown archive"}</Tag>
              <Tag>{project.import_status}</Tag>
              {project.restore_status && <Tag>{project.restore_status}</Tag>}
              {project.joined && <Tag color="green">joined</Tag>}
            </Space>
          ),
        },
      ]}
    />
  );
}

export function LegacyMigrationAdmin({ account_id }: { account_id: string }) {
  const [links, setLinks] = useState<LegacyMigrationAdminLinkSummary[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [accountQuery, setAccountQuery] = useState("");
  const [accountResults, setAccountResults] = useState<
    LegacyMigrationAdminAccountSummary[]
  >([]);
  const [accountSearching, setAccountSearching] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectResults, setProjectResults] = useState<
    LegacyMigrationAdminProjectSummary[]
  >([]);
  const [projectSearching, setProjectSearching] = useState(false);
  const [linkTarget, setLinkTarget] = useState<{
    legacy_account_id: string;
    label?: string;
    evidence?: Record<string, unknown>;
  } | null>(null);
  const [unlinkTarget, setUnlinkTarget] =
    useState<LegacyMigrationAdminLinkSummary | null>(null);
  const [reason, setReason] = useState("");
  const [supportReference, setSupportReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [projectLists, setProjectLists] = useState<
    Record<
      string,
      {
        loading?: boolean;
        error?: string;
        projects?: LegacyMigrationAdminProjectSummary[];
        total_count?: number;
        limit?: number;
      }
    >
  >({});
  const [expandedLegacyAccountIds, setExpandedLegacyAccountIds] = useState<
    string[]
  >([]);
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction();

  const refreshLinks = async () => {
    setLinksLoading(true);
    setError("");
    try {
      const result =
        await webapp_client.conat_client.hub.legacyMigration.adminListLegacyAccountLinks(
          { target_account_id: account_id },
        );
      setLinks(result.links);
    } catch (err) {
      setError(`${err}`);
    } finally {
      setLinksLoading(false);
    }
  };

  useEffect(() => {
    void refreshLinks();
  }, [account_id]);

  const searchAccounts = async (query = accountQuery) => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setError("Enter at least 2 characters to search legacy accounts.");
      return;
    }
    setAccountSearching(true);
    setError("");
    try {
      const result =
        await webapp_client.conat_client.hub.legacyMigration.adminSearchLegacyAccounts(
          { target_account_id: account_id, query: trimmed },
        );
      setAccountResults(result.accounts);
    } catch (err) {
      setError(`${err}`);
    } finally {
      setAccountSearching(false);
    }
  };

  const searchProjects = async (query = projectQuery) => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setError("Enter at least 2 characters to search legacy projects.");
      return;
    }
    setProjectSearching(true);
    setError("");
    try {
      const result =
        await webapp_client.conat_client.hub.legacyMigration.adminSearchLegacyProjects(
          { target_account_id: account_id, query: trimmed },
        );
      setProjectResults(result.projects);
    } catch (err) {
      setError(`${err}`);
    } finally {
      setProjectSearching(false);
    }
  };

  const openLink = ({
    legacy_account_id,
    label,
    evidence,
  }: {
    legacy_account_id: string;
    label?: string;
    evidence?: Record<string, unknown>;
  }) => {
    setLinkTarget({ legacy_account_id, label, evidence });
    setReason("");
    setSupportReference("");
    setError("");
  };

  const closeLink = () => {
    setLinkTarget(null);
    setReason("");
    setSupportReference("");
  };

  const linkLegacyAccount = async () => {
    if (!linkTarget) return;
    const auditReason = reason.trim();
    if (!auditReason) {
      setError("Enter a reason for the audit log.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const completed = await runFreshAuthAction(async () => {
        const result =
          await webapp_client.conat_client.hub.legacyMigration.adminLinkLegacyAccount(
            {
              target_account_id: account_id,
              legacy_account_id: linkTarget.legacy_account_id,
              reason: auditReason,
              support_reference: supportReference.trim() || undefined,
              evidence: linkTarget.evidence,
              browser_id: webapp_client.browser_id,
            },
          );
        if (result.warnings.length > 0) {
          message.warning(result.warnings.join("; "));
        } else {
          message.success("Legacy account linked.");
        }
      });
      if (completed) {
        closeLink();
        await refreshLinks();
        if (accountQuery.trim()) void searchAccounts();
        if (projectQuery.trim()) void searchProjects();
      }
    } catch (err) {
      setError(`${err}`);
    } finally {
      setSaving(false);
    }
  };

  const unlinkLegacyAccount = async () => {
    if (!unlinkTarget) return;
    const auditReason = reason.trim();
    if (!auditReason) {
      setError("Enter a reason for the audit log.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const completed = await runFreshAuthAction(async () => {
        await webapp_client.conat_client.hub.legacyMigration.adminUnlinkLegacyAccount(
          {
            target_account_id: account_id,
            legacy_account_id: unlinkTarget.legacy_account_id,
            reason: auditReason,
            support_reference: supportReference.trim() || undefined,
            browser_id: webapp_client.browser_id,
          },
        );
        message.success("Legacy account unlinked.");
      });
      if (completed) {
        setUnlinkTarget(null);
        setReason("");
        setSupportReference("");
        await refreshLinks();
        if (accountQuery.trim()) void searchAccounts();
        if (projectQuery.trim()) void searchProjects();
      }
    } catch (err) {
      setError(`${err}`);
    } finally {
      setSaving(false);
    }
  };

  const loadProjects = async (legacy_account_id: string) => {
    setExpandedLegacyAccountIds((ids) =>
      ids.includes(legacy_account_id) ? ids : [...ids, legacy_account_id],
    );
    setProjectLists((state) => ({
      ...state,
      [legacy_account_id]: { ...state[legacy_account_id], loading: true },
    }));
    try {
      const result =
        await webapp_client.conat_client.hub.legacyMigration.adminListLinkedLegacyProjects(
          {
            target_account_id: account_id,
            legacy_account_id,
            limit: 250,
          },
        );
      setProjectLists((state) => ({
        ...state,
        [legacy_account_id]: {
          projects: result.projects,
          total_count: result.total_count,
          limit: result.limit,
        },
      }));
    } catch (err) {
      setProjectLists((state) => ({
        ...state,
        [legacy_account_id]: { error: `${err}` },
      }));
    }
  };

  const renderLinkActions = (account: LegacyMigrationAdminAccountSummary) => {
    if (account.target_claim_methods.length > 0) {
      return <Tag color="green">Linked</Tag>;
    }
    return (
      <Button
        size="small"
        type="primary"
        onClick={() =>
          openLink({
            legacy_account_id: account.legacy_account_id,
            label: account.display_name ?? account.email_address ?? undefined,
            evidence: {
              kind: "account-search",
              query: accountQuery.trim(),
            },
          })
        }
      >
        Link
      </Button>
    );
  };

  const linkedProjectsPanel = (link: LegacyMigrationAdminLinkSummary) => {
    const state = projectLists[link.legacy_account_id];
    if (!state)
      return (
        <Alert
          type="info"
          message="Click Load projects to show projects for this legacy account."
        />
      );
    if (state.loading)
      return <Alert type="info" message="Loading projects..." />;
    if (state.error) return <Alert type="error" message={state.error} />;
    const projects = state.projects ?? [];
    return (
      <Space direction="vertical" style={{ width: "100%" }}>
        {state.total_count != null &&
          state.limit != null &&
          state.total_count > projects.length && (
            <Alert
              type="warning"
              showIcon
              message={`Showing ${projects.length} of ${state.total_count} projects.`}
              description={`The admin view is capped at ${state.limit} projects for this linked legacy account.`}
            />
          )}
        <ProjectsTable projects={projects} />
      </Space>
    );
  };

  return (
    <Card title="Legacy Migration Support">
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Alert
          showIcon
          type="warning"
          message="Admin-only support tool"
          description="Linking a legacy account allows this current account to see and migrate projects associated with that legacy account. Link and unlink actions require a reason and are audited."
        />
        {error && <ErrorDisplay error={error} onClose={() => setError("")} />}
        <Card
          size="small"
          title="Linked legacy accounts"
          extra={
            <Button size="small" loading={linksLoading} onClick={refreshLinks}>
              Refresh
            </Button>
          }
        >
          <Table
            size="small"
            rowKey="legacy_account_id"
            loading={linksLoading}
            dataSource={links}
            expandable={{
              expandedRowRender: linkedProjectsPanel,
              expandedRowKeys: expandedLegacyAccountIds,
              onExpandedRowsChange: (keys) =>
                setExpandedLegacyAccountIds(keys.map(String)),
            }}
            columns={[
              {
                title: "Legacy account",
                key: "legacy_account",
                render: (_, link) => <AccountIdentity account={link} />,
              },
              {
                title: "Method",
                dataIndex: "claim_method",
                render: (method) => (
                  <Tag color={method === "support-admin" ? "blue" : undefined}>
                    {method}
                  </Tag>
                ),
              },
              {
                title: "Updated",
                dataIndex: "updated",
                render: renderDate,
              },
              {
                title: "Actions",
                key: "actions",
                render: (_, link) => (
                  <Space wrap>
                    <Button
                      size="small"
                      onClick={() => loadProjects(link.legacy_account_id)}
                    >
                      Load projects
                    </Button>
                    {link.claim_method === "support-admin" ? (
                      <Button
                        size="small"
                        danger
                        onClick={() => {
                          setUnlinkTarget(link);
                          setReason("");
                          setSupportReference("");
                        }}
                      >
                        Unlink
                      </Button>
                    ) : (
                      <Tag>read-only</Tag>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </Card>
        <Tabs
          items={[
            {
              key: "accounts",
              label: "Account search",
              children: (
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Input.Search
                    value={accountQuery}
                    onChange={(e) => setAccountQuery(e.target.value)}
                    onSearch={(value) => searchAccounts(value)}
                    enterButton="Search legacy accounts"
                    placeholder="Search by legacy email, leading name text, or legacy account id"
                    loading={accountSearching}
                  />
                  <Table
                    size="small"
                    rowKey="legacy_account_id"
                    loading={accountSearching}
                    dataSource={accountResults}
                    columns={[
                      {
                        title: "Legacy account",
                        key: "legacy_account",
                        render: (_, account) => (
                          <AccountIdentity account={account} />
                        ),
                      },
                      {
                        title: "Last active",
                        dataIndex: "last_active",
                        render: renderDate,
                      },
                      {
                        title: "Action",
                        key: "action",
                        render: (_, account) => renderLinkActions(account),
                      },
                    ]}
                  />
                </Space>
              ),
            },
            {
              key: "projects",
              label: "Project search",
              children: (
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Input.Search
                    value={projectQuery}
                    onChange={(e) => setProjectQuery(e.target.value)}
                    onSearch={(value) => searchProjects(value)}
                    enterButton="Search legacy projects"
                    placeholder="Search by leading legacy project title, URL name, or legacy project id"
                    loading={projectSearching}
                  />
                  <Table
                    size="small"
                    rowKey="legacy_project_id"
                    loading={projectSearching}
                    dataSource={projectResults}
                    columns={[
                      {
                        title: "Project",
                        key: "project",
                        render: (_, project) => (
                          <Space direction="vertical" size={0}>
                            <Text strong>{project.title}</Text>
                            <Space wrap>
                              <Text code>{project.legacy_project_id}</Text>
                              {project.name && (
                                <Text type="secondary">{project.name}</Text>
                              )}
                            </Space>
                          </Space>
                        ),
                      },
                      {
                        title: "Candidates",
                        key: "candidates",
                        render: (_, project) => (
                          <Space direction="vertical" size={4}>
                            {projectCandidateAccounts(project).map(
                              (candidate) => (
                                <Space
                                  key={candidate.legacy_account_id}
                                  direction="vertical"
                                  size={0}
                                >
                                  <Space wrap>
                                    <Button
                                      size="small"
                                      disabled={
                                        project.target_claim_methods.length > 0
                                      }
                                      onClick={() =>
                                        openLink({
                                          legacy_account_id:
                                            candidate.legacy_account_id,
                                          label:
                                            legacyAccountDisplayName(
                                              candidate,
                                            ) || project.title,
                                          evidence: {
                                            kind: "project-search",
                                            query: projectQuery.trim(),
                                            legacy_project_id:
                                              project.legacy_project_id,
                                          },
                                        })
                                      }
                                    >
                                      Link{" "}
                                      {shortId(candidate.legacy_account_id)}
                                    </Button>
                                    <Tag>{candidate.role}</Tag>
                                    {candidate.target_claim_methods.map(
                                      (method) => (
                                        <Tag key={method} color="green">
                                          {method}
                                        </Tag>
                                      ),
                                    )}
                                    {candidate.support_admin_linked_account_ids
                                      .length > 0 && (
                                      <Tag color="orange">
                                        support-linked elsewhere
                                      </Tag>
                                    )}
                                  </Space>
                                  <Text>
                                    {legacyAccountDisplayName(candidate)}
                                  </Text>
                                  {candidate.email_address && (
                                    <Text type="secondary">
                                      {candidate.email_address}
                                    </Text>
                                  )}
                                  <Text code>
                                    {candidate.legacy_account_id}
                                  </Text>
                                </Space>
                              ),
                            )}
                            {project.target_claim_methods.length > 0 && (
                              <Tag color="green">
                                Already linked through{" "}
                                {project.target_claim_methods.join(", ")}
                              </Tag>
                            )}
                          </Space>
                        ),
                      },
                      {
                        title: "Last edited",
                        dataIndex: "last_edited",
                        render: renderDate,
                      },
                      {
                        title: "Size",
                        dataIndex: "disk_mb",
                        render: formatDiskMb,
                      },
                      {
                        title: "Status",
                        key: "status",
                        render: (_, project) => (
                          <Space wrap>
                            <Tag>{project.artifact_status ?? "unknown"}</Tag>
                            <Tag>{project.import_status}</Tag>
                          </Space>
                        ),
                      },
                    ]}
                  />
                </Space>
              ),
            },
          ]}
        />
      </Space>
      <Modal
        open={linkTarget != null}
        title="Link legacy account"
        okText="Link legacy account"
        okButtonProps={{ disabled: !reason.trim() }}
        confirmLoading={saving}
        onOk={linkLegacyAccount}
        onCancel={closeLink}
      >
        {linkTarget && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert
              showIcon
              type="warning"
              message="This grants migration access"
              description="The selected current account will be able to see and migrate projects associated with this legacy account."
            />
            <Paragraph>
              Legacy account: <Text code>{linkTarget.legacy_account_id}</Text>{" "}
              <CopyToClipBoard value={linkTarget.legacy_account_id} />
            </Paragraph>
            {linkTarget.label && <Paragraph>{linkTarget.label}</Paragraph>}
            <Input.TextArea
              rows={4}
              value={reason}
              maxLength={4000}
              showCount
              onChange={(e) => setReason(e.target.value)}
              placeholder="Required audit reason"
            />
            <Input
              value={supportReference}
              onChange={(e) => setSupportReference(e.target.value)}
              placeholder="Optional support ticket/reference"
            />
          </Space>
        )}
      </Modal>
      <Modal
        open={unlinkTarget != null}
        title="Unlink legacy account"
        okText="Unlink legacy account"
        okButtonProps={{ danger: true, disabled: !reason.trim() }}
        confirmLoading={saving}
        onOk={unlinkLegacyAccount}
        onCancel={() => setUnlinkTarget(null)}
      >
        {unlinkTarget && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert
              showIcon
              type="warning"
              message="This removes future migration authorization"
              description="Already imported projects are not deleted. Only support-admin links can be removed here; verified-email links are read-only."
            />
            <Paragraph>
              Legacy account: <Text code>{unlinkTarget.legacy_account_id}</Text>
            </Paragraph>
            <Input.TextArea
              rows={4}
              value={reason}
              maxLength={4000}
              showCount
              onChange={(e) => setReason(e.target.value)}
              placeholder="Required audit reason"
            />
            <Input
              value={supportReference}
              onChange={(e) => setSupportReference(e.target.value)}
              placeholder="Optional support ticket/reference"
            />
          </Space>
        )}
      </Modal>
      <FreshAuthModal {...freshAuthModalProps} />
    </Card>
  );
}
