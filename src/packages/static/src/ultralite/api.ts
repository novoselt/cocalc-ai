/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import { authBootstrapUrl } from "./urls";

export interface AuthBootstrap {
  signed_in: boolean;
  account_id?: string;
  display_name?: string;
  email_address?: string;
  home_bay_id?: string;
  home_bay_url?: string;
}

export async function getAuthBootstrap(
  signal?: AbortSignal,
): Promise<AuthBootstrap> {
  const response = await fetch(authBootstrapUrl(), {
    method: "POST",
    body: "{}",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    signal,
  });
  const text = await response.text();
  let value: AuthBootstrap & { error?: string };
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`Authentication returned HTTP ${response.status}.`);
  }
  if (!response.ok || value.error) {
    throw new Error(
      value.error || `Authentication returned HTTP ${response.status}.`,
    );
  }
  return value;
}
