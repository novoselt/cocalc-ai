/*
 *  This file is part of CoCalc: Copyright © 2024 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Render the text layer on top of a page to support selection.

How the hell did I figure this code out?  First, there is nightmare of misleading and
useless outdated google hits from the last 10+ years.  Finally, searching the
pdfjs git repo yielded a complicated trail and I eventually figured out what pdfjs's
own complete renderer does (we can't use it since we need integration with the latex
editor, etc.):

https://github.com/mozilla/pdf.js/blob/a7e1bf64c4c7a42c7577ce9490054faa1c4eda99/web/text_layer_builder.js#L40
*/

import type { PDFPageProxy } from "pdfjs-dist/webpack.mjs";
import { useEffect, useRef } from "react";
import { TextLayer } from "pdfjs-dist";
import "./pdfjs-text.css";

interface Props {
  page: PDFPageProxy;
  scale: number;
  viewport;
}

export default function PdfjsTextLayer({ page, scale, viewport }: Props) {
  const divRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const elt = divRef.current;
    if (!elt) {
      return;
    }
    let textLayer: TextLayer;
    try {
      textLayer = new TextLayer({
        textContentSource: page.streamTextContent({
          includeMarkedContent: true,
          disableNormalization: true,
        }),
        container: elt,
        viewport,
      });
      elt.innerHTML = "";
    } catch (err) {
      console.warn(`pdf.js -- Error creating text layer: ${err}`);
      return;
    }
    let disposed = false;
    void textLayer.render().catch((err) => {
      if (!disposed) {
        console.warn(`pdf.js -- Error rendering text layer: ${err}`);
      }
    });
    return () => {
      disposed = true;
      textLayer.cancel();
    };
  }, [page, scale]);

  return (
    <div
      ref={divRef}
      style={{ "--scale-factor": scale } as any}
      className="cocalc-pdfjs-text-layer"
    />
  );
}
