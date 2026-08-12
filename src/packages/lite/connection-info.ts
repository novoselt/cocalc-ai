import os from "node:os";
import { join } from "node:path";

const CONNECTION_INFO_FILENAME = "connection-info.json";

function liteDataDirSuffix(): string[] {
  if (process.platform === "darwin") {
    return ["Library", "Application Support", "cocalc-lite"];
  }
  return [".local", "share", "cocalc-lite"];
}

function defaultLiteDataDir(): string {
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA?.trim() ||
      join(os.homedir(), "AppData", "Local");
    return join(localAppData, "CoCalc", "Lite");
  }
  const home = process.env.HOME?.trim();
  const base = home && home.length > 0 ? home : process.cwd();
  return join(base, ...liteDataDirSuffix());
}

// Canonical on-disk location for lite startup connection metadata.
// If COCALC_WRITE_CONNECTION_INFO is set, that path is used explicitly.
export function connectionInfoPath(): string {
  const explicit = process.env.COCALC_WRITE_CONNECTION_INFO?.trim();
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  return join(defaultLiteDataDir(), CONNECTION_INFO_FILENAME);
}
