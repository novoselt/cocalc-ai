/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/**
 * Help affordance of the Studio notebook layout. The reference itself lives in
 * the integrated documentation (/docs/jupyter/studio-view); this only opens it,
 * so the two never drift apart.
 */

import { useIntl } from "react-intl";

import { Icon, Tooltip } from "@cocalc/frontend/components";
import { DocsLink } from "@cocalc/frontend/docs/link";
import { useFrameContext } from "@cocalc/frontend/frame-editors/frame-tree/frame-context";
import { labels } from "@cocalc/frontend/i18n";
import { COLORS } from "@cocalc/util/theme";

export const STUDIO_DOCS_SLUG = "jupyter/studio-view";

export default function StudioNotebookHelp() {
  const intl = useIntl();
  const { project_id } = useFrameContext();

  return (
    <Tooltip title="Open the documentation for the Studio notebook view">
      <DocsLink
        projectId={project_id ? project_id : undefined}
        slug={STUDIO_DOCS_SLUG}
        style={{
          color: COLORS.ANTD_LINK_BLUE,
          padding: "0 7px",
          whiteSpace: "nowrap",
        }}
      >
        <Icon name="question-circle" /> {intl.formatMessage(labels.help)}
      </DocsLink>
    </Tooltip>
  );
}
