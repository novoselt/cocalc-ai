/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/* Use this component to make an anchor tag that
   opens in a new tab in the right way, namely
   with rel=noopener.  This avoids sharing cpu
   with the main cocalc page.
*/

import type { AnchorHTMLAttributes, ReactNode } from "react";
import { Tooltip } from "./tip";

interface AProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "children" | "href" | "rel" | "target"
> {
  href: string;
  children: ReactNode;
  placement?: string;
}

export function A({
  href,
  children,
  style,
  title,
  placement,
  ...anchorProps
}: AProps) {
  const anchor = (
    <a
      {...anchorProps}
      href={href}
      target="_blank"
      rel="noopener"
      style={style}
    >
      {children}
    </a>
  );
  if (title) {
    // use nicer antd tooltip.
    return (
      <Tooltip title={title} placement={placement as any}>
        {anchor}
      </Tooltip>
    );
  }
  return anchor;
}
