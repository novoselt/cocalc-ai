/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const mockStateSlots: any[] = [];
const mockMemoSlots: {
  deps?: unknown[];
  value?: unknown;
}[] = [];
const mockEffectSlots: {
  deps?: unknown[];
  cleanup?: () => void;
}[] = [];
let mockHookIndex = 0;

function mockDepsChanged(prev: unknown[] | undefined, next: unknown[]) {
  return (
    prev == null ||
    prev.length !== next.length ||
    prev.some((value, i) => value !== next[i])
  );
}

function mockResetHookCursor() {
  mockHookIndex = 0;
}

function mockResetHooks() {
  for (const slot of mockEffectSlots) {
    slot?.cleanup?.();
  }
  mockStateSlots.length = 0;
  mockMemoSlots.length = 0;
  mockEffectSlots.length = 0;
  mockHookIndex = 0;
}

jest.mock("react", () => ({
  useCallback: (callback: unknown, inputs: unknown[] = []) => {
    const i = mockHookIndex++;
    const slot = (mockMemoSlots[i] ??= {});
    if (mockDepsChanged(slot.deps, inputs)) {
      slot.deps = inputs;
      slot.value = callback;
    }
    return slot.value;
  },
  useEffect: (effect: () => void | (() => void), inputs: unknown[] = []) => {
    const i = mockHookIndex++;
    const slot = (mockEffectSlots[i] ??= {});
    if (!mockDepsChanged(slot.deps, inputs)) {
      return;
    }
    slot.cleanup?.();
    slot.deps = inputs;
    slot.cleanup = effect() ?? undefined;
  },
  useMemo: (factory: () => unknown, inputs: unknown[] = []) => {
    const i = mockHookIndex++;
    const slot = (mockMemoSlots[i] ??= {});
    if (mockDepsChanged(slot.deps, inputs)) {
      slot.deps = inputs;
      slot.value = factory();
    }
    return slot.value;
  },
  useRef: (initial: unknown) => {
    const i = mockHookIndex++;
    if (mockStateSlots[i] == null) {
      mockStateSlots[i] = { current: initial };
    }
    return mockStateSlots[i];
  },
  useState: (initial: unknown) => {
    const i = mockHookIndex++;
    if (!(i in mockStateSlots)) {
      mockStateSlots[i] = typeof initial === "function" ? initial() : initial;
    }
    const setState = (next: unknown) => {
      mockStateSlots[i] =
        typeof next === "function" ? next(mockStateSlots[i]) : next;
    };
    return [mockStateSlots[i], setState];
  },
}));

const getProjectActions = jest.fn();
jest.mock("@cocalc/frontend/app-framework", () => ({
  redux: {
    getProjectActions: (...args: any[]) => getProjectActions(...args),
  },
}));

const mockProjectContext = {
  publicDirectoryShare: undefined as undefined | { id: string },
  projectAccess: { role: "collaborator" },
};
jest.mock("@cocalc/frontend/project/context", () => ({
  useProjectContext: () => mockProjectContext,
}));

const useFsWithRefresh = jest.fn();
jest.mock("./use-fs", () => ({
  useFsWithRefresh: (...args: any[]) => useFsWithRefresh(...args),
}));

import { useProjectActionsFilesystemWithRefresh } from "./use-project-actions-fs";

function useProjectActionsFilesystemForTest({
  actions,
  project_id,
}: Parameters<typeof useProjectActionsFilesystemWithRefresh>[0]) {
  mockResetHookCursor();
  return useProjectActionsFilesystemWithRefresh({ actions, project_id });
}

describe("useProjectActionsFilesystemWithRefresh", () => {
  beforeEach(() => {
    mockResetHooks();
    jest.clearAllMocks();
    mockProjectContext.publicDirectoryShare = undefined;
    mockProjectContext.projectAccess = { role: "collaborator" };
    useFsWithRefresh.mockReturnValue({
      fs: null,
      refreshFs: jest.fn(),
    });
  });

  afterEach(() => {
    mockResetHooks();
  });

  it("clears the cached project-actions filesystem client when refreshed", () => {
    const firstFs = { name: "first" };
    const secondFs = { name: "second" };
    const actions = {
      fs: jest.fn().mockReturnValueOnce(firstFs).mockReturnValueOnce(secondFs),
      clearFilesystemClient: jest.fn(),
    };

    let result = useProjectActionsFilesystemForTest({
      actions,
      project_id: "project-1",
    });
    expect(result.fs).toBe(firstFs);
    expect(actions.fs).toHaveBeenCalledTimes(1);

    result.refreshFs();

    result = useProjectActionsFilesystemForTest({
      actions,
      project_id: "project-1",
    });
    expect(actions.clearFilesystemClient).toHaveBeenCalledTimes(1);
    expect(actions.fs).toHaveBeenCalledTimes(2);
    expect(result.fs).toBe(secondFs);
  });

  it("uses the restricted filesystem refresh for read-only viewers", () => {
    const refreshRestrictedFs = jest.fn();
    useFsWithRefresh.mockReturnValue({
      fs: { name: "viewer" },
      refreshFs: refreshRestrictedFs,
    });
    mockProjectContext.projectAccess = { role: "viewer" };
    const actions = {
      fs: jest.fn(),
      clearFilesystemClient: jest.fn(),
    };

    const result = useProjectActionsFilesystemForTest({
      actions,
      project_id: "project-viewer",
    });
    result.refreshFs();

    expect(refreshRestrictedFs).toHaveBeenCalledTimes(1);
    expect(actions.clearFilesystemClient).not.toHaveBeenCalled();
    expect(actions.fs).not.toHaveBeenCalled();
  });
});
