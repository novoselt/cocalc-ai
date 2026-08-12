/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Table } from "./types";

Table({
  name: "project_host_exam_configs",
  rules: {
    primary_key: "host_id",
    pg_indexes: ["hostname", "updated_at"],
  },
  fields: {
    host_id: {
      type: "uuid",
      desc: "Private project host configured to provide exam scratchpads.",
    },
    enabled: {
      type: "boolean",
      desc: "Whether exam mode may be prepared on this host.",
    },
    title: {
      type: "string",
      desc: "Public title shown on the temporary scratchpad admission page.",
    },
    hostname: {
      type: "string",
      desc: "Stable single-origin hostname used by exam browsers.",
    },
    dns_record_id: {
      type: "string",
      desc: "Cloudflare DNS record id for the stable exam hostname.",
    },
    dns_target: {
      type: "string",
      desc: "Current project-host hostname targeted by the exam CNAME.",
    },
    generation: {
      type: "number",
      desc: "Monotonic configuration generation frozen into each exam run.",
    },
    max_projects: {
      type: "number",
      desc: "Maximum anonymous projects admitted during one run.",
    },
    project_cpu: {
      type: "number",
      desc: "CPU limit assigned to each exam project.",
    },
    project_memory_mb: {
      type: "number",
      desc: "Memory limit assigned to each exam project.",
    },
    project_disk_mb: {
      type: "number",
      desc: "Disk quota assigned to each exam project.",
    },
    project_ttl_minutes: {
      type: "number",
      desc: "Maximum duration of an exam run before cleanup.",
    },
    cleanup_grace_minutes: {
      type: "number",
      desc: "Bounded cleanup interval before the host powers off dirty.",
    },
    terminal_enabled: {
      type: "boolean",
      desc: "Whether the terminal is exposed to exam sessions.",
    },
    network_mode: {
      type: "string",
      desc: "Frozen network policy; the MVP supports only disabled.",
    },
    token_hash: {
      type: "string",
      desc: "Scrypt hash of the stable admission token.",
    },
    token_ciphertext: {
      type: "string",
      desc: "Encrypted stable admission token, readable only by the owning bay.",
    },
    created_at: {
      type: "timestamp",
      desc: "When exam mode was first configured.",
    },
    updated_at: {
      type: "timestamp",
      desc: "When the configuration was last changed.",
    },
    created_by: {
      type: "uuid",
      desc: "Account that first configured exam mode.",
    },
    updated_by: {
      type: "uuid",
      desc: "Account that last changed the configuration.",
    },
  },
});
