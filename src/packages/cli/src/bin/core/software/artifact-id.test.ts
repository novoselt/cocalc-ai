import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseGeneratedTag,
  compactMinuteTimestamp,
  compactTimestamp,
  createSoftwareArtifactId,
  parseSoftwareBuildComponent,
  validateSoftwareArtifactId,
  validateSoftwareTag,
} from "./artifact-id";

const createdAt = new Date("2026-06-14T23:59:12.345Z");
const git = {
  commit: "e882d124c7abcdef",
  short: "e882d124c7ab",
  branch: "lite4",
  dirty: false,
  status_porcelain: "",
};

test("software tag validation accepts the intended operator alphabet", () => {
  assert.equal(validateSoftwareTag("fix-bug_1.2"), "fix-bug_1.2");
  assert.throws(() => validateSoftwareTag("bad tag"), /software tag/);
  assert.throws(() => validateSoftwareTag(""), /must not be empty/);
  assert.throws(() => validateSoftwareTag("latest"), /reserved/);
});

test("software build component parser rejects deploy-only components", () => {
  assert.equal(parseSoftwareBuildComponent("hub"), "hub");
  assert.equal(parseSoftwareBuildComponent("bay"), "bay");
  assert.throws(
    () => parseSoftwareBuildComponent("bay-conat-router"),
    /unknown software build component/,
  );
});

test("software artifact id includes timestamp git tag and dirty suffix", () => {
  assert.equal(
    createSoftwareArtifactId({
      createdAt,
      git,
      tag: "fix-bug",
    }),
    "20260614T235912Z-e882d124-fix-bug",
  );
  assert.equal(
    createSoftwareArtifactId({
      createdAt,
      git: { ...git, dirty: true },
      tag: "fix-bug",
    }),
    "20260614T235912Z-e882d124-fix-bug-dirty",
  );
});

test("software artifact id validation rejects unsafe release paths", () => {
  assert.equal(
    validateSoftwareArtifactId("20260811T120000Z-e882d124-cli-release"),
    "20260811T120000Z-e882d124-cli-release",
  );
  assert.throws(
    () => validateSoftwareArtifactId("../../cli-release"),
    /must have the form/,
  );
  assert.throws(
    () => validateSoftwareArtifactId("20260811-e882d124-cli-release"),
    /must have the form/,
  );
});

test("generated software tags prefer minute timestamp and avoid collisions", () => {
  assert.equal(compactMinuteTimestamp(createdAt), "20260614T2359Z");
  assert.equal(compactTimestamp(createdAt), "20260614T235912Z");
  assert.equal(
    chooseGeneratedTag({
      createdAt,
      tagExists: () => false,
    }),
    "20260614T2359Z",
  );
  assert.equal(
    chooseGeneratedTag({
      createdAt,
      tagExists: (tag) => tag === "20260614T2359Z",
    }),
    "20260614T235912Z",
  );
  assert.equal(
    chooseGeneratedTag({
      createdAt,
      tagExists: (tag) =>
        tag === "20260614T2359Z" || tag === "20260614T235912Z",
    }),
    "20260614T235912Z-2",
  );
});
