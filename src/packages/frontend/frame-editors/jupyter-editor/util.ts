/*
 *  This file is part of CoCalc: Copyright © 2020-2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/**
 * Returns true if the given frame type is any Jupyter notebook frame
 * (standard or minimal).
 */
export function isJupyterNotebookFrameType(type: string | undefined): boolean {
  // Frame-tree node types are editor-spec keys (not EditorDescription.type);
  // "jupyter" is a legacy key for the regular cell notebook.
  return (
    type === "jupyter_cell_notebook" ||
    type === "jupyter" ||
    type === "jupyter_minimal"
  );
}
