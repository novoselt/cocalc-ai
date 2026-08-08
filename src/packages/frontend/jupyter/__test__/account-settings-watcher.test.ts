/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { subscribeAccountSettingsStore } from "../account-settings-watcher";

describe("subscribeAccountSettingsStore", () => {
  it("does nothing when the account store is unavailable", () => {
    expect(subscribeAccountSettingsStore(undefined, jest.fn())).toBeUndefined();
  });

  it("subscribes and returns the current editor settings", () => {
    const onChange = jest.fn();
    const editorSettings = {};
    const accountStore = {
      get: jest.fn(() => editorSettings),
      on: jest.fn(),
    };

    expect(subscribeAccountSettingsStore(accountStore, onChange)).toBe(
      editorSettings,
    );
    expect(accountStore.on).toHaveBeenCalledWith("change", onChange);
    expect(accountStore.get).toHaveBeenCalledWith("editor_settings");
  });
});
