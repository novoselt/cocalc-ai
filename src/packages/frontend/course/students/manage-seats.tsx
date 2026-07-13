/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  Alert,
  Button,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from "antd";
import { useEffect, useMemo, useState } from "react";

import type { MembershipPackageDetails } from "@cocalc/conat/hub/api/purchases";
import {
  FreshAuthModal,
  useFreshAuthAction,
} from "@cocalc/frontend/auth/fresh-auth";
import { Icon, TimeAgo } from "@cocalc/frontend/components";
import {
  assignMembershipPackageSeat,
  revokeMembershipPackageSeat,
} from "@cocalc/frontend/purchases/api";
import { trunc_middle } from "@cocalc/util/misc";
import { COLORS } from "@cocalc/util/theme";
import {
  getActiveMembershipPackageAssignmentForStudent,
  isMembershipPackageCurrentlyActive,
} from "../membership-packages";

const { Paragraph, Text } = Typography;

export interface ManageSeatsStudent {
  student_id: string;
  account_id?: string;
  project_id?: string;
  display_name?: string;
  email_address?: string;
}

interface ManageSeatsProps {
  open: boolean;
  onClose: () => void;
  courseProjectId: string;
  courseTitle: string;
  coursePath: string;
  packages: MembershipPackageDetails[];
  students: ManageSeatsStudent[];
  currentAccountId?: string;
  isAdmin: boolean;
  ownerName: (account_id: string) => string;
  onRefresh: () => Promise<void>;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  f: (item: T) => Promise<void>,
): Promise<unknown[]> {
  const failures: unknown[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) {
          return;
        }
        try {
          await f(items[index]);
        } catch (err) {
          failures.push(err);
        }
      }
    }),
  );
  return failures;
}

export function ManageSeats({
  open,
  onClose,
  courseProjectId,
  courseTitle,
  coursePath,
  packages,
  students,
  currentAccountId,
  isAdmin,
  ownerName,
  onRefresh,
}: ManageSeatsProps) {
  const [packageId, setPackageId] = useState<string>();
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [completed, setCompleted] = useState<number>(0);
  const [total, setTotal] = useState<number>(0);
  const [error, setError] = useState<string>("");
  const { runFreshAuthAction, freshAuthModalProps } = useFreshAuthAction();

  const manageablePackages = useMemo(
    () =>
      packages.filter(
        (membershipPackage) =>
          isAdmin || membershipPackage.owner_account_id === currentAccountId,
      ),
    [currentAccountId, isAdmin, packages],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const packageStillExists = packages.some(
      (membershipPackage) => membershipPackage.id === packageId,
    );
    if (!packageStillExists) {
      setPackageId((manageablePackages[0] ?? packages[0])?.id);
    }
    setSelectedStudentIds([]);
    setError("");
  }, [open, packages, manageablePackages, packageId]);

  const membershipPackage = packages.find(({ id }) => id === packageId);
  const canManage =
    membershipPackage != null &&
    (isAdmin || membershipPackage.owner_account_id === currentAccountId);
  const packageActive = isMembershipPackageCurrentlyActive(membershipPackage);
  const rows = students;
  const selectedRows = rows.filter((student) =>
    selectedStudentIds.includes(student.student_id),
  );
  const getSeatAssignment = (student: ManageSeatsStudent) =>
    getActiveMembershipPackageAssignmentForStudent(membershipPackage, student);
  const assignableRows = selectedRows.filter(
    (student) =>
      student.project_id &&
      (student.account_id || student.email_address) &&
      !getSeatAssignment(student),
  );
  const revokableRows = selectedRows.filter(
    (student) => !!getSeatAssignment(student),
  );

  async function mutateSeats(
    action: "assign" | "revoke",
    targetRows: ManageSeatsStudent[],
  ) {
    if (!membershipPackage || !canManage || targetRows.length === 0) {
      return;
    }
    setBusy(true);
    setError("");
    setCompleted(0);
    setTotal(targetRows.length);
    try {
      await runFreshAuthAction(async () => {
        const failures = await runWithConcurrency(
          targetRows,
          4,
          async (student) => {
            if (action === "assign") {
              await assignMembershipPackageSeat({
                package_id: membershipPackage.id,
                ...(student.account_id
                  ? { target_account_id: student.account_id }
                  : { target_email_address: student.email_address }),
                metadata: {
                  course_project_id: courseProjectId,
                  project_id: student.project_id,
                  student_id: student.student_id,
                },
              });
            } else {
              const assignment = getSeatAssignment(student);
              await revokeMembershipPackageSeat({
                package_id: membershipPackage.id,
                ...(assignment?.account_id
                  ? { target_account_id: assignment.account_id }
                  : { target_email_address: student.email_address }),
              });
            }
            setCompleted((value) => value + 1);
          },
        );
        if (failures.length > 0) {
          setError(
            `${failures.length} of ${targetRows.length} seat changes failed. ${failures[0]}`,
          );
        }
      });
      await onRefresh();
      setSelectedStudentIds([]);
    } catch (err) {
      setError(`${err}`);
    } finally {
      setBusy(false);
    }
  }

  const packageOptions = packages.map((membershipPackage) => ({
    value: membershipPackage.id,
    label: `${ownerName(membershipPackage.owner_account_id)} - ${membershipPackage.seat_count} seats${membershipPackage.purchase_id ? ` (purchase #${membershipPackage.purchase_id})` : ""}${isMembershipPackageCurrentlyActive(membershipPackage) ? "" : " - inactive"}`,
  }));

  return (
    <>
      <Modal
        open={open}
        onCancel={onClose}
        footer={null}
        width={920}
        title={
          <Space>
            <Icon name="users" /> Manage paid seats
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={`Linked course: ${courseTitle || coursePath}`}
          description={
            <Space direction="vertical" size={0}>
              <Text>{coursePath}</Text>
              <Text type="secondary">Project {courseProjectId}</Text>
            </Space>
          }
        />
        {packages.length === 0 ? (
          <Alert
            type="warning"
            showIcon
            title="No seat package is linked to this course"
            description="Purchase institute-paid seats in the course payment configuration, then return here to assign them."
          />
        ) : (
          <>
            {packages.length > 1 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                title={`${packages.length} separate seat packages are linked to this course`}
                description="Assignments and available seats belong to the selected package; packages are not silently combined."
              />
            )}
            <Paragraph strong style={{ marginBottom: 6 }}>
              Seat package
            </Paragraph>
            <Select
              value={packageId}
              options={packageOptions}
              onChange={setPackageId}
              style={{ marginBottom: 16, width: "100%" }}
            />
            {membershipPackage && (
              <>
                <Space wrap size="large" style={{ marginBottom: 12 }}>
                  <Statistic
                    title="Purchased"
                    value={membershipPackage.seat_count}
                  />
                  <Statistic
                    title="Assigned or reserved"
                    value={membershipPackage.active_assignment_count}
                  />
                  <Statistic
                    title="Available"
                    value={membershipPackage.available_seat_count}
                  />
                </Space>
                <Paragraph type="secondary">
                  Purchased by {ownerName(membershipPackage.owner_account_id)} (
                  {trunc_middle(membershipPackage.owner_account_id, 18)})
                  {membershipPackage.purchase_id
                    ? `, purchase #${membershipPackage.purchase_id}`
                    : ""}
                  . Package {trunc_middle(membershipPackage.id, 18)}
                  {membershipPackage.expires_at ? (
                    <>
                      {" "}
                      expires <TimeAgo date={membershipPackage.expires_at} />
                    </>
                  ) : undefined}
                  .
                </Paragraph>
                <Paragraph type="secondary">
                  Seats assigned before a student joins are reserved against the
                  course invitation and are transferred to whichever CoCalc
                  account accepts that invitation.
                </Paragraph>
                {!packageActive && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    title="This seat package is not currently active"
                    description="Its assignments remain visible for audit and can be revoked, but new seats cannot be assigned from it."
                  />
                )}
              </>
            )}
            {!canManage && membershipPackage && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                title="This package belongs to another course manager"
                description="You can inspect its assignments, but only the purchaser or an administrator can change them."
              />
            )}
            {error && (
              <Alert
                type="error"
                showIcon
                closable
                onClose={() => setError("")}
                style={{ marginBottom: 12 }}
                title={error}
              />
            )}
            {busy && total > 0 && (
              <Progress
                percent={Math.round((100 * completed) / total)}
                status="active"
                style={{ marginBottom: 12 }}
              />
            )}
            <Space wrap style={{ marginBottom: 12 }}>
              <Button
                type="primary"
                disabled={
                  !canManage ||
                  !packageActive ||
                  assignableRows.length === 0 ||
                  (membershipPackage?.available_seat_count ?? 0) <
                    assignableRows.length
                }
                loading={busy}
                onClick={() => mutateSeats("assign", assignableRows)}
              >
                <Icon name="check" /> Assign selected ({assignableRows.length})
              </Button>
              <Popconfirm
                title={`Revoke ${revokableRows.length} paid seat${revokableRows.length === 1 ? "" : "s"}?`}
                description="Those students may lose course access immediately if they have no other sufficient membership."
                disabled={!canManage || revokableRows.length === 0}
                onConfirm={() => mutateSeats("revoke", revokableRows)}
              >
                <Button
                  danger
                  disabled={!canManage || revokableRows.length === 0}
                  loading={busy}
                >
                  <Icon name="times" /> Revoke selected ({revokableRows.length})
                </Button>
              </Popconfirm>
              {(membershipPackage?.available_seat_count ?? 0) <
                assignableRows.length && (
                <Text style={{ color: COLORS.FG_RED }}>
                  Select fewer students or purchase more seats.
                </Text>
              )}
            </Space>
            <Table<ManageSeatsStudent>
              size="small"
              pagination={{ pageSize: 20, showSizeChanger: true }}
              rowKey="student_id"
              dataSource={rows}
              rowSelection={{
                selectedRowKeys: selectedStudentIds,
                onChange: (keys) =>
                  setSelectedStudentIds(keys.map((key) => `${key}`)),
                getCheckboxProps: (student) => ({
                  disabled:
                    !student.project_id ||
                    (!student.account_id && !student.email_address),
                }),
              }}
              columns={[
                {
                  title: "Student",
                  key: "student",
                  render: (_, student) =>
                    student.display_name || student.email_address || "Student",
                },
                {
                  title: "Email",
                  dataIndex: "email_address",
                  key: "email",
                },
                {
                  title: "Paid seat",
                  key: "seat",
                  render: (_, student) => {
                    const assignment = getSeatAssignment(student);
                    if (assignment) {
                      const reserved = !assignment.account_id;
                      const accountMismatch =
                        !!assignment.account_id &&
                        assignment.account_id !== student.account_id;
                      return (
                        <Tag
                          color={
                            accountMismatch
                              ? "red"
                              : packageActive
                                ? "green"
                                : "orange"
                          }
                        >
                          {accountMismatch
                            ? "Claimed by another account"
                            : reserved
                              ? packageActive
                                ? "Reserved"
                                : "Reserved, inactive"
                              : packageActive
                                ? "Assigned"
                                : "Assigned, inactive"}
                        </Tag>
                      );
                    }
                    return (
                      <Tag>
                        {student.account_id
                          ? "Not assigned"
                          : "Hasn't joined course"}
                      </Tag>
                    );
                  },
                },
              ]}
            />
          </>
        )}
      </Modal>
      <FreshAuthModal {...freshAuthModalProps} />
    </>
  );
}
