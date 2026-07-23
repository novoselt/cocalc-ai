/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { EventEmitter } from "events";
import { act, render, waitFor } from "@testing-library/react";
import { Map } from "immutable";
import { IpyWidget } from "../ipywidget";

describe("IpyWidget initialization", () => {
  it("waits for widget state readiness before serializing a model", async () => {
    const state = new EventEmitter() as EventEmitter & {
      get_state: () => "init" | "ready";
      getSerializedModelState: jest.Mock;
    };
    let currentState: "init" | "ready" = "init";
    state.get_state = () => currentState;
    state.getSerializedModelState = jest.fn(() => ({
      _model_name: "IntSliderModel",
    }));
    const actions = {
      widget_manager: {
        ipywidgets_state: state,
      },
    };

    render(
      <IpyWidget
        value={Map({ model_id: "model-1" })}
        actions={actions as any}
      />,
    );

    expect(state.getSerializedModelState).not.toHaveBeenCalled();

    await act(async () => {
      currentState = "ready";
      state.emit("ready");
    });

    await waitFor(() => {
      expect(state.getSerializedModelState).toHaveBeenCalledWith("model-1");
    });
  });
});
