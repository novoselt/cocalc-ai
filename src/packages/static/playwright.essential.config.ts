import { defineConfig } from "@playwright/test";
import {
  essentialAuthStatePath,
  essentialChromiumExecutable,
} from "./playwright/essential/helpers";

export default defineConfig({
  testDir: "playwright/essential",
  globalSetup: "playwright/essential/global-setup.ts",
  outputDir: "/tmp/cocalc-essential-playwright-results",
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  workers: 1,
  use: {
    headless: true,
    screenshot: "only-on-failure",
    storageState: essentialAuthStatePath(),
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: essentialChromiumExecutable(),
    },
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
