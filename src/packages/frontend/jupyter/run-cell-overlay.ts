/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { type Map as ImmutableMap, is as immutableIs } from "immutable";

export type RunCellOverlay = ImmutableMap<string, any>;

const RUNTIME_CELL_FIELDS = ["state", "start", "end"] as const;

export function withDisplayedCellRuntime(
  cell: ImmutableMap<string, any>,
  overlay?: RunCellOverlay,
): ImmutableMap<string, any> {
  if (overlay == null) {
    return cell;
  }
  let displayed = cell;
  for (const key of RUNTIME_CELL_FIELDS) {
    if (overlay.has(key)) {
      displayed = displayed.set(key, overlay.get(key));
    }
  }
  return displayed;
}

export function getDisplayedCellOutput(
  cell: ImmutableMap<string, any>,
  overlay?: RunCellOverlay,
): any {
  if (overlay?.has("output")) {
    return overlay.get("output");
  }
  return cell.get("output");
}

export function getDisplayedCellExecCount(
  cell: ImmutableMap<string, any>,
  overlay?: RunCellOverlay,
): any {
  let execCount = overlay?.has("exec_count")
    ? overlay.get("exec_count")
    : cell.get("exec_count");
  const output = getDisplayedCellOutput(cell, overlay);
  if (output != null) {
    for (const [, mesg] of output) {
      if (
        mesg == null ||
        typeof mesg.has !== "function" ||
        typeof mesg.get !== "function"
      ) {
        continue;
      }
      if (mesg.has("exec_count")) {
        execCount = mesg.get("exec_count");
        break;
      }
    }
  }
  return execCount;
}

export function doesPersistentCellSatisfyRunCellOverlay(
  cell: ImmutableMap<string, any>,
  overlay?: RunCellOverlay,
): boolean {
  if (overlay == null) {
    return false;
  }
  const overlayState = overlay.get("state");
  // An active local run overlay must survive intermediate persistent cell
  // writes. The project runtime state may arrive before or after those writes,
  // and clearing here would allow a later write to erase the running UI.
  if (
    overlayState === "start" ||
    overlayState === "run" ||
    overlayState === "busy"
  ) {
    return false;
  }
  if (overlay.has("state") && cell.get("state") !== overlayState) {
    return false;
  }
  for (const key of ["start", "end"] as const) {
    if (overlay.get(key) != null && cell.get(key) == null) {
      return false;
    }
  }
  if (
    overlay.has("output") &&
    !immutableIs(cell.get("output"), overlay.get("output"))
  ) {
    return false;
  }
  if (
    overlay.has("exec_count") &&
    getDisplayedCellExecCount(cell) !== overlay.get("exec_count")
  ) {
    return false;
  }
  return true;
}
