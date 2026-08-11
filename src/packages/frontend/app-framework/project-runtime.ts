/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { loadWithRetry } from "@cocalc/frontend/app/lazy-with-retry";
import type { AppRedux } from "./index";
import type { ProjectStore } from "../project/redux/store";

type ProjectStoreInitializer = (
  projectId: string,
  redux: AppRedux,
) => ProjectStore;

let initializer: ProjectStoreInitializer | undefined;
let loadPromise: Promise<void> | undefined;

export function registerProjectStoreInitializer(
  next: ProjectStoreInitializer,
): void {
  if (initializer != null && initializer !== next) {
    throw Error("project store initializer is already registered");
  }
  initializer = next;
}

export function initializeProjectStore(
  projectId: string,
  redux: AppRedux,
): ProjectStore {
  if (initializer == null) {
    throw Error(
      "project runtime is not loaded; call ensureProjectReduxRuntime first",
    );
  }
  return initializer(projectId, redux);
}

export async function ensureProjectReduxRuntime(): Promise<void> {
  if (initializer != null) return;
  if (loadPromise == null) {
    loadPromise = loadWithRetry(
      async () => await import("../project/redux/store"),
      { name: "project Redux runtime" },
    )
      .then(({ init }) => registerProjectStoreInitializer(init))
      .catch((err) => {
        loadPromise = undefined;
        throw err;
      });
  }
  await loadPromise;
}
