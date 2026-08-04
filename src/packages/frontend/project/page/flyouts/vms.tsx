/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { ProjectComputeVms } from "@cocalc/frontend/project/compute-vms";

export function VmsFlyout({
  project_id,
  wrap,
  isVisible,
}: {
  project_id: string;
  wrap: (content: React.JSX.Element) => React.JSX.Element;
  isVisible?: boolean;
}) {
  return wrap(
    <ProjectComputeVms compact isVisible={isVisible} project_id={project_id} />,
  );
}
