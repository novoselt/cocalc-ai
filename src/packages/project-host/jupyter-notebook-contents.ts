/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import { export_to_ipynb } from "@cocalc/jupyter/ipynb/export-to-ipynb";
import type { DBDocument } from "@cocalc/sync/editor/db/doc";

function immutableValue(value: any): any {
  return value?.toJS instanceof Function ? value.toJS() : value;
}

export function jupyterNotebookContents(
  doc: DBDocument,
  requestedNotebook: any,
): string {
  const cells: Record<string, any> = {};
  const cellList: Array<{ id: string; pos: number }> = [];
  doc.get({ type: "cell" })?.forEach((value: any) => {
    const cell = immutableValue(value);
    const id = `${cell?.id ?? ""}`;
    if (!id) return;
    cells[id] = cell;
    cellList.push({
      id,
      pos: Number.isFinite(cell.pos) ? cell.pos : Number.MAX_SAFE_INTEGER,
    });
  });
  cellList.sort((a, b) => a.pos - b.pos || a.id.localeCompare(b.id));
  const settings =
    immutableValue(doc.get_one({ type: "settings" })) ?? ({} as any);
  const metadata = structuredClone(settings.metadata ?? {});
  const requestedKernel = requestedNotebook?.metadata?.kernelspec;
  const kernelName = `${settings.kernel ?? requestedKernel?.name ?? ""}`;
  const kernelspec =
    requestedKernel?.name?.toLowerCase() === kernelName.toLowerCase()
      ? structuredClone(requestedKernel)
      : kernelName
        ? { name: kernelName, display_name: kernelName }
        : {};
  const ipynb = export_to_ipynb({
    cells: structuredClone(cells),
    cell_list: cellList.map(({ id }) => id),
    metadata,
    kernelspec,
    language_info: metadata.language_info,
  });
  return `${JSON.stringify(ipynb, null, 1)}\n`;
}
