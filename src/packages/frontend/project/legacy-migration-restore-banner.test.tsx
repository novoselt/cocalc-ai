/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { render, screen, waitFor } from "@testing-library/react";
import { fromJS } from "immutable";

import type { LroSummary } from "@cocalc/conat/hub/api/lro";
import {
  LEGACY_RESTORE_ERROR_LABEL,
  LEGACY_RESTORE_LRO_LABEL,
  LEGACY_RESTORE_STATUS_LABEL,
  LEGACY_SOURCE_PROJECT_LABEL,
} from "@cocalc/util/legacy-migration";

import { LegacyMigrationRestoreBanner } from "./legacy-migration-restore-banner";

const mockGetLro = jest.fn();
const mockGetProjectRemediation = jest.fn(async () => ({
  needs_remediation: false,
}));

const mockProject = fromJS({
  labels: {
    [LEGACY_SOURCE_PROJECT_LABEL]: "legacy-project-1",
    [LEGACY_RESTORE_STATUS_LABEL]: "failed",
    [LEGACY_RESTORE_ERROR_LABEL]: "restore timed out",
    [LEGACY_RESTORE_LRO_LABEL]: "op-1",
  },
});

jest.mock("antd", () => {
  const Container = ({ children }: any) => <div>{children}</div>;
  const Button = ({ children, danger, loading, size, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  );
  const Modal = ({ children, open }: any) =>
    open ? <div>{children}</div> : null;
  return {
    Alert: ({ title, description }: any) => (
      <div role="alert">
        {title}
        {description}
      </div>
    ),
    Button,
    Modal,
    Progress: Container,
    Space: Container,
    Tag: Container,
    Typography: { Text: Container },
    message: {
      error: jest.fn(),
      success: jest.fn(),
    },
  };
});

jest.mock("@cocalc/frontend/app-framework", () => ({
  redux: {},
  useProjectFromMap: () => mockProject,
}));

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    conat_client: {
      hub: {
        legacyMigration: {
          getProjectRemediation: (...args: any[]) =>
            mockGetProjectRemediation(...args),
        },
        lro: {
          get: (...args: any[]) => mockGetLro(...args),
        },
      },
      lroWait: jest.fn(async () => undefined),
    },
  },
}));

function failedSummary(overrides: Partial<LroSummary> = {}): LroSummary {
  const now = new Date();
  return {
    op_id: "op-1",
    kind: "legacy-project-restore",
    scope_type: "project",
    scope_id: "project-1",
    status: "failed",
    created_by: "account-1",
    owner_type: "hub",
    owner_id: null,
    routing: null,
    input: {},
    result: {},
    error: "restore timed out",
    progress_summary: {},
    attempt: 0,
    heartbeat_at: null,
    created_at: now,
    started_at: now,
    finished_at: now,
    dismissed_at: null,
    dismissed_by: null,
    updated_at: now,
    expires_at: now,
    dedupe_key: null,
    parent_id: null,
    ...overrides,
  };
}

describe("LegacyMigrationRestoreBanner", () => {
  beforeEach(() => {
    mockGetLro.mockReset();
    mockGetProjectRemediation.mockClear();
    sessionStorage.clear();
  });

  it("does not flash a failed label while loading a dismissed LRO", async () => {
    let resolveLro!: (summary: LroSummary) => void;
    mockGetLro.mockReturnValue(
      new Promise<LroSummary>((resolve) => {
        resolveLro = resolve;
      }),
    );

    render(<LegacyMigrationRestoreBanner project_id="project-1" />);

    expect(screen.queryByText("Legacy project file restore failed")).toBeNull();

    resolveLro(failedSummary({ dismissed_at: new Date() }));

    await waitFor(() => expect(mockGetLro).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Legacy project file restore failed")).toBeNull();
  });

  it("falls back to failed project labels when the LRO lookup fails", async () => {
    mockGetLro.mockRejectedValue(new Error("LRO unavailable"));

    render(<LegacyMigrationRestoreBanner project_id="project-1" />);

    expect(screen.queryByText("Legacy project file restore failed")).toBeNull();
    expect(
      await screen.findByText("Legacy project file restore failed"),
    ).toBeTruthy();
  });
});
