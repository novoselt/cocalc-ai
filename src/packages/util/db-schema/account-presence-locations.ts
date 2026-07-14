/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Table } from "./types";

// Current, approximate IP-derived location only. Rows expire automatically and
// are never an account location history.
Table({
  name: "account_presence_locations",
  rules: {
    primary_key: "account_id",
    durability: "soft",
    pg_indexes: ["expire", "country_code"],
  },
  fields: {
    account_id: {
      type: "uuid",
      desc: "Account whose current approximate location was observed.",
    },
    bay_id: {
      type: "string",
      pg_type: "VARCHAR(64)",
      desc: "Bay that observed this short-lived location.",
    },
    observed_at: {
      type: "timestamp",
      desc: "When the current approximate location was observed.",
    },
    expire: {
      type: "timestamp",
      desc: "When this short-lived location must be deleted.",
    },
    country_code: {
      type: "string",
      pg_type: "VARCHAR(2)",
      desc: "Normalized ISO alpha-2 country code.",
    },
    region_code: {
      type: "string",
      pg_type: "VARCHAR(16)",
    },
    region: {
      type: "string",
      pg_type: "VARCHAR(128)",
    },
    city: {
      type: "string",
      pg_type: "VARCHAR(128)",
    },
    continent: {
      type: "string",
      pg_type: "VARCHAR(8)",
    },
    timezone: {
      type: "string",
      pg_type: "VARCHAR(64)",
    },
    latitude: {
      type: "number",
    },
    longitude: {
      type: "number",
    },
  },
});
