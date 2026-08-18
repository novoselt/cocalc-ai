import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  essentialNotebookUrl,
  resolveEssentialE2eEnvironment,
  uploadNotebookFixture,
} from "./helpers";

type EssentialDiagnosticsSnapshot = {
  events: Array<{
    details?: Record<string, string | number | boolean | null>;
    event: string;
  }>;
  version: 1;
};

async function openExecutableNotebook(page: Page): Promise<void> {
  const environment = await resolveEssentialE2eEnvironment();
  await uploadNotebookFixture(environment);
  await page.goto(essentialNotebookUrl(environment), {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "Edit or run notebook" }).click();
  await expect(
    page.locator('[data-essential-surface="notebook"]'),
  ).toHaveAttribute("data-execution-state", "idle");
}

async function readDiagnostics(
  page: Page,
): Promise<EssentialDiagnosticsSnapshot | undefined> {
  return await page.evaluate(() =>
    (
      window as typeof window & {
        __COCALC_ESSENTIAL_DIAGNOSTICS__?: {
          snapshot: () => EssentialDiagnosticsSnapshot;
        };
      }
    ).__COCALC_ESSENTIAL_DIAGNOSTICS__?.snapshot(),
  );
}

async function attachDiagnostics(page: Page, testInfo: TestInfo) {
  const diagnostics = await readDiagnostics(page);
  await testInfo.attach("essential-diagnostics", {
    body: JSON.stringify(diagnostics ?? null, null, 2),
    contentType: "application/json",
  });
}

test.describe("Essential Jupyter", () => {
  test.afterEach(async ({ page }, testInfo) => {
    if (!page.isClosed()) await attachDiagnostics(page, testInfo);
  });

  test("executes a cell through the real project kernel", async ({ page }) => {
    await openExecutableNotebook(page);
    const notebook = page.locator('[data-essential-surface="notebook"]');
    await page
      .locator(".ul-cell")
      .first()
      .getByRole("button", {
        name: "Run",
      })
      .click();

    await expect(
      page.getByText("essential-e2e-42", { exact: true }),
    ).toBeVisible();
    await expect(notebook).toHaveAttribute("data-execution-state", "idle");
    await expect(notebook).toHaveAttribute("data-kernel-status", "idle");

    const diagnostics = await readDiagnostics(page);
    const events = diagnostics?.events.map(({ event }) => event) ?? [];
    expect(events).toContain("run_requested");
    expect(events).toContain("run_accepted");
    expect(events).toContain("run_completed");
    expect(
      diagnostics?.events.some(
        ({ details, event }) =>
          event === "state" &&
          details?.execution === "running" &&
          details?.kernel === "idle",
      ),
    ).toBe(false);
  });

  test("Run all completes when the final code cell is empty", async ({
    page,
  }) => {
    await openExecutableNotebook(page);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Run all" }).click();

    const notebook = page.locator('[data-essential-surface="notebook"]');
    await expect(
      page.getByText("essential-e2e-42", { exact: true }),
    ).toBeVisible();
    await expect(notebook).toHaveAttribute("data-execution-state", "idle");
    await expect(notebook).toHaveAttribute("data-kernel-status", "idle");
    await expect(page.getByText(/Kernel submitting/i)).toHaveCount(0);
  });

  test("Run all cancellation does not submit cells", async ({ page }) => {
    await openExecutableNotebook(page);
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "Run all" }).click();

    const notebook = page.locator('[data-essential-surface="notebook"]');
    await expect(notebook).toHaveAttribute("data-execution-state", "idle");
    await expect(
      page.getByText("essential-e2e-42", { exact: true }),
    ).toHaveCount(0);
    const diagnostics = await readDiagnostics(page);
    expect(
      diagnostics?.events.some(({ event }) => event === "run_requested"),
    ).toBe(false);
  });
});
