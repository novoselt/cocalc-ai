/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  STORAGE_OPERATION_REGISTRY,
  getStorageOperationSpec,
} from "./storage-operation-registry";

describe("storage operation registry", () => {
  it("keeps every key and operation kind identical", () => {
    for (const [kind, spec] of Object.entries(STORAGE_OPERATION_REGISTRY)) {
      expect(spec.kind).toBe(kind);
      expect(getStorageOperationSpec(spec.kind)).toBe(spec);
    }
  });

  it("requires project-attributed destructive work to be bounded", () => {
    for (const spec of Object.values(STORAGE_OPERATION_REGISTRY)) {
      if (spec.attribution === "maintenance" || !spec.destructive) continue;
      expect(
        spec.initial_max_per_host != null ||
          spec.initial_max_per_project != null,
      ).toBe(true);
    }
  });

  it("does not classify scheduled or scavenger work as inline-only", () => {
    for (const spec of Object.values(STORAGE_OPERATION_REGISTRY)) {
      if (spec.priority !== "scheduled" && spec.priority !== "scavenger") {
        continue;
      }
      expect(spec.recovery).not.toBe("inline-bounded");
      expect(spec.checkpointable).toBe(true);
    }
  });
});
