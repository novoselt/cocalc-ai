import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { message } from "antd";

import { OutreachAdmin } from "./outreach";

const api = {
  listOutreachDeliveries: jest.fn(),
  listOutreachBatches: jest.fn(),
  listOutreachTemplates: jest.fn(),
  listContactSuppressions: jest.fn(),
  listOutreachFollowups: jest.fn(),
  getOutreachLimits: jest.fn(),
  getOutreachDiagnostics: jest.fn(),
  createOutreachBatch: jest.fn(),
};
const runFreshAuthAction = jest.fn(async (action: () => Promise<void>) => {
  await action();
  return true;
});

jest.mock("@cocalc/frontend/auth/fresh-auth", () => ({
  FreshAuthModal: () => <div data-testid="fresh-auth-modal" />,
  useFreshAuthAction: () => ({
    runFreshAuthAction,
    freshAuthModalProps: {},
  }),
}));

jest.mock("@cocalc/frontend/components", () => ({
  ErrorDisplay: ({ error, onClose }: any) => (
    <div role="alert">
      {`${error}`}
      <button onClick={onClose}>Dismiss error</button>
    </div>
  ),
  Icon: ({ name }: { name: string }) => <span>{name}</span>,
  TimeAgo: ({ date }: { date: string }) => <span>{date}</span>,
}));

jest.mock("../receivables/account-selector", () => ({
  AccountSelector: ({
    value,
    onChange,
    accountKind: _accountKind,
    ariaLabel,
    ...props
  }: any) => (
    <input
      {...props}
      aria-label={ariaLabel}
      onChange={(event) => onChange?.(event.target.value)}
      value={value ?? ""}
    />
  ),
}));

jest.mock("../receivables/account-names", () => ({
  AccountIdentity: ({ accountId }: { accountId: string }) => (
    <span>{accountId}</span>
  ),
  useAccountDisplayNames: () => ({}),
}));

jest.mock("./selector", () => ({
  CustomerSelector: (props: any) => <input {...props} />,
  OpportunitySelector: (props: any) => <input {...props} />,
  PersonSelector: (props: any) => <input {...props} />,
}));

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    browser_id: "browser-test",
    conat_client: {
      hub: {
        adminCrm: {
          listOutreachDeliveries: (...args: unknown[]) =>
            api.listOutreachDeliveries(...args),
          listOutreachBatches: (...args: unknown[]) =>
            api.listOutreachBatches(...args),
          listOutreachTemplates: (...args: unknown[]) =>
            api.listOutreachTemplates(...args),
          listContactSuppressions: (...args: unknown[]) =>
            api.listContactSuppressions(...args),
          listOutreachFollowups: (...args: unknown[]) =>
            api.listOutreachFollowups(...args),
          getOutreachLimits: (...args: unknown[]) =>
            api.getOutreachLimits(...args),
          getOutreachDiagnostics: (...args: unknown[]) =>
            api.getOutreachDiagnostics(...args),
          createOutreachBatch: (...args: unknown[]) =>
            api.createOutreachBatch(...args),
        },
        adminSupport: { show: jest.fn() },
      },
    },
  },
}));

const limits = {
  enabled: true,
  mutations_enabled: true,
  delivery_enabled: false,
  webhook_enabled: false,
  max_recipients_per_batch: 25,
  send_per_minute: 5,
  send_per_hour: 50,
  send_per_day: 200,
  send_per_domain_per_day: 20,
  contact_cooldown_days: 90,
  default_followup_days: 7,
  default_max_followups: 2,
  default_final_review_days: 14,
  worker_concurrency: 1,
  worker_batch_size: 5,
  retry_max_attempts: 5,
  retry_base_seconds: 30,
  rolling_usage: { minute: 0, hour: 0, day: 0, by_domain: {} },
  hard_bounds: {},
};

const diagnostics = {
  checked_at: "2026-08-26T10:00:00.000Z",
  configured: {
    submitter_id: true,
    group_id: true,
    form_id: true,
    support_address: true,
    postal_address: true,
    footer: true,
    webhook_secret: true,
    read_receipts_mode: "private_comments",
    read_receipts_identity: true,
  },
  limits,
  counts: {},
  problems: [],
};

describe("CRM outreach admin", () => {
  beforeAll(() => {
    const getComputedStyle = window.getComputedStyle;
    jest
      .spyOn(window, "getComputedStyle")
      .mockImplementation((element) => getComputedStyle(element));
    jest.spyOn(message, "success").mockImplementation(() => undefined as any);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    api.listOutreachDeliveries.mockResolvedValue({
      deliveries: [],
      truncated: false,
    });
    api.listOutreachBatches.mockResolvedValue({
      batches: [],
      truncated: false,
    });
    api.listOutreachTemplates.mockResolvedValue({
      templates: [],
      truncated: false,
    });
    api.listContactSuppressions.mockResolvedValue({
      suppressions: [],
      truncated: false,
    });
    api.listOutreachFollowups.mockResolvedValue({
      followups: [],
      truncated: false,
    });
    api.getOutreachLimits.mockResolvedValue(limits);
    api.getOutreachDiagnostics.mockResolvedValue(diagnostics);
  });

  it("presents the shared queue, runbook, and visible delivery kill switch", async () => {
    render(<OutreachAdmin />);

    expect(
      screen.getByRole("heading", {
        name: "Initiate carefully. Follow up visibly.",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Outreach runbook/ }),
    ).toHaveAttribute("href", "/app-docs/admin/crm-outreach");
    expect(
      await screen.findByText("Zendesk delivery kill switch is off"),
    ).toBeVisible();
    expect(screen.getByLabelText("Outreach queue summary")).toBeVisible();
  });

  it("previews an exact batch mutation before a fresh-authenticated commit", async () => {
    api.createOutreachBatch.mockImplementation(async (request) =>
      request.commit
        ? {
            preview: false,
            action: "outreach.batch.create",
            record: { id: "batch-1" },
          }
        : {
            preview: true,
            action: "outreach.batch.create",
            expected_version: 0,
            idempotency_key: "preview-key",
            proposed: {
              name: request.name,
              purpose: request.purpose,
            },
            warnings: [],
          },
    );
    render(<OutreachAdmin />);

    fireEvent.click(screen.getByRole("button", { name: /New outreach/ }));
    fireEvent.change(screen.getByLabelText("Batch name"), {
      target: { value: "Internal adoption pilot test" },
    });
    fireEvent.change(screen.getByLabelText("Reviewed purpose"), {
      target: { value: "Exercise the reviewed outreach workflow" },
    });
    fireEvent.change(screen.getByLabelText("Responsible owner"), {
      target: { value: "account-1" },
    });
    fireEvent.change(screen.getByLabelText("Audit reason"), {
      target: { value: "Review an internal outreach workflow test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review change" }));

    expect(
      await screen.findByText("Review the proposed outreach change"),
    ).toBeInTheDocument();
    expect(api.createOutreachBatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ commit: false, browser_id: "browser-test" }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Confirm with fresh auth" }),
    );
    await waitFor(() => expect(runFreshAuthAction).toHaveBeenCalledTimes(1));
    expect(api.createOutreachBatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        commit: true,
        expected_version: 0,
        idempotency_key: "preview-key",
      }),
    );
  });

  it("keeps a commit failure visible inside the active review modal", async () => {
    api.createOutreachBatch
      .mockResolvedValueOnce({
        preview: true,
        action: "outreach.batch.create",
        expected_version: 0,
        idempotency_key: "preview-key",
        proposed: { name: "Test" },
        warnings: [],
      })
      .mockRejectedValueOnce(new Error("Zendesk test provider unavailable"));
    render(<OutreachAdmin />);

    fireEvent.click(screen.getByRole("button", { name: /New outreach/ }));
    fireEvent.change(screen.getByLabelText("Batch name"), {
      target: { value: "Internal test" },
    });
    fireEvent.change(screen.getByLabelText("Reviewed purpose"), {
      target: { value: "Validate modal-local error rendering" },
    });
    fireEvent.change(screen.getByLabelText("Responsible owner"), {
      target: { value: "account-1" },
    });
    fireEvent.change(screen.getByLabelText("Audit reason"), {
      target: { value: "Review the internal failure path" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review change" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm with fresh auth" }),
    );

    const errorText = await screen.findByText(
      "Error: Zendesk test provider unavailable",
    );
    const error = errorText.closest("[role='alert']");
    expect(error).toHaveTextContent("Zendesk test provider unavailable");
    expect(
      screen.getByRole("button", { name: /Confirm with fresh auth/ }),
    ).toBeInTheDocument();
  });
});
