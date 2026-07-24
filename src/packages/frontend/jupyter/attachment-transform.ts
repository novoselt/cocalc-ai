/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { Map } from "immutable";

import { filename_extension, startswith } from "@cocalc/util/misc";

// Resolve "attachment:<name>" URLs against the cell's stored attachments,
// returning a data: URI. Used by both the regular CellInput markdown path and
// the minimal cell renderer.
export function attachmentTransform(
  cell: Map<string, any>,
  href?: string,
): string | undefined {
  if (!href || !startswith(href, "attachment:")) {
    return;
  }
  const name = href.slice("attachment:".length);
  const data = cell.getIn(["attachments", name]) as any;
  let ext = filename_extension(name);
  switch (data?.get("type")) {
    case "base64":
      if (ext === "jpg") {
        ext = "jpeg";
      }
      return `data:image/${ext};base64,${data.get("value")}`;
    default:
      return "";
  }
}
