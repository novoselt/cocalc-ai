import {
  isExamMode,
  resetExamModeConfigurationForTesting,
  setExamModeConfiguration,
  waitForExamModeConfiguration,
} from "./exam-mode";

beforeEach(() => resetExamModeConfigurationForTesting());

it("waits until customization declares exam mode", async () => {
  const waiting = waitForExamModeConfiguration();
  setExamModeConfiguration(true);

  await expect(waiting).resolves.toBe(true);
  expect(isExamMode()).toBe(true);
});

it("records a normal site configuration", async () => {
  setExamModeConfiguration(false);

  await expect(waitForExamModeConfiguration()).resolves.toBe(false);
  expect(isExamMode()).toBe(false);
});
