/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Wires the @cocalc/docs registry into public-site-metadata.

The docs registry transitively includes the full documentation content
(hundreds of KB), so public-site-metadata must not import it directly:
that would pull all of it into the initial public browser bundle for every
public page. Instead:

- servers (hub) import this module statically, and
- the browser loads it via dynamic import() only when rendering a docs
  route, sharing the chunk with the lazy docs app.
*/

import { DOCS_ENTRIES, getDocsEntry } from "@cocalc/docs";
import { registerPublicDocsMetadataSource } from "./public-site-metadata";

export function initPublicDocsMetadata(): void {
  registerPublicDocsMetadataSource({
    getEntry: (slugOrId, access) => getDocsEntry(slugOrId, access),
    hasEntry: (slug) => DOCS_ENTRIES.some((entry) => entry.slug === slug),
  });
}

initPublicDocsMetadata();
