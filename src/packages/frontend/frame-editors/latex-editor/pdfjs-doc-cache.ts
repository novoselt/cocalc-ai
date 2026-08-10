/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
We cache recently loaded PDF.js docs, so that:

- several frames on the same document only have to load it once
- hiding, then re-showing the document is much faster
- canvas and svg can share the same doc
*/

/*
MAX_PAGES is the maximum number of pages to store in the cache.
I just made this value up to avoid some weird case
where maybe we fail to remove stuff from the cache
and things just grow badly (user has tons of docs open).
*/
const MAX_PAGES = 1000;

import LRU from "lru-cache";

import { versions } from "@cocalc/cdn";
import { appBasePath } from "@cocalc/frontend/customize/app-base-path";
import { reuseInFlight } from "@cocalc/util/reuse-in-flight";
import { joinUrlPath } from "@cocalc/util/url-path";

/*
PDF.js is bundled by the frontend. Its packed CMaps are copied separately by
@cocalc/cdn so private and offline CoCalc installations do not depend on an
external CDN.
*/
import { getDocument as pdfjs_getDocument } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist/webpack.mjs";
import { raw_url } from "@cocalc/frontend/frame-editors/frame-tree/util";
import { pdf_path } from "./util";

const options = {
  maxSize: MAX_PAGES,
  sizeCalculation: function (doc: PDFDocumentProxy): number {
    return Math.max(doc.numPages ?? 1, 1);
  },
};

export function url_to_pdf(
  project_id: string,
  path: string,
  reload: number,
): string {
  return raw_url(project_id, pdf_path(path), `param=${reload}`);
}

const doc_cache = new LRU(options);

let pdfjsWorkerInit: Promise<void> | null = null;

async function ensurePdfjsWorker(): Promise<void> {
  if (!pdfjsWorkerInit) {
    pdfjsWorkerInit = import("pdfjs-dist/webpack.mjs").then(() => undefined);
  }
  await pdfjsWorkerInit;
}

export function pdfjsCMapUrl(basePath = appBasePath): string {
  const version = versions["pdfjs-dist"];
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("@cocalc/cdn does not provide PDF.js CMap assets");
  }
  return `${joinUrlPath(basePath || "/", "cdn", `pdfjs-dist-${version}`, "cmaps")}/`;
}

export const getDocument = reuseInFlight(async function (url: string) {
  let doc: PDFDocumentProxy | undefined = doc_cache.get(url);
  if (doc === undefined) {
    await ensurePdfjsWorker();
    doc = (await pdfjs_getDocument({
      url,
      withCredentials: true,
      cMapUrl: pdfjsCMapUrl(),
      cMapPacked: true,
      disableStream: true,
      disableAutoFetch: true,
    }).promise) as unknown as PDFDocumentProxy;
    doc_cache.set(url, doc);
  }
  return doc;
});

/*
Call this to remove this given pdf from the cache.
This is called when the reload number *changes*, since then we will
never ever want to see the old pdf.
*/
export function forgetDocument(url: string): void {
  doc_cache.delete(url);
}
