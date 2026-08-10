/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { CSSProperties } from "react";
import { Typography } from "antd";

import { appBasePath } from "@cocalc/frontend/customize/app-base-path";
import { joinUrlPath } from "@cocalc/util/url-path";

const { Paragraph } = Typography;

export default function SupportSubmissionNotice({
  style,
}: {
  style?: CSSProperties;
}) {
  return (
    <Paragraph type="secondary" style={{ margin: 0, ...style }}>
      By submitting, you agree that CoCalc support staff and AI-assisted support
      tools may review the information you provide and, when reasonably
      necessary to investigate your request, relevant account data and files in
      projects involved in it. Information reviewed for support is never used to
      train AI models. See our{" "}
      <a
        href={joinUrlPath(appBasePath, "policies/privacy")}
        target="_blank"
        rel="noreferrer"
      >
        Privacy Policy
      </a>{" "}
      and{" "}
      <a
        href={joinUrlPath(appBasePath, "policies/terms")}
        target="_blank"
        rel="noreferrer"
      >
        Terms of Service
      </a>
      .
    </Paragraph>
  );
}
