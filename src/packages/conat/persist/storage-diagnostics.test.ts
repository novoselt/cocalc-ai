/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  classifyPersistentStreamPath,
  DEFAULT_EPHEMERAL_SQLITE_CACHE_KIB,
  effectiveEphemeralSqliteCacheKiB,
  EPHEMERAL_SQLITE_CACHE_KIB_ENV,
  resolveEphemeralSqliteCacheKiB,
} from "./storage";

describe("persistent stream memory configuration", () => {
  it("uses a bounded cache for ephemeral SQLite databases by default", () => {
    expect(resolveEphemeralSqliteCacheKiB({})).toBeUndefined();
    expect(effectiveEphemeralSqliteCacheKiB({})).toBe(
      DEFAULT_EPHEMERAL_SQLITE_CACHE_KIB,
    );
    expect(DEFAULT_EPHEMERAL_SQLITE_CACHE_KIB).toBe(256);
  });

  it("accepts a validated cache override", () => {
    const env = { [EPHEMERAL_SQLITE_CACHE_KIB_ENV]: "768" };
    expect(resolveEphemeralSqliteCacheKiB(env)).toBe(768);
    expect(effectiveEphemeralSqliteCacheKiB(env)).toBe(768);
    expect(() =>
      effectiveEphemeralSqliteCacheKiB({
        [EPHEMERAL_SQLITE_CACHE_KIB_ENV]: "invalid",
      }),
    ).toThrow(EPHEMERAL_SQLITE_CACHE_KIB_ENV);
  });
});

describe("persistent stream diagnostic families", () => {
  it("classifies known stream families without exposing resource ids or paths", () => {
    expect(
      classifyPersistentStreamPath(
        "/srv/sync/accounts/account-secret/lro.operation-secret",
      ),
    ).toBe("account:lro");
    expect(
      classifyPersistentStreamPath(
        "/srv/sync/accounts/account-secret/account-feed",
      ),
    ).toBe("account:account-feed");
    expect(
      classifyPersistentStreamPath(
        "/srv/sync/projects/project-secret/acp-live-log/private/path",
      ),
    ).toBe("project:acp-log");
    expect(
      classifyPersistentStreamPath(
        "/srv/sync/projects/project-secret/__dko__syncstrings:secret",
      ),
    ).toBe("project:dko");
    expect(
      classifyPersistentStreamPath(
        "/srv/sync/projects/project-secret/home/user/private-file.chat",
      ),
    ).toBe("project:other");
  });
});
