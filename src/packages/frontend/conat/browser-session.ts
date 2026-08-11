/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { loadWithRetry } from "@cocalc/frontend/app/lazy-with-retry";
import {
  onSignedInSurfaceReady,
  signedInSurfaceReadySegment,
} from "@cocalc/frontend/app/surface-ready-state";
import type { createBrowserSessionAutomation as CreateAutomation } from "./browser-session/index";

export type BrowserSessionAutomation = ReturnType<typeof CreateAutomation>;
type BrowserSessionAutomationOptions = Parameters<typeof CreateAutomation>[0];

const loadBrowserSessionAutomation = async () =>
  await loadWithRetry(async () => await import("./browser-session/index"), {
    name: "browser session automation",
  });

export function createBrowserSessionAutomation(
  options: BrowserSessionAutomationOptions,
): BrowserSessionAutomation {
  let delegate: BrowserSessionAutomation | undefined;
  let delegatePromise: Promise<BrowserSessionAutomation> | undefined;
  let desiredAccountId: string | undefined;
  let transportConnected: boolean | undefined;
  let surfaceReady = signedInSurfaceReadySegment() != null;
  let operation = Promise.resolve();

  const ensureDelegate = async (): Promise<BrowserSessionAutomation> => {
    if (delegate != null) return delegate;
    if (delegatePromise == null) {
      delegatePromise = loadBrowserSessionAutomation().then(
        ({ createBrowserSessionAutomation }) => {
          delegate = createBrowserSessionAutomation(options);
          return delegate;
        },
      );
    }
    const pending = delegatePromise;
    try {
      return await pending;
    } catch (err) {
      if (delegatePromise === pending) {
        delegatePromise = undefined;
      }
      throw err;
    }
  };

  const synchronize = async (): Promise<void> => {
    const accountId = desiredAccountId;
    if (!surfaceReady || !accountId) return;
    const current = await ensureDelegate();
    if (desiredAccountId !== accountId) return;
    if (transportConnected === true) {
      current.noteConnected?.();
    } else if (transportConnected === false) {
      current.noteDisconnected?.();
    }
    await current.start(accountId);
    if (desiredAccountId !== accountId) {
      await current.stop();
    }
  };

  const enqueue = (fn: () => Promise<void>): Promise<void> => {
    operation = operation.then(fn, fn);
    return operation;
  };

  onSignedInSurfaceReady(() => {
    surfaceReady = true;
    void enqueue(synchronize);
  });

  return {
    start: async (accountId: string) => {
      desiredAccountId = `${accountId ?? ""}`.trim() || undefined;
      await enqueue(synchronize);
    },
    stop: async () => {
      desiredAccountId = undefined;
      await enqueue(async () => {
        await delegate?.stop();
      });
    },
    noteConnected: () => {
      transportConnected = true;
      delegate?.noteConnected?.();
    },
    noteDisconnected: () => {
      transportConnected = false;
      delegate?.noteDisconnected?.();
    },
  };
}
