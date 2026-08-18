import { chromium } from "@playwright/test";
import {
  ensureAuthStateDirectory,
  essentialAuthStatePath,
  essentialChromiumExecutable,
  resolveEssentialE2eEnvironment,
  runEssentialCli,
} from "./helpers";

async function globalSetup(): Promise<void> {
  const environment = await resolveEssentialE2eEnvironment();
  await runEssentialCli(["auth", "elevate", "--dev"], environment);
  const issued = await runEssentialCli(
    ["admin", "user", "issue-impersonation-link", environment.accountId],
    environment,
  );
  const sourceUrl = new URL(`${issued.url ?? ""}`);
  const loginUrl = new URL(
    `${sourceUrl.pathname}${sourceUrl.search}`,
    `${environment.baseUrl}/`,
  );
  const browser = await chromium.launch({
    executablePath: essentialChromiumExecutable(),
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(loginUrl.toString(), { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Continue impersonation" }).click();
    await page.waitForURL(
      (url) => !url.pathname.startsWith("/auth/impersonate"),
      { timeout: 30_000 },
    );
    await ensureAuthStateDirectory();
    await context.storageState({ path: essentialAuthStatePath() });
  } finally {
    await browser.close();
  }
}

export default globalSetup;
