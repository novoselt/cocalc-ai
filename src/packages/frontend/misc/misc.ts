/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import target from "@cocalc/frontend/client/handle-target";
import { QueryParams } from "@cocalc/frontend/misc/query-params";

/*
Misc random code that I don't really know how to classify further.  It's misc
among misc...
*/

export function html_to_text(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const script of template.content.querySelectorAll("script")) {
    script.remove();
  }
  return template.content.textContent ?? "";
}

// returns true, if a target page should be loaded
export function should_load_target_url(): boolean {
  return (
    target != null &&
    target != "login" &&
    !QueryParams.get("test") &&
    !QueryParams.get("get_api_key")
  );
}
