/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { normalizeProjectSecretsRuntimeRefreshResult } from "./project-secrets-runtime";

describe("normalizeProjectSecretsRuntimeRefreshResult", () => {
  it("preserves current project-host responses", () => {
    const result = {
      status: "updated_live" as const,
      cached_generation: 4,
      materialized_generation: 4,
      secret_names: ["TOKEN"],
    };
    expect(
      normalizeProjectSecretsRuntimeRefreshResult({
        result,
        generation: 4,
        fallbackSecretNames: [],
      }),
    ).toEqual(result);
  });

  it("normalizes legacy project-host responses", () => {
    expect(
      normalizeProjectSecretsRuntimeRefreshResult({
        result: { secret_names: ["Z", "A"] },
        generation: 7,
        fallbackSecretNames: ["FALLBACK"],
      }),
    ).toEqual({
      status: "cached_for_next_start",
      cached_generation: 7,
      materialized_generation: 0,
      secret_names: ["A", "Z"],
    });
  });
});
