#!/usr/bin/env node
const { delimiter, dirname, join } = require("path");
const os = require("os");
const {
  FALLBACK_PROJECT_UUID,
  FALLBACK_ACCOUNT_UUID,
} = require("@cocalc/util/misc");

function defaultLiteDataDir() {
  const home = process.env.HOME ?? process.cwd();
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA ?? join(os.homedir(), "AppData", "Local");
    return join(localAppData, "CoCalc", "Lite");
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "cocalc-lite");
  }
  return join(home, ".local", "share", "cocalc-lite");
}

function configureProcessMaxListeners() {
  const configured = Number.parseInt(
    `${process.env.COCALC_PROCESS_MAX_LISTENERS ?? ""}`,
    10,
  );
  const limit =
    Number.isInteger(configured) && configured > 0 ? configured : 50;
  if (process.getMaxListeners() < limit) {
    process.setMaxListeners(limit);
  }
}

(async () => {
  configureProcessMaxListeners();

  if (`${process.env.COCALC_LITE_ACP_WORKER ?? ""}`.trim() === "1") {
    // Exit explicitly: lingering Codex app-server children would otherwise
    // keep the worker process alive after its queue loop has stopped.
    try {
      await require("@cocalc/lite/acp-worker").main();
      process.exit(0);
    } catch (err) {
      console.error("ACP worker failed", err);
      process.exit(1);
    }
  }

  // Lite always uses one canonical local account/project identity.
  process.env.COCALC_PROJECT_ID = FALLBACK_PROJECT_UUID;
  process.env.COCALC_ACCOUNT_ID = FALLBACK_ACCOUNT_UUID;
  process.env.PORT ??= await require("@cocalc/backend/get-port").default();
  process.env.DATA ??= defaultLiteDataDir();
  process.env.COCALC_DATA_DIR ??= process.env.DATA;

  // put path to special node binaries:
  const { bin } = require("@cocalc/backend/data");
  process.env.PATH = [bin, dirname(process.execPath), process.env.PATH]
    .filter(Boolean)
    .join(delimiter);

  require("@cocalc/lite/main").main();
})();
