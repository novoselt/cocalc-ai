/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";

import { openAppDocs } from "@cocalc/frontend/docs/navigation";
import { HostExamPanel } from "./host-exam-panel";

jest.mock("@cocalc/frontend/docs/navigation", () => ({
  openAppDocs: jest.fn(),
}));

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    conat_client: {
      hub: {
        hosts: {
          getHostExamState: jest.fn(async () => ({ eligible: true })),
        },
      },
    },
  },
}));

jest.mock("@cocalc/frontend/auth/fresh-auth", () => ({
  FreshAuthModal: () => null,
  useFreshAuthAction: () => ({
    freshAuthModalProps: {},
    runFreshAuthAction: async (action: () => Promise<unknown>) => {
      await action();
      return true;
    },
  }),
}));

describe("HostExamPanel", () => {
  it("opens the exam scratchpad documentation entry", () => {
    render(
      <HostExamPanel
        host={{ id: "host-1", status: "running" } as any}
        rootfsImages={[]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /Read the setup, testing, and cleanup guide\./,
      }),
    );

    expect(openAppDocs).toHaveBeenCalledWith("hosts/exam-scratchpads");
  });
});
