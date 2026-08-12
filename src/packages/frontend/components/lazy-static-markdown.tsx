/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { Suspense, type CSSProperties } from "react";

import type { InlineCodeLink } from "@cocalc/chat";
import { CocalcErrorBoundary } from "@cocalc/frontend/app/error-boundary";
import { lazyWithRetry } from "@cocalc/frontend/app/lazy-with-retry";

const StaticMarkdown = lazyWithRetry(
  () => import("@cocalc/frontend/editors/slate/static-markdown"),
  "static Markdown renderer",
);

export interface LazyStaticMarkdownProps {
  value: string;
  style?: CSSProperties;
  className?: string;
  editorTheme?: string | null;
  inlineCodeLinks?: InlineCodeLink[];
  inlineCodeProjectRoot?: string;
  highlightQuery?: string;
}

export default function LazyStaticMarkdown({
  value,
  style,
  className,
  ...props
}: LazyStaticMarkdownProps) {
  const plainText = (
    <div
      className={className}
      style={{ whiteSpace: "pre-wrap", width: "100%", ...style }}
    >
      {value}
    </div>
  );
  return (
    <CocalcErrorBoundary
      scope="components.lazy-static-markdown"
      fallback={plainText}
      resetKeys={[value]}
    >
      <Suspense fallback={plainText}>
        <StaticMarkdown
          value={value}
          style={style}
          className={className}
          {...props}
        />
      </Suspense>
    </CocalcErrorBoundary>
  );
}
