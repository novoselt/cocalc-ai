/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getInvoiceUrl } from "./api";

export async function getInvoiceUrlOrNull(
  invoiceId: string,
): Promise<string | null> {
  try {
    return await getInvoiceUrl(invoiceId);
  } catch {
    // Historical and migrated purchase rows do not always refer to a Stripe
    // invoice. A receipt link is optional and must not crash the settings UI.
    return null;
  }
}
