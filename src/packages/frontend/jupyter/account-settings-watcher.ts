/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

type AccountSettingsStore = {
  get: (key: "editor_settings") => unknown;
  on: (event: "change", listener: (state: any) => void) => void;
};

export function subscribeAccountSettingsStore(
  accountStore: AccountSettingsStore | null | undefined,
  onChange: (state: any) => void,
): unknown | undefined {
  if (accountStore == null) {
    return;
  }
  accountStore.on("change", onChange);
  return accountStore.get("editor_settings");
}
