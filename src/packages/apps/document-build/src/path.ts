/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  change_filename_extension,
  filename_extension,
  path_split,
} from "@cocalc/util/misc";

export { change_filename_extension, filename_extension, path_split };

export function joinPath(head: string, tail: string): string {
  return head ? `${head}/${tail}` : tail;
}

export function replaceExtension(path: string, extension: string): string {
  return change_filename_extension(path, extension);
}

export function basenameWithoutExtension(path: string): string {
  const { tail } = path_split(path);
  const extension = filename_extension(tail);
  return extension ? tail.slice(0, -extension.length - 1) : tail;
}

export function pdfPath(path: string): string {
  return replaceExtension(path, "pdf");
}
