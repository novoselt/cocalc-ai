/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Map } from "immutable";
import { applyExamSessionBootstrap } from "./exam-bootstrap";

describe("applyExamSessionBootstrap", () => {
  it("hydrates the temporary account and project stores", () => {
    const accountSetState = jest.fn();
    const projectSetState = jest.fn();
    const emit = jest.fn();
    const redux = {
      getStore: (name: string) => {
        if (name === "account") {
          return { get: () => false, emit };
        }
        return { get: () => undefined };
      },
      getActions: (name: string) => ({
        setState: name === "account" ? accountSetState : projectSetState,
      }),
    };

    applyExamSessionBootstrap({
      redux,
      session: {
        account: { account_id: "account-1", display_name: "Exam User" },
        project: { project_id: "project-1", title: "Exam Scratchpad" },
      },
    });

    expect(accountSetState).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        account_id: "account-1",
        is_logged_in: true,
        user_type: "signed_in",
      }),
    );
    expect(accountSetState).toHaveBeenNthCalledWith(2, { is_ready: true });
    expect(emit).toHaveBeenCalledWith("is_ready");
    const projectMap = projectSetState.mock.calls[0][0].project_map;
    expect(projectMap.getIn(["project-1", "title"])).toBe("Exam Scratchpad");
  });

  it("does nothing without an authenticated exam session", () => {
    const redux = { getStore: jest.fn(), getActions: jest.fn() };
    applyExamSessionBootstrap({ redux });
    expect(redux.getStore).not.toHaveBeenCalled();
  });
});
