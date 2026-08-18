import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type DevEnvironment = {
  api_url?: string;
  browser_base_url?: string;
  cli_bin?: string;
  exports?: Record<string, string>;
  project_id?: string;
};

export interface EssentialE2eEnvironment {
  accountId: string;
  apiUrl: string;
  baseUrl: string;
  cliBin: string;
  cliEnv: NodeJS.ProcessEnv;
  projectId: string;
}

let environmentPromise: Promise<EssentialE2eEnvironment> | undefined;

export const NOTEBOOK_PATH = "/home/user/.cocalc-essential-e2e/jupyter.ipynb";

export function essentialAuthStatePath(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  return join(tmpdir(), `cocalc-essential-e2e-auth-${uid}.json`);
}

export function essentialChromiumExecutable(): string | undefined {
  const candidates = [
    process.env.COCALC_ESSENTIAL_E2E_CHROMIUM?.trim(),
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" &&
      candidate.length > 0 &&
      existsSync(candidate),
  );
}

function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function cleanCliEnvironment(
  devEnvironment: DevEnvironment,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(devEnvironment.exports ?? {}),
  };
  delete env.COCALC_BEARER_TOKEN;
  delete env.COCALC_ACCOUNT_ID;
  delete env.COCALC_PROFILE;
  return env;
}

async function loadDevEnvironment(): Promise<DevEnvironment> {
  const script = join(process.cwd(), "../../scripts/dev/dev-env.js");
  const { stdout } = await execFileAsync(process.execPath, [
    script,
    "hub",
    "--json",
    "--with-browser",
  ]);
  return JSON.parse(stdout) as DevEnvironment;
}

export async function runEssentialCli(
  args: string[],
  environment?: EssentialE2eEnvironment,
): Promise<Record<string, any>> {
  const resolved = environment ?? (await resolveEssentialE2eEnvironment());
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      resolved.cliBin,
      "--profile",
      "default",
      "--api",
      resolved.apiUrl,
      "--json",
      ...args,
    ],
    {
      env: resolved.cliEnv,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const payload = JSON.parse(stdout) as {
    data?: Record<string, any>;
    error?: { message?: string };
    ok?: boolean;
  };
  if (payload.ok !== true) {
    throw new Error(
      payload.error?.message ?? `cocalc ${args.join(" ")} failed`,
    );
  }
  return payload.data ?? {};
}

export async function resolveEssentialE2eEnvironment(): Promise<EssentialE2eEnvironment> {
  environmentPromise ??= (async () => {
    const devEnvironment = await loadDevEnvironment();
    const apiUrl =
      process.env.COCALC_ESSENTIAL_E2E_API_URL?.trim() ||
      devEnvironment.api_url?.trim();
    const baseUrl =
      process.env.COCALC_ESSENTIAL_E2E_BASE_URL?.trim() ||
      devEnvironment.browser_base_url?.trim() ||
      apiUrl;
    const cliBin =
      process.env.COCALC_ESSENTIAL_E2E_CLI_BIN?.trim() ||
      devEnvironment.cli_bin?.trim();
    const projectId =
      process.env.COCALC_ESSENTIAL_E2E_PROJECT_ID?.trim() ||
      devEnvironment.project_id?.trim();
    const accountId =
      process.env.COCALC_ESSENTIAL_E2E_ACCOUNT_ID?.trim() ||
      devEnvironment.exports?.COCALC_ACCOUNT_ID?.trim();
    if (!apiUrl || !baseUrl || !cliBin || !projectId || !accountId) {
      throw new Error(
        "Essential E2E requires a running local hub with an account and project; run pnpm dev:hub:env to inspect the environment.",
      );
    }
    return {
      accountId,
      apiUrl: trimSlash(apiUrl),
      baseUrl: trimSlash(baseUrl),
      cliBin,
      cliEnv: cleanCliEnvironment(devEnvironment),
      projectId,
    };
  })();
  return await environmentPromise;
}

function encodePath(path: string): string {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

export function essentialNotebookUrl(
  environment: EssentialE2eEnvironment,
): string {
  return `${environment.baseUrl}/essential/projects/${environment.projectId}/files/${encodePath(NOTEBOOK_PATH)}`;
}

export async function uploadNotebookFixture(
  environment: EssentialE2eEnvironment,
): Promise<void> {
  const notebook = {
    cells: [
      {
        cell_type: "code",
        execution_count: null,
        id: "essential-e2e-cell-1",
        metadata: {},
        outputs: [],
        source: 'print("essential-e2e-42")',
      },
      {
        cell_type: "code",
        execution_count: null,
        id: "essential-e2e-cell-2",
        metadata: {},
        outputs: [],
        source: "",
      },
    ],
    metadata: {
      kernelspec: {
        display_name: "Python 3 (ipykernel)",
        language: "python",
        name: "python3",
      },
      language_info: { name: "python" },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  const contents = Buffer.from(
    `${JSON.stringify(notebook, null, 1)}\n`,
    "utf8",
  ).toString("base64");
  await runEssentialCli(
    [
      "project",
      "exec",
      "--project",
      environment.projectId,
      "--",
      "python3",
      "-c",
      [
        "import base64, pathlib, sys",
        "path = pathlib.Path(sys.argv[1])",
        "path.parent.mkdir(parents=True, exist_ok=True)",
        "path.write_bytes(base64.b64decode(sys.argv[2]))",
      ].join("; "),
      NOTEBOOK_PATH,
      contents,
    ],
    environment,
  );
}

export async function ensureAuthStateDirectory(): Promise<void> {
  await mkdir(dirname(essentialAuthStatePath()), { recursive: true });
}
