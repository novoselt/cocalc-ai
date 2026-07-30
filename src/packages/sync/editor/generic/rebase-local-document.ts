/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { rebaseDraft } from "patchflow";

import type { Document } from "./types";

export function rebaseLocalDocument({
  base,
  draft,
  committed,
}: {
  base?: Document;
  draft: Document;
  committed: Document;
}): Document {
  if (base == null) {
    return draft;
  }
  return rebaseDraft({
    base,
    draft,
    updatedBase: committed,
  }) as Document;
}
