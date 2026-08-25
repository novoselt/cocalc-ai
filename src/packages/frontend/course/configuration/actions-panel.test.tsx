/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IntlProvider } from "react-intl";
import { copyTextToClipboard } from "@cocalc/frontend/components/copy-button";
import { ResendInvites } from "./actions-panel";

jest.mock("@cocalc/frontend/components/copy-button", () => ({
  copyTextToClipboard: jest.fn(),
}));

jest.mock("@cocalc/frontend/components", () => ({
  Icon: ({ name }: { name: string }) => <span>{name}</span>,
}));

jest.mock("@cocalc/frontend/course/common/help-popover", () => () => null);

const mockCopyTextToClipboard = copyTextToClipboard as jest.Mock;

describe("ResendInvites", () => {
  beforeEach(() => {
    mockCopyTextToClipboard.mockReset();
  });

  it("shows selectable invite links when clipboard access is denied", async () => {
    const links = [
      "Ada Lovelace <ada@example.com>: https://cocalc.ai/invite/ada",
      "Grace Hopper <grace@example.com>: https://cocalc.ai/invite/grace",
    ].join("\n");
    mockCopyTextToClipboard.mockResolvedValue(false);

    render(
      <IntlProvider locale="en">
        <ResendInvites
          actions={{
            student_projects: {
              get_pending_student_invite_links: jest.fn(async () => links),
              reinvite_oustanding_students: jest.fn(),
            },
          }}
        />
      </IntlProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /copy pending invite links/i }),
    );

    const textArea = await screen.findByRole("textbox", {
      name: "Pending course invite links",
    });
    expect(textArea).toHaveValue(links);
    expect(textArea).toHaveAttribute("readonly");
    expect(screen.getByText("Clipboard access is unavailable")).toBeVisible();
    expect(mockCopyTextToClipboard).toHaveBeenCalledWith({ text: links });

    mockCopyTextToClipboard.mockResolvedValue(true);
    fireEvent.click(screen.getByRole("button", { name: /try copying again/i }));
    await waitFor(() => expect(textArea).not.toBeInTheDocument());
  });
});
