/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { Suspense } from "react";

import { CocalcErrorBoundary } from "@cocalc/frontend/app/error-boundary";
import { lazyWithRetry } from "@cocalc/frontend/app/lazy-with-retry";
import type { Props } from "./markdown";

const RichMarkdown = lazyWithRetry<Props>(async () => {
  const { Markdown } = await import("./markdown");
  return { default: Markdown };
}, "rich Markdown renderer");

export default function LazyMarkdown(props: Props) {
  const plainText = (
    <div
      id={props.id}
      className={props.className}
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
      style={{ whiteSpace: "pre-wrap", ...props.style }}
    >
      {props.value}
    </div>
  );
  return (
    <CocalcErrorBoundary
      scope="components.lazy-markdown"
      fallback={plainText}
      resetKeys={[props.value]}
    >
      <Suspense fallback={plainText}>
        <RichMarkdown {...props} />
      </Suspense>
    </CocalcErrorBoundary>
  );
}
