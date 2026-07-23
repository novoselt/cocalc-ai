/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Table } from "./types";

Table({
  name: "webapp_error_resolutions",
  fields: {
    signature: {
      type: "string",
      desc: "Normalized frontend crash signature.",
    },
    build_key: {
      type: "string",
      desc: "Frontend revision or build identifier scoped by this resolution.",
    },
    status: {
      type: "string",
      pg_type: "VARCHAR(16)",
      desc: "Operator triage status; currently open or solved.",
    },
    report_id: {
      type: "uuid",
      desc: "Representative webapp_errors row used for the resolution.",
    },
    resolved_by: {
      type: "uuid",
      desc: "Admin account that last changed this resolution.",
    },
    note: {
      type: "string",
      desc: "Short operator note describing the resolution or reopen reason.",
    },
    resolved_at: {
      type: "timestamp",
      desc: "Time this signature/build was most recently marked solved.",
    },
    updated_at: {
      type: "timestamp",
      desc: "Time this resolution state was most recently changed.",
    },
  },
  rules: {
    primary_key: ["signature", "build_key"],
    pg_indexes: ["status", "report_id", "updated_at"],
  },
});
