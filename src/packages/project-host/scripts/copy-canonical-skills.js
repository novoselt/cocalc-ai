#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectHostRoot = path.resolve(__dirname, "..");
const canonicalSkillsRoot = path.resolve(
  projectHostRoot,
  "..",
  "cli",
  "skills",
);
const packagedSkillsRoot = path.join(projectHostRoot, "dist", "skills");
const canonicalSkill = path.join(canonicalSkillsRoot, "cocalc", "SKILL.md");

if (!fs.statSync(canonicalSkill).isFile()) {
  throw new Error(`canonical CoCalc skill is missing: ${canonicalSkill}`);
}

fs.rmSync(packagedSkillsRoot, { recursive: true, force: true });
fs.mkdirSync(path.dirname(packagedSkillsRoot), { recursive: true });
fs.cpSync(canonicalSkillsRoot, packagedSkillsRoot, { recursive: true });

const packagedSkill = path.join(packagedSkillsRoot, "cocalc", "SKILL.md");
if (fs.readFileSync(packagedSkill).compare(fs.readFileSync(canonicalSkill))) {
  throw new Error(`packaged CoCalc skill differs from ${canonicalSkill}`);
}
