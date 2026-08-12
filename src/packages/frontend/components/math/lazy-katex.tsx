/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { Suspense } from "react";

import { CocalcErrorBoundary } from "@cocalc/frontend/app/error-boundary";
import { lazyWithRetry } from "@cocalc/frontend/app/lazy-with-retry";
import type { Props } from "./katex";

const KaTeX = lazyWithRetry<Props>(() => import("./katex"), "KaTeX renderer");

export default function LazyKaTeX(props: Props) {
  const source = <>{props.data}</>;
  return (
    <CocalcErrorBoundary
      scope="components.math.lazy-katex"
      fallback={source}
      resetKeys={[props.data]}
    >
      <Suspense fallback={source}>
        <KaTeX {...props} />
      </Suspense>
    </CocalcErrorBoundary>
  );
}
