import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAccountCandidates,
  buildProcessCandidates,
  buildTreeFingerprints,
  looksRandomLocalPart,
} from "./abuse-health-scan.mjs";

test("recognizes generated email local parts conservatively", () => {
  assert.equal(looksRandomLocalPart("z0olbyyg"), true);
  assert.equal(looksRandomLocalPart("william.stein"), false);
  assert.equal(looksRandomLocalPart("student"), false);
});

test("classifies combined remote access and tunnel signals as high", () => {
  const candidates = buildProcessCandidates([
    {
      project_id: "11111111-1111-4111-8111-111111111111",
      host_id: "host-1",
      host_name: "host one",
      process_count: 4,
      processes: [
        { name: "sshx", count: 1 },
        { name: "cloudflared", count: 1 },
        { name: "dropbear", count: 2 },
      ],
    },
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, "high");
  assert.deepEqual(candidates[0].reason_codes, [
    "remote_access",
    "tunnel_or_proxy",
  ]);
  assert.deepEqual(candidates[0].process_names, ["cloudflared", "sshx"]);
});

test("keeps a single tunnel tool review-only and ignores dropbear", () => {
  const candidates = buildProcessCandidates([
    {
      project_id: "11111111-1111-4111-8111-111111111111",
      processes: [
        { name: "cloudflared", count: 1 },
        { name: "dropbear", count: 1 },
      ],
    },
    {
      project_id: "22222222-2222-4222-8222-222222222222",
      processes: [{ name: "dropbear", count: 1 }],
    },
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, "review");
  assert.deepEqual(candidates[0].reason_codes, ["tunnel_or_proxy"]);
});

test("scores a coordinated signup and runtime cluster as high", () => {
  const accounts = Array.from({ length: 9 }, (_, index) => ({
    account_id: `account-${index}`,
    email_address: `x${index}z9q7ab@catchall.example`,
    created_ip: "203.0.113.9",
    user_agent: "Mozilla/5.0 HeadlessChrome/151",
    primary_auth_method: "email_code",
    banned: false,
  }));
  const projects = accounts.map(({ account_id }, index) => ({
    account_id,
    project_id: `project-${index}`,
    title: "My Code",
    state: index < 7 ? "running" : "opened",
  }));
  const candidates = buildAccountCandidates(accounts, projects, 3);
  const domain = candidates.find(({ kind }) => kind === "email_domain");
  assert.equal(domain.status, "high");
  assert.ok(domain.score >= 7);
  assert.equal(domain.account_count, 9);
  assert.equal(domain.running_project_count, 7);
});

test("does not score a distributed institutional cohort", () => {
  const accounts = Array.from({ length: 6 }, (_, index) => ({
    account_id: `account-${index}`,
    email_address: `student.${index}@university.example`,
    created_ip: `198.51.100.${index + 1}`,
    user_agent: `Browser ${index}`,
    primary_auth_method: "email_code",
    banned: false,
  }));
  assert.deepEqual(buildAccountCandidates(accounts, [], 3), []);
});

test("keeps a small same-network institutional cohort at watch severity", () => {
  const accounts = Array.from({ length: 4 }, (_, index) => ({
    account_id: `account-${index}`,
    email_address: `24abc${index}9z@university.example`,
    created_ip: "198.51.100.8",
    user_agent: `Browser ${index}`,
    primary_auth_method: "email_code",
    banned: false,
  }));
  const candidates = buildAccountCandidates(accounts, [], 3);
  assert.equal(candidates[0].status, "watch");
});

test("groups complete project trees without exposing path data", () => {
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
  ];
  const rows = ids.map((project_id, index) => ({
    project_id,
    host_id: index === 2 ? "host-2" : "host-1",
    host_name: index === 2 ? "host two" : "host one",
    fingerprint_version: "tree-metadata-v1",
    structure_sha256: "structure-hash",
    metadata_sha256: index === 2 ? "metadata-b" : "metadata-a",
    entry_count: 12,
    file_count: 4,
    complete: true,
  }));
  const fingerprints = buildTreeFingerprints(rows, 3);
  assert.equal(fingerprints.length, 1);
  assert.equal(fingerprints[0].structure_sha256, "structure-hash");
  assert.equal(fingerprints[0].metadata_variant_count, 2);
  assert.equal(fingerprints[0].host_count, 2);
  assert.deepEqual(fingerprints[0].project_ids, ids);
});
