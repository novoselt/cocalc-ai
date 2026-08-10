/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { useEffect, useState } from "react";

import { copyTextToClipboard } from "@cocalc/frontend/components/copy-to-clipboard-util";

import "./copy-button.css";

const COPY_BUTTON_RESET_MS = 1500;

export default function CodeCopyButton({
  value,
  overlay = false,
}: {
  value: string;
  overlay?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [value]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPY_BUTTON_RESET_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const label = copied ? "Copied" : "Copy to clipboard";

  return (
    <button
      aria-label={label}
      className={`cocalc-code-copy-button${
        overlay ? " cocalc-code-copy-button--overlay" : ""
      }`}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void copyTextToClipboard({ text: value }).then((ok) => {
          if (ok) setCopied(true);
        });
      }}
      title={label}
      type="button"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <rect
        height="11"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.8"
        width="11"
        x="8"
        y="8"
      />
      <path
        d="M15 8V6.5A1.5 1.5 0 0 0 13.5 5h-8A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16H8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path
        d="m5 12.5 4 4L19 7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}
