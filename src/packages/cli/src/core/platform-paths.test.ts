import assert from "node:assert/strict";
import test from "node:test";

import {
  cocalcCliCacheDir,
  cocalcCliConfigDir,
  cocalcCliDataDir,
} from "./platform-paths";

test("uses native Windows application data directories", () => {
  const env = {
    APPDATA: "C:\\Users\\Ada Lovelace\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\Ada Lovelace\\AppData\\Local",
  } as NodeJS.ProcessEnv;
  const input = {
    env,
    home: "C:\\Users\\Ada Lovelace",
    platform: "win32" as const,
  };
  assert.equal(
    cocalcCliConfigDir(input),
    "C:\\Users\\Ada Lovelace\\AppData\\Roaming\\CoCalc",
  );
  assert.equal(
    cocalcCliDataDir(input),
    "C:\\Users\\Ada Lovelace\\AppData\\Local\\CoCalc\\CLI",
  );
  assert.equal(
    cocalcCliCacheDir(input),
    "C:\\Users\\Ada Lovelace\\AppData\\Local\\CoCalc\\CLI\\cache",
  );
});

test("preserves XDG and explicit data directory overrides", () => {
  const input = {
    env: {
      XDG_CONFIG_HOME: "/tmp/config",
      XDG_DATA_HOME: "/tmp/data",
      XDG_CACHE_HOME: "/tmp/cache",
    } as NodeJS.ProcessEnv,
    home: "/home/test",
    platform: "linux" as const,
  };
  assert.equal(cocalcCliConfigDir(input), "/tmp/config/cocalc");
  assert.equal(cocalcCliDataDir(input), "/tmp/data/cocalc");
  assert.equal(cocalcCliCacheDir(input), "/tmp/cache/cocalc");
  assert.equal(
    cocalcCliDataDir({
      ...input,
      env: { COCALC_CLI_DATA_DIR: "/srv/cocalc" },
    }),
    "/srv/cocalc",
  );
});
