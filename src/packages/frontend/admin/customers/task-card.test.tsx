import { fireEvent, render, screen } from "@testing-library/react";

import { CustomerTaskCard } from "./task-card";

jest.mock("@cocalc/frontend/components", () => ({
  TimeAgo: ({ date }: { date: string }) => <span>{date}</span>,
}));

jest.mock("../receivables/account-names", () => ({
  AccountIdentity: ({ accountId, names }: any) => (
    <span>{names[accountId] ?? "Unknown account"}</span>
  ),
}));

const task = {
  id: "task-id",
  organization_id: "organization-id",
  person_id: null,
  opportunity_id: null,
  commercial_order_id: null,
  zendesk_ticket_id: null,
  type: "contact",
  state: "open",
  assignee_account_id: "admin-id",
  due_at: "2026-08-28T16:00:00.000Z",
  priority: "urgent",
  subject: "Send resolution reply",
  details: null,
  created_by_account_id: "admin-id",
  updated_by_account_id: "admin-id",
  completed_by_account_id: null,
  cancelled_by_account_id: null,
  created_at: "2026-08-27T12:00:00.000Z",
  updated_at: "2026-08-27T12:00:00.000Z",
  completed_at: null,
  cancelled_at: null,
  version: 1,
} as const;

describe("CustomerTaskCard", () => {
  it("offers all task transitions as named keyboard-focusable buttons", () => {
    const onTransition = jest.fn();
    render(
      <CustomerTaskCard
        names={{ "admin-id": "William Admin" }}
        onTransition={onTransition}
        task={task}
      />,
    );

    expect(screen.getByText("William Admin")).toBeInTheDocument();

    const complete = screen.getByRole("button", { name: "Complete" });
    const reschedule = screen.getByRole("button", { name: "Reschedule" });
    const cancel = screen.getByRole("button", { name: "Cancel" });

    complete.focus();
    expect(complete).toHaveFocus();
    fireEvent.click(complete);
    fireEvent.click(reschedule);
    fireEvent.click(cancel);

    expect(onTransition.mock.calls).toEqual([
      ["complete"],
      ["reschedule"],
      ["cancel"],
    ]);
  });
});
