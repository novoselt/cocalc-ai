/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  DOCUMENT_BUILD_EVENTS_SERVICE,
  projectSubject,
} from "@cocalc/conat/names";

export function documentBuildEventsSubject({
  project_id,
}: {
  project_id: string;
}): string {
  return projectSubject({
    project_id,
    service: DOCUMENT_BUILD_EVENTS_SERVICE,
  });
}
