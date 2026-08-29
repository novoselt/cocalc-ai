/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PublicSharePublisherProfileCard } from "./public-shares-page";

const getPublisherProfile = jest.fn();
const updatePublisherProfile = jest.fn();

jest.mock("antd", () => {
  const Button = ({ children, disabled, loading, onClick, type }: any) => (
    <button
      data-type={type}
      disabled={disabled || loading}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
  const Card = ({ children, title }: any) => (
    <section>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
  const Space = ({ children }: any) => <div>{children}</div>;
  const TextArea = ({ autoSize: _autoSize, ...props }: any) => (
    <textarea {...props} />
  );
  return {
    Alert: ({ description, title, type }: any) => (
      <div role={type === "error" ? "alert" : undefined}>
        <div>{title}</div>
        <div>{description}</div>
      </div>
    ),
    Button,
    Card,
    Checkbox: () => null,
    Input: Object.assign(() => null, { Search: () => null, TextArea }),
    InputNumber: () => null,
    Modal: () => null,
    Popconfirm: ({ children }: any) => children,
    Select: () => null,
    Space,
    Table: () => null,
    Tag: ({ children }: any) => <span>{children}</span>,
    Typography: {
      Text: ({ children, id }: any) => <span id={id}>{children}</span>,
    },
  };
});

jest.mock("@cocalc/frontend/editors/slate/static-markdown-public", () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div>{value}</div>,
}));

jest.mock("@cocalc/frontend/components/user-facing-error", () => ({
  normalizeUserFacingError: (err: unknown) => ({
    message: (err as Error)?.message ?? `${err}`,
  }),
}));

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    conat_client: {
      hub: {
        publicDirectoryShares: {
          getPublisherProfile: (...args: any[]) => getPublisherProfile(...args),
          updatePublisherProfile: (...args: any[]) =>
            updatePublisherProfile(...args),
        },
      },
    },
  },
}));

describe("PublicSharePublisherProfileCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPublisherProfile.mockResolvedValue({
      reader_instructions_markdown: "Select **Copy**.",
    });
    updatePublisherProfile.mockImplementation(async (opts) => ({
      reader_instructions_markdown: opts.reader_instructions_markdown,
    }));
  });

  it("loads, labels, previews, and saves the account-wide instructions", async () => {
    render(<PublicSharePublisherProfileCard />);

    const editor = await screen.findByRole("textbox", {
      name: "Instructions shown beside Copy",
    });
    expect(editor).toHaveValue("Select **Copy**.");
    expect(screen.getAllByText("Select **Copy**.").length).toBeGreaterThan(0);

    fireEvent.change(editor, {
      target: { value: "Copy, then open the `figures` directory." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save reader instructions" }),
    );

    await waitFor(() => {
      expect(updatePublisherProfile).toHaveBeenCalledWith({
        reader_instructions_markdown:
          "Copy, then open the `figures` directory.",
      });
    });
    expect(
      await screen.findByText("Saved for all your public shares."),
    ).toBeTruthy();
  });
});
